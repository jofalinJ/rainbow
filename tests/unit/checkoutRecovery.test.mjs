import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {webcrypto} from "node:crypto";

const KEY="rainbow_razorpay_verification_v1";
const payload={checkout_id:"58cad012-6529-41be-b14e-4ad0878c19db",razorpay_order_id:"order_checkout123",razorpay_payment_id:"pay_payment123",razorpay_signature:"a".repeat(64)};
const recoveryToken="b".repeat(64);
const providerResponse=()=>({success:true,keyId:"rzp_test_key123",amount:10000,currency:"INR",gatewayOrderId:payload.razorpay_order_id,recoveryToken,expiresAt:new Date(Date.now()+600000).toISOString()});
let stored;
beforeEach(()=>{
  vi.resetModules();
  stored=new Map();
  vi.stubGlobal("sessionStorage",{
    getItem:key=>stored.get(key)||null,
    setItem:(key,value)=>stored.set(key,value),
    removeItem:key=>stored.delete(key)
  });
  vi.stubGlobal("crypto",webcrypto);
  vi.stubGlobal("window",{RAINBOW_PAYMENT_CONFIG:{apiBaseUrl:"https://rainbow-api.example"}});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const response=data=>({ok:true,json:async()=>data});
const save=()=>stored.set(KEY,JSON.stringify({payload,paid:false}));

describe("payment callback recovery",()=>{
  it("submits manual UPI only through the rate-limited payment API",async()=>{
    const fetch=vi.fn().mockResolvedValue(response({success:true,order_number:"UPI-FIXTURE",total_amount:100}));
    vi.stubGlobal("fetch",fetch);
    const gateway=await import("../../order-razorpay.mjs");
    const details={items:[{variant_id:"v1",quantity:1}],customer:{name:"Test",payment_method:"upi",payment_reference:"fixture123"}};
    expect(await gateway.submitManualUpiReference(details)).toMatchObject({order_number:"UPI-FIXTURE"});
    expect(fetch.mock.calls[0][0]).toBe("https://rainbow-api.example/api/razorpay/manual-upi");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({...details,customer:{...details.customer,checkout_id:expect.stringMatching(/^[a-f0-9-]{36}$/)}});
  });
  it("reverifies the signed callback after a reload instead of creating another payment",async()=>{
    save();
    const fetch=vi.fn().mockResolvedValue(response({success:true,paid:true,orderNumber:"RG-TEST-1",invoiceUrl:"https://rainbowgoldcovering.com/invoice.html?token=58cad012-6529-41be-b14e-4ad0878c19db"}));
    vi.stubGlobal("fetch",fetch);
    const gateway=await import("../../order-razorpay.mjs");
    expect(await gateway.retryRazorpayTestVerification()).toMatchObject({status:"paid",orderNumber:"RG-TEST-1"});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://rainbow-api.example/api/razorpay/verify");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
    expect(gateway.getRazorpayRecovery().paid).toBe(true);
    // A cached success is only a recovery hint: every reload still verifies.
    await gateway.retryRazorpayTestVerification();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["awaiting_capture","payment_failed","refund_required","refunded","checkout_expired"])("never marks %s as confirmed",async status=>{
    save();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({success:true,paid:false,status})));
    const gateway=await import("../../order-razorpay.mjs");
    const result=await gateway.retryRazorpayTestVerification();
    expect(result.status).toBe(status==="awaiting_capture"?"pending":status);
    expect(gateway.getRazorpayRecovery().paid).toBe(false);
  });
  it("rejects a locally cached status without a complete signed callback",async()=>{
    stored.set(KEY,JSON.stringify({paid:true,orderNumber:"FORGED",payload:{...payload,razorpay_signature:"invalid"}}));
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const gateway=await import("../../order-razorpay.mjs");
    expect(gateway.getRazorpayRecovery()).toBeNull();
    await expect(gateway.retryRazorpayTestVerification()).rejects.toThrow("No saved payment verification");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rechecks a capability with cached success rather than trusting the cached payment flag",async()=>{
    const capability={checkout_id:payload.checkout_id,gateway_order_id:payload.razorpay_order_id,recovery_token:recoveryToken};
    stored.set(KEY,JSON.stringify({capability,paid:true}));
    const fetch=vi.fn().mockResolvedValue(response({success:true,paid:false,status:"refunded",orderNumber:"RG-REFUNDED"}));
    vi.stubGlobal("fetch",fetch);
    const gateway=await import("../../order-razorpay.mjs");
    expect(await gateway.retryRazorpayTestVerification()).toMatchObject({status:"refunded"});
    expect(fetch.mock.calls[0][0]).toBe("https://rainbow-api.example/api/razorpay/status");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(capability);
    expect(gateway.getRazorpayRecovery().paid).toBe(false);
  });
  it("saves the callback before verification and safely retries a network interruption",async()=>{
    const fetch=vi.fn()
      .mockResolvedValueOnce(response(providerResponse()))
      .mockImplementationOnce(async()=>{
        expect(JSON.parse(stored.get(KEY)).payload.razorpay_payment_id).toBe(payload.razorpay_payment_id);
        throw new Error("Offline");
      })
      .mockResolvedValueOnce(response({success:true,paid:true,orderNumber:"RG-TEST-2"}));
    vi.stubGlobal("fetch",fetch);
    globalThis.window.Razorpay=class {
      constructor(options){this.options=options;}
      open(){this.options.handler(payload);}
    };
    const gateway=await import("../../order-razorpay.mjs");
    await expect(gateway.beginRazorpayTestPayment({items:[{variant_id:"v1",quantity:1}],customer:{name:"Test"},displayTotal:100})).rejects.toThrow("Offline");
    expect(gateway.getRazorpayRecovery().paid).toBe(false);
    expect(await gateway.retryRazorpayTestVerification()).toMatchObject({status:"paid",orderNumber:"RG-TEST-2"});
    expect(fetch.mock.calls.map(([url])=>new URL(url).pathname)).toEqual(["/api/razorpay/create","/api/razorpay/status","/api/razorpay/status"]);
  });
  it("recovers a reload before any callback and blocks a new payment after cart or customer edits",async()=>{
    const fetch=vi.fn()
      .mockResolvedValueOnce(response(providerResponse()))
      .mockResolvedValueOnce(response({success:true,paid:false,status:"awaiting_capture"}))
      .mockResolvedValueOnce(response({success:true,paid:true,status:"paid",orderNumber:"RG-LOST-CALLBACK"}));
    vi.stubGlobal("fetch",fetch);
    const opened=vi.fn();
    globalThis.window.Razorpay=class {
      constructor(options){this.options=options;}
      open(){
        opened();
        const saved=JSON.parse(stored.get(KEY));
        expect(saved.capability).toEqual({checkout_id:expect.any(String),gateway_order_id:payload.razorpay_order_id,recovery_token:recoveryToken});
        expect(saved.payload).toBeUndefined();
        // The gateway was closed without delivering any payment callback.
        this.options.modal.ondismiss();
      }
    };
    let gateway=await import("../../order-razorpay.mjs");
    const details={items:[{variant_id:"v1",quantity:1}],customer:{name:"Test"},displayTotal:100};
    expect(await gateway.beginRazorpayTestPayment(details)).toEqual({status:"pending"});
    vi.resetModules();
    gateway=await import("../../order-razorpay.mjs");
    expect(gateway.getRazorpayRecovery().payload).toBeNull();
    expect(await gateway.beginRazorpayTestPayment({...details,items:[{variant_id:"v2",quantity:2}],customer:{name:"Changed"}})).toMatchObject({status:"pending"});
    expect(await gateway.retryRazorpayTestVerification()).toMatchObject({status:"paid",orderNumber:"RG-LOST-CALLBACK"});
    expect(opened).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([url])=>new URL(url).pathname)).toEqual(["/api/razorpay/create","/api/razorpay/status","/api/razorpay/status"]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(gateway.getRazorpayRecovery().capability);
  });
  it("does not open the gateway without a valid server recovery capability",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({...providerResponse(),recoveryToken:"invalid"})));
    globalThis.window.Razorpay=vi.fn();
    const gateway=await import("../../order-razorpay.mjs");
    await expect(gateway.beginRazorpayTestPayment({items:[{variant_id:"v1",quantity:1}],customer:{name:"Test"},displayTotal:100})).rejects.toThrow("Invalid payment provider response");
    expect(globalThis.window.Razorpay).not.toHaveBeenCalled();
  });
  it("fails before opening the gateway when recovery cannot be persisted",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response(providerResponse())));
    globalThis.window.Razorpay=vi.fn();
    globalThis.sessionStorage.setItem=(key,value)=>{if(key===KEY)throw new Error("Storage unavailable");stored.set(key,value);};
    const gateway=await import("../../order-razorpay.mjs");
    await expect(gateway.beginRazorpayTestPayment({items:[{variant_id:"v1",quantity:1}],customer:{name:"Test"},displayTotal:100})).rejects.toThrow("Storage unavailable");
    expect(globalThis.window.Razorpay).not.toHaveBeenCalled();
  });
  it("does not open the gateway when the reservation expiry is invalid",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({...providerResponse(),expiresAt:"invalid"})));
    globalThis.window.Razorpay=vi.fn();
    const gateway=await import("../../order-razorpay.mjs");
    await expect(gateway.beginRazorpayTestPayment({items:[{variant_id:"v1",quantity:1}],customer:{name:"Test"},displayTotal:100})).rejects.toThrow("expired");
    expect(globalThis.window.Razorpay).not.toHaveBeenCalled();
  });
});
