import {describe,it,expect,vi,afterEach} from "vitest";
import {beginRazorpayPayment} from "../../order-razorpay.mjs";

afterEach(()=>vi.unstubAllGlobals());

describe("Razorpay payment failure handling",()=>{
  it("shows failed-attempt feedback but never confirms an order on failed payment",async()=>{
    const calls=[];
    const failures=[];
    const store=new Map();
    const paymentEvents=new Map();
    let modal;
    class MockRazorpay {
      constructor(options){modal=options;}
      on(type,callback){paymentEvents.set(type,callback);}
      open(){
        queueMicrotask(()=>{
          paymentEvents.get("payment.failed")?.({error:{description:"Bank declined the payment"}});
          modal.modal.ondismiss();
        });
      }
    }
    vi.stubGlobal("window",{
      RAINBOW_PAYMENT_CONFIG:{apiBaseUrl:"https://worker.example"},
      Razorpay:MockRazorpay
    });
    vi.stubGlobal("sessionStorage",{
      getItem:k=>store.get(k)||null,
      setItem:(k,v)=>store.set(k,v),
      removeItem:k=>store.delete(k)
    });
    vi.stubGlobal("fetch",vi.fn(async(input)=>{
      const url=new URL(String(input));
      calls.push(url.pathname);
      let data;
      if(url.pathname==="/api/razorpay/config")
        data={enabled:true,mode:"test",keyId:"rzp_test_Example123"};
      else if(url.pathname==="/api/razorpay/provider-check")
        data={provider:"connected"};
      else if(url.pathname==="/api/razorpay/create")
        data={success:true,mode:"test",keyId:"rzp_test_Example123",
          amount:100,currency:"INR",gatewayOrderId:"order_example12345",
          expiresAt:"2099-01-01T00:00:00Z"};
      else throw Error("Unexpected API: "+url.pathname);
      return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
    }));
    const result=await beginRazorpayPayment({
      items:[{variant_id:"8dde9565-0a39-4acb-b177-3defabc81765",quantity:1}],
      customer:{name:"Example",whatsapp_number:"9999999999",address:"Example",state:"Tamil Nadu"},
      expectedMode:"test",displayTotal:1,onPaymentFailed:message=>failures.push(message)
    });
    expect(result.status).toBe("dismissed");
    expect(failures).toEqual(["Bank declined the payment"]);
    expect(calls).not.toContain("/api/razorpay/verify");
    expect(store.size).toBe(1); // preserve the checkout reservation for reconciliation
  });
});
