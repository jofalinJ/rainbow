/* Adds per-location totals to the EXISTING Dashboard and Reports pages. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const format=v=>Number(v||0).toLocaleString("en-IN");
function update(id,value){const el=$(id);if(el)el.textContent=value;}
function feedback(message){update("branchSummaryMessage",message);}
async function refresh(){
 const button=$("refreshBranchSummary");
 if(!button||button.disabled)return;
 button.disabled=true;
 try{
  await window.requireSession();
  const profile=await window.getMyProfile();
  if(!profile.active||profile.role!=="admin")throw Error("Admin access required.");
  const {data,error}=await window.bootSupabase().rpc("erp_location_summary");
  if(error)throw error;
  const result=data||{},locations=Array.isArray(result.locations)?result.locations:[];
  update("branchTotalOnHand",format(result.company_on_hand));
  update("branchTotalReserved",format(result.company_reserved));
  update("branchTotalTransit",format(result.company_in_transit));
  update("branchTotalOwned",format(result.company_owned));
  const rows=$("branchSummaryRows");rows.replaceChildren();
  if(!locations.length){
   const tr=document.createElement("tr");const td=document.createElement("td");
   td.colSpan=7;td.textContent="No configured shop locations.";tr.append(td);rows.append(tr);
  }
  for(const loc of locations){
   const tr=document.createElement("tr");
   for(const value of [loc.name,loc.kind==="online"?"Online":"Physical shop",
    format(loc.on_hand),format(loc.available),format(loc.reserved),
    format(loc.incoming),format(loc.low_stock)]){
    const td=document.createElement("td");td.textContent=String(value??"");tr.append(td);
   }
   rows.append(tr);
  }
  feedback("Stock figures are from the new branch inventory ledger; current POS checkout still uses the original global stock until approved migration.");
 }catch(error){
  for(const id of ["branchTotalOnHand","branchTotalReserved","branchTotalTransit","branchTotalOwned"])update(id,"—");
  const body=$("branchSummaryRows");if(body){
   body.replaceChildren();
   const tr=document.createElement("tr");const td=document.createElement("td");
   td.colSpan=7;td.textContent="Branch inventory is not yet available in this database.";
   tr.append(td);body.append(tr);
  }
  feedback("Multi-shop reports unavailable: "+error.message+". Existing sales and product reports remain unchanged.");
 }finally{button.disabled=false;}
}
function init(){
 if(!$("branchSummaryPanel"))return;
 $("refreshBranchSummary").addEventListener("click",refresh);
 refresh();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();