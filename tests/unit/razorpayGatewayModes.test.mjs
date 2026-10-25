import {describe,it,expect,vi,afterEach} from "vitest";
import {razorpayAvailability,beginRazorpayPayment} from "../../order-razorpay.mjs";

afterEach(()=>vi.unstubAllGlobals());

// All provider responses are in-memory fixtures. Never use live credentials,
// server tokens, real payment operations or a network-enabled browser.
function isolate({mode="test",amount=104910,provider="connected"}={}){
  const requests=[];
  const saved=new Map();
  vi.stubGlobal("window",{
    RAINBOW_PAYMENT_CONFIG:{apiBaseUrl:"https://isolated-worker.test"},
    Razorpay:class{constructor(){throw new Error("Payment modal must never open");}}
  });
  vi.stubGlobal("sessionStorage",{
    getItem:key=>saved.get(key)||null,
    setItem:(key,value)=>saved.set(key,String(value)),
    removeItem:key=>saved.delete(key)
  });
  vi.stubGlobal("crypto",{
    randomUUID:()=>"00000000-0000-4000-8000-000000000001",
    subtle:{digest:async()=>new Uint8Array([1,2,3,4]).buffer}
  });
  vi.stubGlobal("fetch",vi.fn(async input=>{
    const path=new URL(String(input)).pathname;
    requests.push(path);
    let body;
    if(path==="/api/razorpay/config")
      body={enabled:true,mode,keyId:"rzp_"+mode+"_Mock12345"};
    else if(path==="/api/razorpay/provider-check")
      body={provider};
    else if(path==="/api/razorpay/create")
      body={success:true,mode,keyId:"rzp_"+mode+"_Mock12345",
        currency:"INR",amount,gatewayOrderId:"order_mock123",
        expiresAt:"2099-01-01T00:00:00Z"};
    else throw new Error("Unexpected isolated endpoint "+path);
    return new Response(JSON.stringify(body),{status:200,
      headers:{"Content-Type":"application/json"}});
  }));
  return {requests,saved};
}
const example={
  items:[{variant_id:"22222222-2222-4222-8222-222222222222",quantity:1}],
  customer:{name:"Mock Buyer",whatsapp_number:"9876543210",
    email:"",state:"Tamil Nadu",address:"Mock address for safe tests"},
  displayTotal:1049.10
};
describe("UX-04: Razorpay TEST and LIVE payment safety",()=>{
  it.each(["test","live"])("only reports %s as available after the server's provider check",async mode=>{
    const mock=isolate({mode});
    const ready=await razorpayAvailability();
    expect(ready.available).toBe(true);
    expect(ready.mode).toBe(mode);
    expect(mock.requests).toEqual(["/api/razorpay/config","/api/razorpay/provider-check"]);
  });
  it("blocks a provider mode change before order creation",async()=>{
    const mock=isolate({mode:"live"});
    await expect(beginRazorpayPayment({...example,expectedMode:"test"}))
      .rejects.toThrow("Payment mode has changed");
    expect(mock.requests).not.toContain("/api/razorpay/create");
  });
  it("rejects a one-paisa difference without opening checkout or verifying payment",async()=>{
    const mock=isolate({mode:"live",amount:104911});
    await expect(beginRazorpayPayment({...example,expectedMode:"live"}))
      .rejects.toThrow("verified price changed");
    expect(mock.requests).toContain("/api/razorpay/create");
    expect(mock.requests).not.toContain("/api/razorpay/verify");
  });
  it("keeps payment unavailable if the provider rejects credentials",async()=>{
    const mock=isolate({mode:"test",provider:"credentials_rejected"});
    const result=await razorpayAvailability();
    expect(result.available).toBe(false);
    expect(result.message).toContain("rejected");
    expect(mock.requests).not.toContain("/api/razorpay/create");
  });
});