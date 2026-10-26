import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../../order.js",import.meta.url),"utf8");
const start=source.indexOf("    async function placeOrder(){");
const end=source.indexOf('\n  $("clearCart")',start);
const validationStart=source.indexOf("  function validateDeliveryFields(){");
const validation=validationStart<0?"":source.slice(validationStart,start);
const phoneValidation=source.slice(source.indexOf("  function phoneLooksValid(phone){"),source.indexOf("    function totals(){"));

async function submit(overrides={},invalidEmail=false){
  const values={name:"QA Customer",phone:"9999999999",email:"qa@example.invalid",pin:"629175",city:"QA City",state:"Tamil Nadu",address:"QA address",paymentReference:"",...overrides};
  const fields=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{
    value,checked:false,setCustomValidity:vi.fn(),removeAttribute:vi.fn(),setAttribute:vi.fn(),
    checkValidity:()=>id!=="email"||!invalidEmail,reportValidity:vi.fn(),
  }]));
  const beginRazorpayPayment=vi.fn(async()=>({status:"dismissed"}));
  const messages=[];
  const context={
    $:id=>fields[id],sb:{},cart:[{variant_id:"qa-variant",quantity:1,current_stock:5}],
    cartVerified:true,cartVerificationFailed:false,submitting:false,razorpayReady:true,razorpayMode:"test",
    cartItemHasStock:()=>true,selectedPaymentMethod:()=>"razorpay",deliveryFeeForState:()=>50,
    updatePlaceOrderState:vi.fn(),msg:(text,kind)=>messages.push({text,kind}),render:vi.fn(),totals:()=>({total:100}),beginRazorpayPayment,
  };
  runInNewContext(phoneValidation+validation+source.slice(start,end)+"\nthis.submit=placeOrder;",context);
  await context.submit();
  return {fields,beginRazorpayPayment,messages};
}

describe("checkout delivery validation before reserving or paying",()=>{
  it("rejects malformed optional email before starting payment and points to its field",async()=>{
    const ui=await submit({email:"not-an-email"},true);
    expect(ui.beginRazorpayPayment).not.toHaveBeenCalled();
    expect(ui.fields.email.reportValidity).toHaveBeenCalledOnce();
    expect(ui.messages.at(-1)).toMatchObject({kind:"error"});
  });

  it("accepts an empty optional email and otherwise valid delivery data",async()=>{
    const ui=await submit({email:""});
    expect(ui.beginRazorpayPayment).toHaveBeenCalledOnce();
    expect(ui.beginRazorpayPayment.mock.calls[0][0].customer.email).toBe("");
  });

  it.each([
    ["name","   "],["phone","letters9999999999"],["pin","abc123"],
    ["name","x".repeat(121)],["address","x".repeat(601)],["city","x".repeat(121)],
  ])("rejects invalid %s at its field without payment",async(field,value)=>{
    const ui=await submit({[field]:value});
    expect(ui.beginRazorpayPayment).not.toHaveBeenCalled();
    expect(ui.fields[field].reportValidity).toHaveBeenCalledOnce();
    expect(ui.fields[field].value).toBe(value);
  });

  it("accepts a formatted country-code phone number",async()=>{
    const ui=await submit({phone:"+91 99999 99999"});
    expect(ui.beginRazorpayPayment).toHaveBeenCalledOnce();
  });
});
