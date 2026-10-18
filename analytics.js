/* Optional, consent-gated, privacy-minimal storefront event hooks. No provider is loaded. */
(function(root){
 "use strict";
 const KEY="rainbow_analytics_consent_v1";
 const allowed=new Set(["view_item","view_item_list","add_to_cart","begin_checkout","search","select_category","sort_catalogue","share_product"]);
 const prefs=()=>{try{return localStorage.getItem(KEY);}catch{return null;}};
 let enabled=prefs()==="granted";
 function track(event,details={}){
   if(!enabled||!allowed.has(event))return;
   const safe={};
   for(const key of ["item_id","quantity","term","results","sort","category"]){
     if(Object.prototype.hasOwnProperty.call(details,key))safe[key]=String(details[key]).slice(0,80);
   }
   // No names, phone numbers, email addresses, addresses, payment refs, or persistent user IDs.
   const data={event:"rainbow_"+event,...safe};
   root.dataLayer=root.dataLayer||[];root.dataLayer.push(data);
   root.dispatchEvent(new CustomEvent("rainbow:analytics",{detail:data}));
 }
 function choose(value){
   enabled=value==="granted";
   try{localStorage.setItem(KEY,enabled?"granted":"denied");}catch{}
   document.getElementById("analyticsPreference")?.remove();
 }
 function render(){
   if(prefs()!==null||!document.body)return;
   const banner=document.createElement("section");
   banner.id="analyticsPreference";banner.className="analytics-preference";
   banner.setAttribute("aria-label","Optional website analytics");
   const text=document.createElement("p");
   text.textContent="May we collect anonymous shopping interaction events to improve the store? Optional; you can decline.";
   const allow=document.createElement("button");allow.type="button";allow.textContent="Allow analytics";allow.addEventListener("click",()=>choose("granted"));
   const no=document.createElement("button");no.type="button";no.textContent="No thanks";no.addEventListener("click",()=>choose("denied"));
   banner.append(text,allow,no);document.body.append(banner);
 }
 root.RainbowAnalytics={track,consent:choose,enabled:()=>enabled};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",render,{once:true});else render();
})(window);
