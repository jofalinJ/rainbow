import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../../order.js",import.meta.url),"utf8");
const part=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a);
  if(a<0||b<0)throw new Error("Checkout function boundary missing: "+start);
  return source.slice(a,b);
};
const stock=part("  function cartItemHasStock(item){","  function render(){");
const update=part("  function updatePlaceOrderState(){","    async function verifyCart(){");
const readiness=part("  async function checkGateway(){",'  $("retryGateway").addEventListener');
const submission=part("    async function placeOrder(){",'\n  $("clearCart")');
const defer=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};

function checkout(overrides={}){
  const classNames=new Set();
  const fields={
    placeOrder:{disabled:true,textContent:""},state:{value:"Tamil Nadu"},
    payRazorpay:{checked:true,disabled:true},
    gatewayConnection:{classList:{add:(...names)=>names.forEach(name=>classNames.add(name)),remove:(...names)=>names.forEach(name=>classNames.delete(name))}},
    retryGateway:{hidden:true,disabled:false},gatewayStatus:{textContent:""},gatewayIndicator:{title:""},
    name:{value:"QA Customer"},phone:{value:"9999999999"},email:{value:""},pin:{value:"629175"},
    city:{value:"QA City"},address:{value:"QA Address"},whatsappReceiptConsent:{checked:false},
    orderLayout:{hidden:false},orderSuccess:{hidden:true,innerHTML:""},
  };
  const notes={badge:{},choice:{},safety:{}};
  const context={
    $:id=>fields[id],
    document:{querySelector:selector=>({
      "#razorpayChoice .checkout-mode":notes.badge,
      "#razorpayChoice .payment-choice-note":notes.choice,
      "#razorpayDetails .payment-safety":notes.safety,
    })[selector]||null},
    sb:{rpc:vi.fn()},cart:[{variant_id:"qa-variant",quantity:1,current_stock:5}],
    cartVerified:true,cartVerificationFailed:false,submitting:false,razorpayReady:false,razorpayMode:"test",readinessAttempt:0,
    deliveryFeeForState:value=>value==="Tamil Nadu"?50:null,
    razorpayAvailability:vi.fn(async()=>({available:false,mode:"test",message:"Payment service unavailable"})),
    beginRazorpayPayment:vi.fn(async()=>({status:"dismissed"})),
    validateDeliveryFields:()=>true,msg:vi.fn(),render:vi.fn(),save:vi.fn(),focusOrderConfirmation:vi.fn(),
    totals:()=>({total:100}),esc:value=>String(value),URL,console:{error:vi.fn()},
    ...overrides,
  };
  runInNewContext(stock+update+readiness+submission+"\nthis.update=updatePlaceOrderState;this.check=checkGateway;this.submit=placeOrder;",context);
  return {context,fields,notes,classNames};
}

describe("online-only checkout readiness and submission",()=>{
  it("blocks an unverified gateway and enables only the verified online method",async()=>{
    const ui=checkout({razorpayAvailability:vi.fn(async()=>({available:true,mode:"live",message:"Connected"}))});
    ui.context.update();
    expect(ui.fields.placeOrder.disabled).toBe(true);
    expect(ui.fields.payRazorpay.disabled).toBe(true);
    await ui.context.check();
    expect(ui.fields.placeOrder.disabled).toBe(false);
    expect(ui.fields.payRazorpay.disabled).toBe(false);
    expect(ui.fields.payRazorpay.checked).toBe(true);
    expect(ui.notes.badge.textContent).toBe("LIVE");
    expect(ui.fields.placeOrder.textContent).toBe("Pay securely →");
  });

  it("disables payment immediately during a retry after a previously healthy connection",async()=>{
    const probe=defer();
    const ui=checkout({razorpayReady:true,razorpayAvailability:vi.fn(()=>probe.promise)});
    ui.fields.payRazorpay.disabled=false;
    ui.context.update();
    expect(ui.fields.placeOrder.disabled).toBe(false);
    const checking=ui.context.check();
    expect(ui.fields.placeOrder.disabled).toBe(true);
    expect(ui.fields.payRazorpay.disabled).toBe(true);
    expect(ui.fields.retryGateway.disabled).toBe(true);
    probe.resolve({available:false,mode:"live",message:"Cannot connect to payment service"});
    await checking;
    expect(ui.fields.placeOrder.disabled).toBe(true);
    expect(ui.fields.payRazorpay.disabled).toBe(true);
    expect(ui.fields.payRazorpay.checked).toBe(true);
    expect(ui.fields.retryGateway.hidden).toBe(false);
    expect(ui.fields.retryGateway.disabled).toBe(false);
    expect(ui.fields.gatewayStatus.textContent).toBe("Cannot connect to payment service");
    expect(ui.classNames.has("is-offline")).toBe(true);
  });

  it("ignores stale readiness responses after a newer successful retry",async()=>{
    const older=defer(),newer=defer();
    const ui=checkout({razorpayAvailability:vi.fn().mockImplementationOnce(()=>older.promise).mockImplementationOnce(()=>newer.promise)});
    const first=ui.context.check(),second=ui.context.check();
    newer.resolve({available:true,mode:"live",message:"Latest connection verified"});
    await second;
    older.resolve({available:false,mode:"test",message:"Old connection failed"});
    await first;
    expect(ui.context.razorpayReady).toBe(true);
    expect(ui.context.razorpayMode).toBe("live");
    expect(ui.fields.placeOrder.disabled).toBe(false);
    expect(ui.fields.gatewayStatus.textContent).toBe("Latest connection verified");
    expect(ui.fields.retryGateway.hidden).toBe(true);
    expect(ui.classNames.has("is-online")).toBe(true);
  });

  it.each([
    ["empty bag",{cart:[]}],
    ["unverified stock",{cartVerified:false}],
    ["failed stock check",{cartVerificationFailed:true}],
    ["unavailable variant",{cart:[{quantity:1,current_stock:5,unavailable:true}]}],
    ["insufficient stock",{cart:[{quantity:6,current_stock:5}]}],
    ["unknown stock",{cart:[{quantity:1}]}],
    ["submission already running",{submitting:true}],
  ])("keeps Pay disabled with %s even when the gateway is ready",(_label,overrides)=>{
    const ui=checkout({razorpayReady:true,...overrides});
    ui.context.update();
    expect(ui.fields.placeOrder.disabled).toBe(true);
  });

  it("keeps Pay disabled until a supported delivery state is selected",()=>{
    const ui=checkout({razorpayReady:true});
    ui.fields.state.value="";
    ui.context.update();
    expect(ui.fields.placeOrder.disabled).toBe(true);
  });

  it("rejects direct submission while the gateway is unavailable without creating a manual order",async()=>{
    const ui=checkout();
    await ui.context.submit();
    expect(ui.context.beginRazorpayPayment).not.toHaveBeenCalled();
    expect(ui.context.sb.rpc).not.toHaveBeenCalled();
    expect(ui.context.msg).toHaveBeenLastCalledWith(expect.stringContaining("Online payment is temporarily unavailable"),"error");
    expect(ui.context.cart).toHaveLength(1);
  });

  it("starts one verified gateway checkout for a rapid double submit and allows retry after dismissal",async()=>{
    const payment=defer();
    const begin=vi.fn().mockImplementationOnce(()=>payment.promise).mockResolvedValueOnce({status:"dismissed"});
    const ui=checkout({razorpayReady:true,razorpayMode:"live",beginRazorpayPayment:begin});
    const first=ui.context.submit();
    await ui.context.submit();
    expect(begin).toHaveBeenCalledOnce();
    expect(ui.fields.placeOrder.disabled).toBe(true);
    expect(begin.mock.calls[0][0]).toMatchObject({
      expectedMode:"live",displayTotal:100,items:[{variant_id:"qa-variant",quantity:1}],
      customer:{payment_method:"razorpay",whatsapp_opt_in:false},
    });
    payment.resolve({status:"dismissed"});
    await first;
    expect(ui.context.cart).toHaveLength(1);
    expect(ui.fields.placeOrder.disabled).toBe(false);
    await ui.context.submit();
    expect(begin).toHaveBeenCalledTimes(2);
    expect(ui.context.sb.rpc).not.toHaveBeenCalled();
  });

  it("keeps an authorized payment pending with its order number and without exposing an invoice",async()=>{
    const ui=checkout({razorpayReady:true,beginRazorpayPayment:vi.fn(async()=>({status:"pending",orderNumber:"RG-123"}))});
    await ui.context.submit();
    expect(ui.context.cart).toHaveLength(1);
    expect(ui.fields.orderLayout.hidden).toBe(false);
    expect(ui.fields.orderSuccess.hidden).toBe(true);
    expect(ui.fields.orderSuccess.innerHTML).toBe("");
    expect(ui.context.msg).toHaveBeenCalledWith(expect.stringContaining("for order RG-123 is awaiting confirmation. Do not pay again"),"error");
    expect(ui.context.save).not.toHaveBeenCalled();
  });
});
