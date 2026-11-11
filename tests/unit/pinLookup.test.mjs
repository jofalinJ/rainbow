import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {attachPinAutofill,canonicalIndianState,lookupIndianPin,parseIndianPinResponse} from "../../pin-lookup.mjs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const postal=(pin,offices)=>[{Status:"Success",PostOffice:offices.map(row=>({
 Pincode:pin,Country:"India",DeliveryStatus:"Delivery",...row
}))}];
const tn=postal("629001",[
 {Name:"Nagercoil",District:"Kanniyakumari",State:"Tamil Nadu"},
 {Name:"Vadasery",District:"Kanniyakumari",State:"Tamil Nadu"}
]);
const kl=postal("695001",[{Name:"Thiruvananthapuram",District:"Thiruvananthapuram",State:"Kerala"}]);

class Field{
 constructor(tagName="INPUT"){
  this.tagName=tagName;this.value="";this.hidden=false;this.events=new Map();
  this.options=tagName==="SELECT"?[{value:""},{value:"Tamil Nadu"},{value:"Kerala"}]:[];
  this.classList={toggle:()=>{}};
 }
 addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
 removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
 dispatchEvent(event){for(const fn of this.events.get(event.type)||[])fn(event);return true;}
 replaceChildren(){this.options=[];}
 add(option){this.options.push(option);}
}

beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal("Option",class{constructor(label,value){this.label=label;this.value=value;}});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

function setup(fetchImpl){
 const pinInput=new Field(),cityInput=new Field(),stateInput=new Field("SELECT");
 const statusElement=new Field(),localitySelect=new Field("SELECT"),localityWrap=new Field();
 localityWrap.hidden=true;
 let stateChanged=0;
 stateInput.addEventListener("change",()=>{stateChanged++;});
 const binding=attachPinAutofill({pinInput,cityInput,stateInput,statusElement,localitySelect,localityWrap,fetchImpl,delay:300,timeout:4000});
 const typePin=value=>{pinInput.value=value;pinInput.dispatchEvent(new Event("input"));};
 return {pinInput,cityInput,stateInput,statusElement,localitySelect,localityWrap,binding,typePin,get stateChanged(){return stateChanged;}};
}

describe("Indian postal PIN lookup",()=>{
 it("normalizes state names and avoids inventing a city when districts disagree",()=>{
  expect(canonicalIndianState("TAMILNADU")).toBe("Tamil Nadu");
  expect(canonicalIndianState("Pondicherry")).toBe("Puducherry");
  const match=parseIndianPinResponse(tn,"629001");
  expect(match.state).toBe("Tamil Nadu");
  expect(match.city).toBe("Kanniyakumari");
  expect(match.localities.map(p=>p.name)).toEqual(["Nagercoil","Vadasery"]);
  expect(parseIndianPinResponse(postal("110001",[
   {Name:"Central",District:"Central Delhi",State:"Delhi"},
   {Name:"New Delhi",District:"New Delhi",State:"Delhi"}
  ]),"110001").city).toBe("");
 });
 it("rejects invalid, non-Indian, cross-state and missing codes",()=>{
  expect(parseIndianPinResponse([], "629001")).toBeNull();
  expect(parseIndianPinResponse([{Status:"Error",PostOffice:null}],"629001")).toBeNull();
  expect(parseIndianPinResponse(tn,"bad")).toBeNull();
  expect(parseIndianPinResponse(postal("629001",[
   {Name:"One",District:"Test",State:"Tamil Nadu"},
   {Name:"Two",District:"Test",State:"Kerala"}
  ]),"629001")).toBeNull();
 });
 it("sends only the PIN code in the public GET and rejects unsuccessful lookups",async()=>{
  const fetchImpl=vi.fn(async()=>({ok:true,json:async()=>kl}));
  expect((await lookupIndianPin("695001",{fetchImpl})).state).toBe("Kerala");
  expect(fetchImpl.mock.calls[0][0]).toBe("https://api.postalpincode.in/pincode/695001");
  expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
  expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain("address");
  await expect(lookupIndianPin("123",{fetchImpl})).rejects.toThrow("6-digit");
 });
 it("autofills empty city/state and notifies checkout's shipping/tax listener",async()=>{
  const fetchImpl=vi.fn(async()=>({ok:true,json:async()=>tn}));
  const form=setup(fetchImpl);
  form.typePin("629");
  await vi.advanceTimersByTimeAsync(350);expect(fetchImpl).not.toHaveBeenCalled();
  form.typePin("629001");
  await vi.advanceTimersByTimeAsync(350);
  expect(form.cityInput.value).toBe("Kanniyakumari");
  expect(form.stateInput.value).toBe("Tamil Nadu");
  expect(form.stateChanged).toBe(1);
  expect(form.localityWrap.hidden).toBe(false);
  form.localitySelect.value="Nagercoil";
  form.localitySelect.dispatchEvent(new Event("change"));
  expect(form.cityInput.value).toBe("Nagercoil");
  form.binding.dispose();
 });
 it("never overwrites manually selected state/city and warns on conflict",async()=>{
  const form=setup(async()=>({ok:true,json:async()=>tn}));
  form.cityInput.value="My Town";
  form.stateInput.value="Kerala";
  form.typePin("629001");
  await vi.advanceTimersByTimeAsync(350);
  expect(form.cityInput.value).toBe("My Town");
  expect(form.stateInput.value).toBe("Kerala");
  expect(form.stateChanged).toBe(0);
  expect(form.statusElement.textContent).toContain("Check the selected state");
  form.binding.dispose();
 });
 it("replaces a previous automatic suggestion when the PIN changes",async()=>{
  const form=setup(async url=>({ok:true,json:async()=>url.endsWith("629001")?tn:kl}));
  form.typePin("629001");
  await vi.advanceTimersByTimeAsync(350);
  form.typePin("695001");
  await vi.advanceTimersByTimeAsync(350);
  expect(form.stateInput.value).toBe("Kerala");
  expect(form.cityInput.value).toBe("Thiruvananthapuram");
  expect(form.stateChanged).toBeGreaterThanOrEqual(3);
  form.binding.dispose();
 });
 it("keeps manual entry working when lookup is offline",async()=>{
  const form=setup(async()=>{throw new Error("Network failure");});
  form.typePin("629001");await vi.advanceTimersByTimeAsync(350);
  expect(form.stateInput.value).toBe("");
  expect(form.statusElement.textContent).toContain("manually");
  expect(form.localityWrap.hidden).toBe(true);
  form.binding.dispose();
 });
 it("keeps the checkout and staff billing inputs editable",()=>{
  const checkout=read("order.html"),billing=read("admin/billing.html"),order=read("order.js");
  expect(checkout).toContain('id="pinLookupStatus"');
  expect(checkout).toContain('id="pinLocality"');
  expect(billing).toContain('id="billingPinLookupStatus"');
  expect(billing).toContain('id="billingPinLocality"');
  expect(billing).toContain("billing-pin.mjs?v=");
  expect(order).toContain("attachPinAutofill({");
  expect(order).toContain('stateField.addEventListener("change",()=>{totals();updatePlaceOrderState();})');
  expect(read("scripts/public-asset-manifest.mjs")).toContain('"pin-lookup.mjs"');
 });
});
