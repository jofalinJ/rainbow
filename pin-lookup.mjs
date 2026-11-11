/**
 * Best-effort Indian 6-digit PIN lookup for both storefront checkout and POS.
 * Public postal information only; never send a customer's name/address/phone.
 * Lookup data can contain multiple post offices or be stale: all fields remain editable.
 */
export const PIN_LOOKUP_BASE="https://api.postalpincode.in/pincode/";
const STATE_NAMES=[
 "Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar",
 "Chandigarh","Chhattisgarh","Dadra and Nagar Haveli and Daman and Diu","Delhi",
 "Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand",
 "Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra",
 "Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Puducherry","Punjab",
 "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh",
 "Uttarakhand","West Bengal"
];
const STATE_ALIASES={
 "orissa":"Odisha",
 "pondicherry":"Puducherry",
 "tamilnadu":"Tamil Nadu",
 "andaman nicobar islands":"Andaman and Nicobar Islands",
 "andaman and nicobar":"Andaman and Nicobar Islands",
 "dadra and nagar haveli":"Dadra and Nagar Haveli and Daman and Diu",
 "daman and diu":"Dadra and Nagar Haveli and Daman and Diu"
};
const canonical=value=>String(value??"").toLowerCase().replace(/&/g," and ")
 .replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
export function canonicalIndianState(value){
 const text=canonical(value);
 if(!text)return "";
 return STATE_NAMES.find(s=>canonical(s)===text)||STATE_ALIASES[text]||"";
}
export function parseIndianPinResponse(payload,pin){
 if(!/^\d{6}$/.test(String(pin))||!Array.isArray(payload))return null;
 const entry=payload.find(row=>row?.Status==="Success"&&Array.isArray(row.PostOffice));
 if(!entry)return null;
 const all=entry.PostOffice.filter(row=>row&&typeof row==="object"
   && (!row.Pincode||String(row.Pincode)===String(pin))
   && (!row.Country||String(row.Country).toLowerCase()==="india"));
 const states=[...new Set(all.map(row=>canonicalIndianState(row.State)).filter(Boolean))];
 if(states.length!==1)return null;
 const deliverable=all.filter(row=>String(row.DeliveryStatus||"").toLowerCase()==="delivery");
 const usable=deliverable.length?deliverable:all;
 const locations=[],seen=new Set();
 for(const office of usable){
  const name=String(office.Name||"").trim().slice(0,120);
  if(!name||seen.has(name.toLowerCase()))continue;
  seen.add(name.toLowerCase());
  locations.push({name,district:String(office.District||"").trim().slice(0,120)});
 }
 const districts=[...new Set(usable.map(x=>String(x.District||"").trim()).filter(Boolean))];
 const city=locations.length===1?locations[0].name:(districts.length===1?districts[0].slice(0,120):"");
 return {pin:String(pin),state:states[0],city,localities:locations.slice(0,100)};
}
export async function lookupIndianPin(pin,{fetchImpl=fetch,signal}={}){
 if(!/^\d{6}$/.test(String(pin)))throw new Error("Enter a 6-digit Indian PIN code.");
 const response=await fetchImpl(PIN_LOOKUP_BASE+encodeURIComponent(pin),{
  method:"GET",headers:{Accept:"application/json"},signal,cache:"no-store"
 });
 if(!response.ok)throw new Error("Postal lookup is unavailable.");
 const result=parseIndianPinResponse(await response.json(),pin);
 if(!result)throw new Error("PIN code not found in the postal directory.");
 return result;
}
export function attachPinAutofill({pinInput,cityInput,stateInput,statusElement,
 localitySelect=null,localityWrap=null,fetchImpl=fetch,delay=400,timeout=6500}){
 if(!pinInput||!cityInput||!stateInput||!statusElement)
  throw new Error("PIN lookup fields must exist.");
 let previousPin=String(pinInput.value||"").trim();
 let autoCity="",autoState="",revision=0,timer=null,activeController=null,disposed=false;
 const setMessage=(text,problem=false)=>{
  if(disposed)return;
  statusElement.textContent=text;
  statusElement.classList.toggle("error",problem);
 };
 const notify=(element,type)=>{
  element.dispatchEvent(new Event(type,{bubbles:true}));
 };
 const clearLocalities=()=>{
  if(localityWrap)localityWrap.hidden=true;
  if(localitySelect)localitySelect.replaceChildren();
 };
 const clearPreviousAuto=()=>{
  if(autoCity&&cityInput.value===autoCity){
   cityInput.value="";notify(cityInput,"input");
  }
  if(autoState&&stateInput.value===autoState){
   stateInput.value="";notify(stateInput,"change");
  }
  autoCity="";autoState="";
 };
 const stop=()=>{
  revision++;
  if(timer!==null){clearTimeout(timer);timer=null;}
  if(activeController){activeController.abort();activeController=null;}
 };
 const fetchForPin=async(pin,token)=>{
  const controller=new AbortController();
  activeController=controller;
  const timeoutId=setTimeout(()=>controller.abort(),timeout);
  try{
   const result=await lookupIndianPin(pin,{fetchImpl,signal:controller.signal});
   if(disposed||token!==revision||pinInput.value.trim()!==pin)return;
   let updatedCity=false,updatedState=false;
   if(!cityInput.value.trim()){
    if(result.city){cityInput.value=result.city;autoCity=result.city;updatedCity=true;notify(cityInput,"input");}
   }
   const stateOption=stateInput.tagName?.toLowerCase()==="select"
    ?[...stateInput.options].some(option=>option.value===result.state):true;
   if(stateOption&&!stateInput.value.trim()){
    stateInput.value=result.state;autoState=result.state;updatedState=true;
    notify(stateInput,"input");notify(stateInput,"change");
   }
   clearLocalities();
   if(localitySelect&&localityWrap&&result.localities.length>1){
    localitySelect.add(new Option("Choose your town / post office (optional)",""));
    for(const office of result.localities){
     localitySelect.add(new Option(office.name+(office.district?" · "+office.district:""),office.name));
    }
    localityWrap.hidden=false;
   }
   const conflict=Boolean(stateInput.value.trim()&&canonicalIndianState(stateInput.value)!==result.state);
   if(conflict){
    setMessage("PIN belongs to "+result.state+". Check the selected state before paying or saving the bill.",true);
   }else{
    setMessage("PIN matched "+result.state+". "+(updatedCity||updatedState?"City/state suggested. ":"")+
      (result.localities.length>1?"Choose your locality if needed. ":"")+
      "Confirm the delivery city and address.");
   }
  }catch(error){
   if(disposed||token!==revision||pinInput.value.trim()!==pin)return;
   setMessage("PIN lookup unavailable or not found. Enter city and state manually.",true);
   clearLocalities();
  }finally{
   clearTimeout(timeoutId);
   if(activeController===controller)activeController=null;
  }
 };
 const onPinInput=()=>{
  const pin=pinInput.value.trim();
  if(pin!==previousPin){stop();clearPreviousAuto();clearLocalities();previousPin=pin;}
  else stop();
  if(!pin){setMessage("");return;}
  if(!/^\d{6}$/.test(pin)){
   setMessage("Enter all 6 digits to look up city and state.");
   return;
  }
  setMessage("Finding city and state…");
  const token=revision;
  timer=setTimeout(()=>{timer=null;fetchForPin(pin,token);},delay);
 };
 const onLocality=()=>{
  if(!localitySelect?.value)return;
  const locality=localitySelect.value;
  if(locality.length>120)return;
  cityInput.value=locality;autoCity=locality;
  notify(cityInput,"input");
  setMessage("Locality selected. Confirm your address before continuing.");
 };
 pinInput.addEventListener("input",onPinInput);
 pinInput.addEventListener("change",onPinInput);
 if(localitySelect)localitySelect.addEventListener("change",onLocality);
 if(/^\d{6}$/.test(previousPin))onPinInput();
 return {dispose(){
  stop();disposed=true;
  pinInput.removeEventListener("input",onPinInput);
  pinInput.removeEventListener("change",onPinInput);
  if(localitySelect)localitySelect.removeEventListener("change",onLocality);
 }};
}
