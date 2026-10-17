// Offline *drafts*, not booked sales, payments, inventory reservations or tax invoices.
// Database-authoritative checkout continues through create_local_sale_once.
export const DRAFT_DB_NAME="rainbow-offline-drafts-v1";
export const DRAFT_STORE="drafts";
const MAX_LINES=100;
export function normalizeDraftLines(input){
 if(!Array.isArray(input)||input.length<1||input.length>MAX_LINES)
  throw new Error("An offline draft needs 1–100 product lines.");
 const seen=new Set();
 return input.map(line=>{
  const id=String(line.variantId||"").trim();
  const quantity=Number(line.quantity);
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(id)||!Number.isInteger(quantity)||
    quantity<1||quantity>1000||seen.has(id))
   throw new Error("Invalid or repeated offline draft variant/quantity.");
  seen.add(id);
  // No customer name, phone, email, card, payment or credentials persisted.
  return Object.freeze({variantId:id,quantity});
 });
}
export function createDraftRecord(lines,{id,createdAt=Date.now()}={}){
 const operationId=id||globalThis.crypto.randomUUID();
 if(!/^[0-9a-f-]{36}$/.test(operationId))throw new Error("Draft ID is not a UUID.");
 return Object.freeze({
  id:operationId,createdAt,kind:"UNSUBMITTED_CART_DRAFT",
  status:"draft",lines:normalizeDraftLines(lines)
 });
}
export function openDraftDB(indexedDB=globalThis.indexedDB){
 if(!indexedDB) return Promise.reject(new Error("This device does not support IndexedDB."));
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DRAFT_DB_NAME,1);
  req.onupgradeneeded=()=>{const db=req.result;
   if(!db.objectStoreNames.contains(DRAFT_STORE))
    db.createObjectStore(DRAFT_STORE,{keyPath:"id"});
  };
  req.onerror=()=>reject(req.error||new Error("Cannot open local draft storage."));
  req.onsuccess=()=>resolve(req.result);
  req.onblocked=()=>reject(new Error("Close other Rainbow tabs to update offline drafts."));
 });
}
async function withStore(mode,fn,indexedDB){
 const db=await openDraftDB(indexedDB);
 return new Promise((resolve,reject)=>{
  let request;let result;let settled=false;
  const tx=db.transaction(DRAFT_STORE,mode);
  const store=tx.objectStore(DRAFT_STORE);
  try{request=fn(store);}catch(e){db.close();reject(e);return;}
  if(request){
   request.onsuccess=()=>{result=request.result;};
   request.onerror=()=>{if(!settled){settled=true;db.close();reject(request.error||new Error("Offline draft storage request failed."));}};
  }
  tx.oncomplete=()=>{if(!settled){settled=true;db.close();resolve(result);}};
  tx.onabort=()=>{if(!settled){settled=true;db.close();reject(tx.error||new Error("Offline draft write aborted."));}};
  tx.onerror=()=>{};
 });
}
export function saveDraft(draft,indexedDB){
 if(draft?.kind!=="UNSUBMITTED_CART_DRAFT"||draft.status!=="draft")
  return Promise.reject(new Error("Only unfinished cart drafts may be saved."));
 const clean=createDraftRecord(draft.lines,{id:draft.id,createdAt:draft.createdAt});
 return withStore("readwrite",store=>store.add(clean),indexedDB).then(()=>clean);
}
export function getDraft(id,indexedDB){
 return withStore("readonly",store=>store.get(id),indexedDB);
}
export function listDrafts(indexedDB){
 return withStore("readonly",store=>store.getAll(),indexedDB)
  .then(rows=>(rows||[]).sort((a,b)=>b.createdAt-a.createdAt));
}
export function deleteDraft(id,indexedDB){
 return withStore("readwrite",store=>store.delete(id),indexedDB);
}
