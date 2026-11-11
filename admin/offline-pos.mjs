import {OfflineVault,offlineTotals} from "./offline-pos-core.mjs";
import {syncQueuedSales} from "./offline-pos-sync.mjs";

const $=id=>document.getElementById(id);
const html=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch]));
const fmt=value=>"₹"+Number(value||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
let vault=null,cart=new Map(),syncing=false,lastClient=null,supabaseLoading=null;
let 
function status(message,error=false){
 $("statusPanel").textContent=message;
 $("statusPanel").classList.toggle("error",error);
}
function setConnection(){ $("connectionHint").textContent=navigator.onLine?"Internet detected · automatic sync enabled":"Offline · sales saved only on this device"; }
function calculatePending(state,id){
 return state.pending.filter(s=>s.status!=="synced").reduce((n,s)=>n+
  (s.items||[]).filter(i=>i.variant_id===id).reduce((a,i)=>a+i.quantity,0),0);
}
async function render(){
 if(!vault)return;
 const data=await vault.read();
 $("unlockPanel").hidden=true;$("readyApp").hidden=false;
 const expired=Date.now()>data.expiresAt;
 $("shopBanner").textContent=data.locationName+" · "+(expired?"Offline access expired: reconnect and refresh products.":"Offline cash access until "+new Date(data.expiresAt).toLocaleString("en-IN"))+
  " · This is a provisional cash queue, not a final invoice.";
 $("shopBanner").classList.toggle("error",expired);
 const q=$("offlineSearch").value.trim().toLowerCase();
 const rows=[];
 for(const p of data.catalog)for(const v of p.product_variants){
  const text=[p.product_name,p.product_code,p.type,v.barcode,v.color,v.size].join(" ").toLowerCase();
  if(q&&!text.includes(q))continue;
  const remaining=Math.max(0,v.stock_quantity-calculatePending(data,v.id));
  if(remaining>0)rows.push({p,v,remaining});
 }
 $("productList").innerHTML=rows.slice(0,120).map(({p,v,remaining})=>
  '<div class="product"><div><b>'+html(p.product_name)+'</b><small>'+html(p.product_code)+' · '+fmt(p.selling_price)+' · '+html(v.color==="0"?"Standard":v.color)+' · '+remaining+' left on this device</small></div>'+
  '<button type="button" data-add="'+html(v.id)+'">Add</button></div>').join("")||
  '<p class="muted">No available products in the saved offline snapshot.</p>';
 for(const el of document.querySelectorAll("[data-add]"))el.onclick=()=>{const id=el.dataset.add,record=rows.find(x=>x.v.id===id);
  if(record&&(cart.get(id)||0)<record.remaining){cart.set(id,(cart.get(id)||0)+1);render();}
 };
 const selected=[];
 for(const [id,quantity] of cart){
  const p=data.catalog.find(p=>p.product_variants.some(v=>v.id===id));
  const v=p?.product_variants.find(v=>v.id===id);
  if(p&&v&&quantity>0)selected.push({p,v,quantity,unitPrice:p.selling_price});
 }
 $("cartList").innerHTML=selected.map(x=>'<div class="row"><span>'+html(x.p.product_code)+' · '+html(x.p.product_name)+' × '+x.quantity+'</span>'+
  '<button type="button" data-remove="'+html(x.v.id)+'">Remove</button></div>').join("")||
  '<p class="muted">No products selected.</p>';
 for(const el of document.querySelectorAll("[data-remove]"))el.onclick=()=>{cart.delete(el.dataset.remove);render();};
 $("cartTotal").textContent="Total "+fmt(offlineTotals(selected).total)+" (estimate)";
 $("saveOffline").disabled=expired||!selected.length;
 const pending=data.pending.slice().reverse().slice(0,70);
 $("pendingList").innerHTML=pending.map(s=>{
  const title=s.status==="synced"?"CONFIRMED · "+html(s.receipt?.invoice_number||"Invoice"):
   s.status==="needs_review"?"NEEDS OWNER REVIEW":"PENDING SYNC";
  const invoice=s.status==="synced"&&s.receipt?.public_token
   ?'<a target="_blank" rel="noopener" href="../invoice.html?token='+encodeURIComponent(s.receipt.public_token)+'">View final invoice</a>':"";
  const provisional=s.status!=="synced"?
   '<button type="button" data-print="'+html(s.id)+'">Print provisional receipt</button>':"";
  return '<div><b>'+title+'</b><br><span class="muted">'+html(s.id.slice(0,8))+' · '+html(new Date(s.createdAt).toLocaleString("en-IN"))+
   ' · '+fmt(s.totals.total)+'</span><br>'+html(s.lastError||"")+' '+invoice+provisional+'</div>';
 }).join("")||'<p class="muted">No offline cash records yet.</p>';
 for(const el of document.querySelectorAll("[data-print]"))el.onclick=()=>printOffline(pending.find(s=>s.id===el.dataset.print));
 setConnection();
}
function printOffline(sale){
 if(!sale)return;

 const rows=sale.rows.map(row=>'<div class="row"><span>'+html(row.product_code)+' × '+row.quantity+'</span><b>'+fmt(row.unitPrice*row.quantity)+'</b></div>').join("");
 $("receiptPrint").innerHTML='<h2>RAINBOW GOLD COVERING</h2><p style="text-align:center">SHOP CASH RECORD</p>'+
  '<p class="pending">PENDING SYNC · NOT A TAX INVOICE</p>'+
  '<p>Reference: '+html(sale.id)+'</p><p>Recorded: '+html(new Date(sale.createdAt).toLocaleString("en-IN"))+'</p>'+
  '<p>Shop: '+html(sale.locationId)+'</p>'+rows+
  '<div class="row"><span>Subtotal</span><b>'+fmt(sale.totals.subtotal)+'</b></div>'+
  '<div class="row"><span>Discount</span><b>'+fmt(sale.totals.discount)+'</b></div>'+
  '<div class="row"><span>CGST + SGST</span><b>'+fmt(sale.totals.cgst+sale.totals.sgst)+'</b></div>'+
  '<div class="row"><strong>Provisional total</strong><strong>'+fmt(sale.totals.total)+'</strong></div>'+
  '<p><strong>Cash collected / pending synchronization.</strong></p>'+
  '<p>This record is not a GST invoice. A final invoice is available after the sale is accepted by the shop server.</p>';
 window.print();
}
async function getClient(){
 if(lastClient)return lastClient;
 if(!navigator.onLine)throw new Error("Internet connection unavailable.");
 if(!window.supabase?.createClient){
  supabaseLoading ||=new Promise((resolve,reject)=>{
   const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
   const timeout=setTimeout(()=>{script.remove();reject(new Error("Supabase connection timed out."));},12000);
   script.onload=()=>{clearTimeout(timeout);resolve();};
   script.onerror=()=>{clearTimeout(timeout);reject(new Error("Could not load secure shop login."));};
   document.head.append(script);
  }).finally(()=>{supabaseLoading=null;});
  await supabaseLoading;
 }
 const cfg=window.RAINBOW_SUPABASE_CONFIG;
 if(!cfg?.supabaseUrl||!cfg?.supabasePublishableKey)throw new Error("Shop settings unavailable.");
 lastClient=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
 return lastClient;
}
async function refreshCatalog(client,state){
 const {data:userResult,error:authError}=await client.auth.getUser();
 if(authError||!userResult?.user||userResult.user.id!==state.userId)throw new Error("Sign in to the original staff account before refreshing offline products.");
 const {data:profile,error:pError}=await client.from("staff_profiles")
  .select("role,active").eq("user_id",state.userId).maybeSingle();
 if(pError||!profile?.active||!["admin","cashier"].includes(profile.role))throw new Error("No active billing permission.");
 if(profile.role!=="admin"){
  const {data:assignment,error:aError}=await client.from("erp_staff_locations")
   .select("location_id").eq("user_id",state.userId).eq("location_id",state.locationId).maybeSingle();
  if(aError||!assignment)throw new Error("No longer assigned to this shop.");
 }
 const {data:products,error:pdtError}=await client.from("products")
  .select("id,product_code,product_name,type,selling_price,active,product_variants(id,barcode,color,size,active)")
  .eq("active",true).order("created_at",{ascending:false}).limit(1500);
 if(pdtError)throw pdtError;
 const balances=[];
 for(let page=0;page<100;page++){
  const {data,error}=await client.from("erp_stock_balances")
   .select("variant_id,on_hand,reserved").eq("location_id",state.locationId)
   .range(page*500,page*500+499);
  if(error)throw error;
  balances.push(...data);
  if(data.length<500)break;
  if(page===99)throw new Error("Stock snapshot exceeded safe limit.");
 }
 const byVariant=new Map(balances.map(row=>[row.variant_id,Math.max(0,row.on_hand-row.reserved)]));
 for(const product of products||[])for(const variant of product.product_variants||[]){
  variant.stock_quantity=byVariant.get(variant.id)||0;
 }
 await vault.updateCatalog(products||[]);
 status("Offline products refreshed from the selected shop.");
}
async function syncOnline(force=false){
 if(syncing||!vault||!navigator.onLine)return;
 const data=await vault.read();
 if(!force&&!data.pending.some(s=>s.status==="pending"))return;
 syncing=true;$("syncNow").disabled=true;
 try{
  const client=await getClient();
  const stats=await syncQueuedSales(vault,client,msg=>status(msg));
  if(stats.confirmed)status(stats.confirmed+" offline cash record(s) synchronized. Final invoices issued."+
    (stats.needsReview?" "+stats.needsReview+" need owner review.":""));
  else if(stats.needsReview)status(stats.needsReview+" offline record(s) need owner review.",true);
  else if(stats.delayed)status("Sync delayed. Saved records are safe on this device; retry after reconnect.",true);
  else if(force)status("No new offline sales to sync.");
  if(stats.confirmed)await refreshCatalog(client,await vault.read());
 }catch(error){
  status("Sync not available yet: "+String(error?.message||error)+". Saved records remain on this device.",true);
 }finally{syncing=false;$("syncNow").disabled=false;await render();}
}
$("unlockForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const pass=$("offlinePassphrase").value;
 $("offlinePassphrase").value="";
 try{
  vault=await OfflineVault.unlock(pass);
  await render();
  status("Offline shop unlocked. Cash records stay encrypted on this device until submitted.");
  syncOnline();
 }catch(error){vault=null;status(error.message,true);}
});
$("offlineSearch").addEventListener("input",()=>render());
$("offlineSearch").addEventListener("keydown",async event=>{
 if(event.key!=="Enter"||!vault)return;
 event.preventDefault();
 const data=await vault.read(),input=$("offlineSearch").value.trim().toLowerCase();
 const matches=data.catalog.flatMap(p=>p.product_variants.map(v=>({p,v})))
  .filter(({p,v})=>v.barcode.toLowerCase()===input||p.product_code.toLowerCase()===input)
  .filter(({v})=>v.stock_quantity-calculatePending(data,v.id)>0);
 if(matches.length!==1){status("Barcode must match exactly one available product option. Choose a product from the list.",true);return;}
 const id=matches[0].v.id;
 if((cart.get(id)||0)>=matches[0].v.stock_quantity-calculatePending(data,id)){
  status("Cached stock limit reached. Reconnect to verify current stock.",true);return;
 }
 cart.set(id,(cart.get(id)||0)+1);$("offlineSearch").value="";await render();
});
$("saveOffline").onclick=async()=>{
 if(!vault||!cart.size)return;
 $("saveOffline").disabled=true;
 try{
  const sale=await vault.queue([...cart].map(([variant_id,quantity])=>({variant_id,quantity})),{
   name:$("buyerName").value,whatsapp_number:$("buyerPhone").value
  });
  cart.clear();$("buyerName").value="";$("buyerPhone").value="";
  await render();
  status("Cash record "+sale.id.slice(0,8)+" saved securely. Pending server sync; no final invoice yet.");
  printOffline(sale);
  if(navigator.onLine)syncOnline();
 }catch(error){status(error.message,true);}finally{if(vault)await render();}
};
$("clearOffline").onclick=()=>{cart.clear();render();};
$("syncNow").onclick=()=>syncOnline(true);
$("refreshOffline").onclick=async()=>{
 if(!vault)return;
 try{$("refreshOffline").disabled=true;
  const client=await getClient();
  await refreshCatalog(client,await vault.read());await render();
 }catch(error){status(error.message,true);}finally{$("refreshOffline").disabled=false;}
};
$("lockDevice").onclick=()=>{vault=null;lastClient=null;cart.clear();
 $("readyApp").hidden=true;$("unlockPanel").hidden=false;$("receiptPrint").replaceChildren();status("Offline device locked.");};
window.addEventListener("online",()=>{setConnection();syncOnline();});
window.addEventListener("offline",()=>{setConnection();status("Internet disconnected. Offline cash records remain on this device.");});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncOnline();});
setInterval(()=>{if(vault&&navigator.onLine)syncOnline();},30000);
setConnection();
OfflineVault.exists().then(exists=>{if(!exists)status("Prepare offline billing from the online Billing page first.",true);})
 .catch(error=>status(error.message,true));
