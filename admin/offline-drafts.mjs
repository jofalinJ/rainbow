import {createDraftRecord,saveDraft,listDrafts,deleteDraft} from "../src/domain/offlineDrafts.mjs";
/**
 * Recoverable customer-PII-free CART DRAFTS ONLY. They are not completed sales.
 * Restoring requires live server catalog/stock/price validation and a human click.
 */
export function setupOfflineDraftPanel({getCartLines,restoreDraft}){
 const $=id=>document.getElementById(id);
 const view=$("offlineDraftRows"),message=$("offlineDraftMsg"),status=$("offlineDraftStatus");
 let busy=false;
 const setMessage=(s)=>{message.textContent=s;};
 const refreshNetwork=()=>{
  const offline=!navigator.onLine;
  status.textContent=offline?
   "Internet unavailable — only unsent cart drafts can be saved. No invoice, payment or reserved stock.":
   "Online — drafts can be restored for live catalog validation. They are NOT paid sales.";
  $("saveOfflineDraft").disabled=busy;
 };
 async function renderDrafts(){
  view.replaceChildren();
  const records=await listDrafts();
  if(!records.length){const p=document.createElement("p");p.textContent="No locally saved drafts.";view.append(p);return;}
  for(const draft of records){
   const row=document.createElement("div");row.className="offline-draft-row";
   const text=document.createElement("span");
   text.textContent=new Date(draft.createdAt).toLocaleString("en-IN")+
    " · "+draft.lines.reduce((sum,l)=>sum+l.quantity,0)+" units · UNSUBMITTED";
   const restore=document.createElement("button");restore.type="button";restore.textContent="Review draft";
   restore.disabled=busy||!navigator.onLine;
   restore.addEventListener("click",async()=>{
    if(busy)return;
    if(!navigator.onLine){setMessage("Reconnect before restoring and validating a draft.");return;}
    busy=true;refreshNetwork();restore.disabled=true;
    try{
     await restoreDraft(draft);
     setMessage("Draft restored to the cart. Check current stock, totals and payment before completing a live sale. Original draft retained until you delete it.");
    }catch(error){setMessage("Draft not restored: "+error.message);}
    finally{busy=false;refreshNetwork();await renderDrafts();}
   });
   const remove=document.createElement("button");remove.type="button";remove.textContent="Delete draft";
   remove.disabled=busy;
   remove.addEventListener("click",async()=>{
    if(busy||!confirm("Delete this UNSUBMITTED cart draft from this device? This does not delete any real sale."))return;
    busy=true;refreshNetwork();
    try{await deleteDraft(draft.id);setMessage("Draft deleted from this device.");}
    catch(error){setMessage("Could not delete draft: "+error.message);}
    finally{busy=false;refreshNetwork();await renderDrafts();}
   });
   row.append(text,restore,remove);view.append(row);
  }
 }
 $("saveOfflineDraft").addEventListener("click",async()=>{
  if(busy)return;busy=true;refreshNetwork();
  try{
   const draft=createDraftRecord(getCartLines());
   await saveDraft(draft);
   setMessage("Draft saved on this device. NOT A SALE OR TAX INVOICE. Do not collect money based on this draft.");
   await renderDrafts();
  }catch(error){setMessage("Draft was NOT saved: "+error.message);}
  finally{busy=false;refreshNetwork();}
 });
 window.addEventListener("online",()=>{refreshNetwork();renderDrafts().catch(e=>setMessage(e.message));});
 window.addEventListener("offline",()=>{refreshNetwork();renderDrafts().catch(e=>setMessage(e.message));});
 refreshNetwork();
 renderDrafts().catch(error=>setMessage("Offline draft storage unavailable: "+error.message));
}
