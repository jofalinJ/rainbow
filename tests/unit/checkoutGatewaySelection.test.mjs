import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

// Runtime checkout startup with only in-memory DOM/storage/provider fakes.
// Fetch, payment SDK, payment submission and SQL never run in this suite.
const source=readFileSync(new URL("../../order.js",import.meta.url),"utf8")
  .replace(/^import .*$/gm,"");
async function startup(hostname,search,mode,available=true){
  const elements=new Map();
  const node=()=>({
    value:"",textContent:"",hidden:false,disabled:false,checked:false,
    dataset:{},style:{},attrs:{},listeners:{},
    classList:{add(){},remove(){},toggle(){},contains(){return false}},
    setAttribute(key,value){this.attrs[key]=value},
    getAttribute(key){return this.attrs[key]??null},
    removeAttribute(key){delete this.attrs[key]},
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback)},
    fire(type){return Promise.all((this.listeners[type]||[]).map(fn=>fn({target:this})))},
    append(){},replaceChildren(){},insertAdjacentElement(){},
    focus(){},scrollIntoView(){},remove(){},showModal(){},close(){},add(){},
    querySelector(){return node()}
  });
  const find=id=>{
    if(!elements.has(id))elements.set(id,node());
    return elements.get(id);
  };
  find("payUpi").checked=true;find("payUpi").value="upi";
  find("payRazorpay").value="razorpay";
  const document={
    getElementById:find,documentElement:{classList:{toggle(){}}},
    createElement:node,
    querySelector:selector=>selector.includes('input[name="paymentMethod"]')
      ?([find("payUpi"),find("payRazorpay")].find(node=>node.checked)||find("payUpi"))
      :find(selector),
    querySelectorAll:selector=>selector.includes("paymentMethod")
      ?[find("payUpi"),find("payRazorpay")]:[],
    body:{append(){}},head:{append(){}},addEventListener(){}
  };
  const window={
    RAINBOW_SUPABASE_CONFIG:{},
    RainbowCatalogue:{
      readBuyNow(){return null},clearBuyNow(){},
      formatINR:value=>"₹"+value
    },
    addEventListener(){}
  };
  const location={hostname,search,href:"https://"+hostname+"/order.html"};
  const storage={getItem(){return null},setItem(){},removeItem(){}};
  let currentMode=mode;
  const provider=async()=>({mode:currentMode,available,message:"Isolated provider check"});
  const forbidPayment=()=>{throw new Error("A real payment action was attempted");};
  const run=new Function(
    "window","document","location","localStorage",
    "razorpayAvailability","beginRazorpayPayment",
    "INDIAN_STATES","deliveryFeeForState","Option","crypto",source
  );
  run(window,document,location,storage,provider,forbidPayment,
    ["Tamil Nadu"],state=>state==="Tamil Nadu"?50:null,
    function Option(label,value){return {label,value}},
    {randomUUID:()=>"00000000-0000-4000-8000-000000000001"}
  );
  for(let index=0;index<8;index++)await Promise.resolve();
  return {
    visible:!find("razorpayChoice").hidden,
    enabled:!find("payRazorpay").disabled,
    manualChecked:find("payUpi").checked,
    razorpayChecked:find("payRazorpay").checked,
    modeBadge:find("#razorpayChoice .checkout-mode").textContent,
    inline:find("razorpayInlineStatus").textContent,
    selectRazorpay(){
      find("payUpi").checked=false;find("payRazorpay").checked=true;
      return find("payRazorpay").fire("change");
    },
    selectManual(){
      find("payUpi").checked=true;find("payRazorpay").checked=false;
      return find("payUpi").fire("change");
    },
    async updateProvider(nextMode){
      currentMode=nextMode;
      await find("retryGateway").fire("click");
      for(let index=0;index<8;index++)await Promise.resolve();
    },
    getInline(){return find("razorpayInlineStatus").textContent},
    getSelection(){return find("payRazorpay").checked?"razorpay":"upi"}
  };
}
describe("UX-04: real checkout startup never silently changes a payment method",()=>{
  it("hides Razorpay TEST on an ordinary production checkout",async()=>{
    const x=await startup("rainbowgoldcovering.com","","test");
    expect(x.visible).toBe(false);
    expect(x.enabled).toBe(false);
    expect(x.manualChecked).toBe(true);
    expect(x.razorpayChecked).toBe(false);
  });
  it("permits explicitly requested TEST only when provider verifies it",async()=>{
    const x=await startup("rainbowgoldcovering.com","?test=1","test");
    expect(x.visible).toBe(true);
    expect(x.enabled).toBe(true);
    expect(x.razorpayChecked).toBe(false);
  });
  it("shows verified LIVE on production without selecting it automatically",async()=>{
    const x=await startup("rainbowgoldcovering.com","","live");
    expect(x.visible).toBe(true);
    expect(x.enabled).toBe(true);
    expect(x.modeBadge).toBe("LIVE");
    expect(x.manualChecked).toBe(true);
    expect(x.razorpayChecked).toBe(false);
  });
  it("permits TEST but never LIVE on a preview host",async()=>{
    const test=await startup("localhost","","test");
    const live=await startup("localhost","","live");
    expect(test.visible).toBe(true);
    expect(test.enabled).toBe(true);
    expect(live.visible).toBe(false);
    expect(live.enabled).toBe(false);
  });
  it("requires a fresh explicit selection when the provider flips TEST to LIVE",async()=>{
    const x=await startup("rainbowgoldcovering.com","?test=1","test");
    await x.selectRazorpay();
    expect(x.getSelection()).toBe("razorpay");
    await x.updateProvider("live");
    expect(x.getSelection()).toBe("razorpay");
    expect(x.getInline()).toContain("Payment mode changed.");
    await x.selectManual();
    await x.selectRazorpay();
    expect(x.getInline()).toBe("Available · LIVE payment");
  });
  it("keeps the LIVE option disabled when provider readiness fails",async()=>{
    const x=await startup("rainbowgoldcovering.com","","live",false);
    expect(x.visible).toBe(true);
    expect(x.enabled).toBe(false);
    expect(x.inline).toBe("Unavailable right now");
  });
});