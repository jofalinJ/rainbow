/* Drafts only: never post as a sale, allocate stock or generate invoices. */
const $d=x=>document.getElementById(x),name="rainbow-unsold-drafts-v1";
let database;
function db(){
 if(database)return database;
 database=new Promise((ok,no)=>{
  const req=indexedDB.open(name,1);
  req.onupgradeneeded=()=>req.result.createObjectStore("drafts",{keyPath:"id"});
  req.onsuccess=()=>ok(req.result);
  req.onerror=()=>no(req.error);
 });
 return database;
}
async function operate(mode,action){
 const data=await db();
 return new Promise((ok,no)=>{
  const tx=data.transaction("drafts",mode);
  const request=action(tx.objectStore("drafts"));
  tx.oncomplete=()=>ok(request?.result);
  tx.onerror=()=>no(tx.error);
 });
}
async function refresh(){
 const items=await operate("readonly",store=>store.getAll());
 const root=$d("drafts");root.replaceChildren();
 for(const item of (items||[]).sort((a,b)=>b.time.localeCompare(a.time))){
  const row=document.createElement("p");
  const strong=document.createElement("strong");
  strong.textContent=item.code+" · "+item.qty+" units — DRAFT ONLY";
  const small=document.createElement("small");
  small.textContent=" "+new Date(item.time).toLocaleString("en-IN")+" ";
  const remove=document.createElement("button");remove.textContent="Remove";remove.type="button";
  remove.addEventListener("click",async()=>{
   if(!confirm("Did you check official billing first?"))return;
   try{await operate("readwrite",store=>store.delete(item.id));await refresh();}
   catch(e){$d("status").textContent=e.message;}
  });
  row.append(strong,small,remove);root.append(row);
 }
 if(!items?.length)root.textContent="No drafts stored.";
}
$d("draftForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const code=$d("sku").value.trim().toUpperCase();
 const qty=Number($d("qty").value);
 if(!/^[A-Z0-9][A-Z0-9_.-]{0,59}$/.test(code)||!Number.isInteger(qty)||qty<1||qty>1000){
  $d("status").textContent="Invalid product code or quantity.";return;
 }
 try{
  await operate("readwrite",store=>store.put({
   id:crypto.randomUUID(),code,qty,time:new Date().toISOString(),status:"DRAFT_NOT_SOLD"
  }));
  $d("status").textContent="Saved only on this device; issue official bill online.";
  $d("draftForm").reset();await refresh();
 }catch(e){$d("status").textContent="Local storage error: "+e.message;}
});
$d("deleteAll").addEventListener("click",async()=>{
 if(!confirm("Have you reconciled every stored draft against real bills?"))return;
 try{await operate("readwrite",store=>store.clear());await refresh();}
 catch(e){$d("status").textContent=e.message;}
});
refresh().catch(e=>$d("status").textContent="Local storage unavailable: "+e.message);
