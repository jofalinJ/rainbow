/* Rainbow Multi-shop ERP. All writes use authenticated Supabase with RLS or privileged RPCs.
   Staged feature: legacy checkout and local billing still use product_variants.stock_quantity
   until a separately tested migration switches them to location_stock. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uuid = () => crypto.randomUUID();
const format = n => Number(n || 0).toLocaleString("en-IN");
const positiveInt = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 100000;
const isInt = value => /^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value)!==0 && Math.abs(Number(value))<=100000;
const state = {client:null, user:null, admin:false, locations:[], selected:null, listing:null, items:[], stock:[], suppliers:[], csvRows:[], operation:null, busy:false, scanner:null};
function notify(message, error=false) {
 const el=$("erpStatus"); el.textContent=message; el.className="erp-status "+(error?"error":"ok");
}
async function query(promise) {
 const {data,error}=await promise;
 if(error) throw new Error(error.message || "The server refused the request.");
 return data;
}
function options(el, items, placeholder="Choose…") {
 const previous=el.value;
 el.replaceChildren(new Option(placeholder,""));
 for(const item of items) el.add(new Option(item.label,item.id));
 if(items.some(x=>x.id===previous))el.value=previous;
}
function chosenLocation() { return state.locations.find(x=>x.id===$("erpLocation").value); }
function imageURL(url) {
 try { const u=new URL(url); return u.protocol==="https:"?u.href:""; } catch { return ""; }
}
function scrubSearch(value) { return String(value || "").trim().replace(/[^\p{L}\p{N}\s/_-]/gu," ").replace(/\s+/g," ").slice(0,70); }
async function refreshLocations() {
 const rows=await query(state.client.from("erp_locations").select("id,code,name,kind,branch_id").eq("active",true).order("name"));
 state.locations=rows || [];
 options($("erpLocation"),rows.map(x=>({id:x.id,label:x.name+" ("+x.kind+")"})),"Select working location");
 if(rows.length && !$("erpLocation").value)$("erpLocation").value=rows.find(x=>x.kind==="branch")?.id||rows[0].id;
 options($("erpDestination"),rows.map(x=>({id:x.id,label:x.name})),"Choose destination");
 if(state.admin) {
  options($("erpStaffShop"),rows.filter(x=>x.kind==="branch").map(x=>({id:x.id,label:x.name})),"Choose staff shop");
  options($("erpPurchaseDestination"),rows.filter(x=>x.kind==="branch").map(x=>({id:x.id,label:x.name})),"Choose receiving shop");
 }
}
async function search() {
 const term=scrubSearch($("erpSearch").value);
 if(term.length<2){$("erpMatches").textContent="Enter at least two characters.";return;}
 $("erpMatches").textContent="Searching shared catalogue…";
 try {
  const lookup=await Promise.all([
    query(state.client.from("products").select("id,product_code,product_name,product_images(public_url,is_primary,sort_order)").or("product_code.ilike.%"+term+"%,product_name.ilike.%"+term+"%").order("created_at",{ascending:false}).limit(15)),
    query(state.client.from("product_variants").select("product_id").ilike("barcode","%"+term+"%").limit(15))
  ]);
  const productIds=[...new Set([...(lookup[0]||[]).map(x=>x.id),...(lookup[1]||[]).map(x=>x.product_id)])].slice(0,24);
  if(!productIds.length){$("erpMatches").textContent="No match. Create the product once in the Products page.";return;}
  const [products,variants]=await Promise.all([
   query(state.client.from("products").select("id,product_code,product_name,product_images(public_url,is_primary,sort_order)").in("id",productIds)),
   query(state.client.from("product_variants").select("id,product_id,color,size,length_cm,barcode,active").in("product_id",productIds).eq("active",true).limit(100))
  ]);
  state.items=(variants||[]).map(v=>({v,p:products.find(p=>p.id===v.product_id)})).filter(x=>x.p);
  const view=$("erpMatches");view.replaceChildren();
  if(!state.items.length) {view.textContent="No active variants found.";return;}
  for(const pair of state.items) {
   const {v,p}=pair;
   const card=document.createElement("article");card.className="erp-match";
   const photos=(p.product_images||[]).slice().sort((a,b)=>Number(b.is_primary)-Number(a.is_primary)||a.sort_order-b.sort_order);
   const src=imageURL(photos[0]?.public_url);
   if(src){const img=document.createElement("img");img.src=src;img.loading="lazy";img.alt=p.product_name;card.append(img);}
   const info=document.createElement("div");
   info.innerHTML="<b>"+esc(p.product_name)+"</b><br><small>"+esc(p.product_code)+" · "+esc([v.color,v.size,v.length_cm!=null?v.length_cm+" cm":null].filter(x=>x&&x!=="0").join(" / "))+"</small><br><small>Barcode: "+esc(v.barcode||"—")+"</small>";
   const button=document.createElement("button");button.type="button";button.textContent="Select existing";
   button.addEventListener("click",()=>selectVariant(pair));
   card.append(info,button);view.append(card);
  }
 } catch (e) { $("erpMatches").textContent="Search failed: "+e.message; }
}
async function selectVariant(pair) {
 state.selected=pair;$("erpSelected").hidden=false;
 const {v,p}=pair;
 $("erpProductTitle").textContent=p.product_name;
 $("erpProductMeta").textContent=p.product_code+" · "+[v.color,v.size,v.length_cm!=null?v.length_cm+" cm":null].filter(x=>x&&x!=="0").join(" · ");
 const images=$("erpImages");images.replaceChildren();
 for(const row of (p.product_images||[]).slice(0,5)) {
  const src=imageURL(row.public_url);
  if(!src)continue;
  const img=document.createElement("img");img.src=src;img.alt=p.product_name;img.loading="lazy";images.append(img);
 }
 options($("erpPurchaseVariant"),[{id:v.id,label:p.product_code+" · "+p.product_name}],"Selected product variant");
 $("erpPurchaseVariant").value=v.id;
 await refreshSelected();
 notify("Existing product selected. Images and product details are reused.");
}
async function refreshSelected() {
 if(!state.selected)return;
 const vid=state.selected.v.id;
 const [balances,transfers,listing]=await Promise.all([
 query(state.client.from("erp_stock_balances").select("location_id,on_hand,reserved").eq("variant_id",vid)),
 query(state.client.from("erp_transfers").select("quantity,to_location").eq("variant_id",vid).eq("status","in_transit").limit(1000)),
 state.admin?query(state.client.from("erp_online_listings").select("published,online_price").eq("product_id",state.selected.p.id).maybeSingle()):Promise.resolve(null)
 ]);
 state.stock=balances||[];state.listing=listing;
 const here=state.stock.find(x=>x.location_id===$("erpLocation").value);
 const online=state.locations.find(x=>x.kind==="online");
 const onlineRow=state.stock.find(x=>x.location_id===online?.id);
 $("erpShopStock").textContent=format((here?.on_hand||0)-(here?.reserved||0));
 $("erpTotalStockLabel").textContent=state.admin?"Company-owned stock":"Stock visible to your role";
 $("erpTotalStock").textContent=format(state.stock.reduce((sum,x)=>sum+x.on_hand,0)+(transfers||[]).reduce((sum,x)=>sum+x.quantity,0));
 $("erpOnlineStock").textContent=format((onlineRow?.on_hand||0)-(onlineRow?.reserved||0));
 $("erpTransitStock").textContent=format((transfers||[]).reduce((sum,x)=>sum+x.quantity,0));
 const breakdown=$("erpBranchBreakdown");breakdown.replaceChildren();
 for(const location of state.locations) {
   const bal=state.stock.find(x=>x.location_id===location.id);
   const inbound=(transfers||[]).filter(x=>x.to_location===location.id).reduce((sum,x)=>sum+x.quantity,0);
   const row=document.createElement("article");
   const title=document.createElement("strong");title.textContent=location.name+(location.kind==="online"?" · Online":" · Branch");
   const meta=document.createElement("div");meta.className="erp-muted";
   meta.textContent="On hand: "+format(bal?.on_hand||0)+" · Reserved: "+format(bal?.reserved||0)+
     " · Available: "+format((bal?.on_hand||0)-(bal?.reserved||0))+
     (inbound?" · Inbound: "+format(inbound):"");
   row.append(title,meta);breakdown.append(row);
 }
 if(!state.admin){
   const hint=document.createElement("p");hint.className="erp-muted";
   hint.textContent="Other shops may have stock that your role cannot view.";
   breakdown.append(hint);
 }
 if(state.admin) {
  $("erpPublished").checked=Boolean(listing?.published);
  $("erpOnlinePrice").value=listing?.online_price??"";
 }
}
async function reloadPending() {
 const loc=chosenLocation();
 if(!loc)return;
 const pending=await query(state.client.from("erp_transfers")
 .select("id,quantity,reason,dispatched_at,from_location,variant_id").eq("to_location",loc.id)
 .eq("status","in_transit").order("dispatched_at",{ascending:false}).limit(40));
 const target=$("erpPendingTransfers");target.replaceChildren();
 if(!pending?.length){target.textContent="No outstanding transfers to this location.";return;}
 for(const row of pending){
  const article=document.createElement("article");
  const source=state.locations.find(x=>x.id===row.from_location);
  const desc=document.createElement("div");
  desc.textContent=format(row.quantity)+" units from "+(source?.name||"another shop")+" · "+row.reason+" · "+new Date(row.dispatched_at).toLocaleString("en-IN");
  const button=document.createElement("button");button.textContent="Confirm receipt";button.type="button";
  button.addEventListener("click",async()=>{
   if(button.disabled)return;button.disabled=true;
   try{await query(state.client.rpc("erp_receive_transfer",{p_transfer:row.id}));notify("Transfer received and logged.");await Promise.all([reloadPending(),refreshSelected()]);}
   catch(e){notify(e.message,true);}finally{button.disabled=false;}
  });
  article.append(desc,button);target.append(article);
 }
}
async function saveAdjustment(event) {
 event.preventDefault();const loc=chosenLocation(),v=state.selected?.v;
 const change=$("erpDelta").value.trim(),reason=$("erpReason").value.trim();
 if(!loc||!v||!isInt(change)||reason.length<8||reason.length>240){notify("Choose a product and enter a valid quantity and reason.",true);return;}
 const signature=[loc.id,v.id,change,reason].join("|");
 if(!state.operation||state.operation.signature!==signature)state.operation={signature,request:uuid()};
 const button=$("erpAdjustSave");button.disabled=true;
 try{
 const result=await query(state.client.rpc("erp_adjust_stock",{
  p_location:loc.id,p_variant:v.id,p_delta:Number(change),p_reason:reason,p_request:state.operation.request
 }));
 notify(result.already_applied?"Request was already recorded. Stock was not added again.":"Stock saved. New stock: "+result.stock);
 state.operation=null;$("erpDelta").value="";$("erpReason").value="";
 await Promise.all([refreshSelected(),reloadSummary()]);
 }catch(e){notify(e.message+" Retry with the same values if the connection dropped.",true);}
 finally{button.disabled=false;}
}
async function dispatchTransfer(event) {
 event.preventDefault();const from=chosenLocation()?.id,to=$("erpDestination").value,v=state.selected?.v;
 const qty=$("erpTransferQty").value,reason=$("erpTransferReason").value.trim();
 if(!from||!to||from===to||!v||!positiveInt(qty)||reason.length<8){notify("Choose a different destination, quantity and reason.",true);return;}
 const btn=$("erpTransferSave");btn.disabled=true;
 const sig=[from,to,v.id,qty,reason].join("|");
 if(!btn.dataset.sig||btn.dataset.sig!==sig){btn.dataset.sig=sig;btn.dataset.request=uuid();}
 try{
  const result=await query(state.client.rpc("erp_dispatch_transfer",{
   p_from:from,p_to:to,p_variant:v.id,p_quantity:Number(qty),p_reason:reason,p_request:btn.dataset.request
  }));
  notify("Stock dispatched; transfer "+result.transfer_id+" awaits confirmation.");
  delete btn.dataset.sig;delete btn.dataset.request;
  $("erpTransferQty").value="";$("erpTransferReason").value="";
  await Promise.all([refreshSelected(),reloadPending(),reloadSummary()]);
 }catch(e){notify(e.message+" Retry unchanged details to prevent duplication.",true);}
 finally{btn.disabled=false;}
}
async function publish() {
 if(!state.admin||!state.selected)return;
 const raw=$("erpOnlinePrice").value.trim();
 const value=raw===""?null:Number(raw);
 if(value!==null&&(!Number.isFinite(value)||value<0||! /^\d+(\.\d{1,2})?$/.test(raw))){notify("Enter a valid rupee price.",true);return;}
 const button=$("erpPublishBtn");button.disabled=true;
 try{
  await query(state.client.from("erp_online_listings").upsert({
   product_id:state.selected.p.id,published:$("erpPublished").checked,
   online_price:value,updated_by:state.user.id,updated_at:new Date().toISOString()
  },{onConflict:"product_id"}));
  notify("Online listing settings saved in the new ERP catalogue. Legacy storefront is unchanged until cutover.");
 }catch(e){notify(e.message,true);}
 finally{button.disabled=false;}
}
async function loadStaff() {
 const staff=await query(state.client.from("staff_profiles").select("user_id,full_name,role,active").eq("active",true).order("full_name").limit(250));
 options($("erpStaff"),staff.map(x=>({id:x.user_id,label:x.full_name+" ("+x.role+")"})),"Choose staff");
 const mappings=await query(state.client.from("erp_staff_locations").select("user_id,location_id").limit(500));
 $("erpAssignments").textContent=(mappings||[]).map(m=>{
 const person=staff.find(x=>x.user_id===m.user_id)?.full_name||m.user_id.slice(0,8);
 return person+" → "+(state.locations.find(x=>x.id===m.location_id)?.name||"Unknown shop");
 }).join(" · ")||"No assigned staff yet.";
}
async function assignStaff() {
 const user_id=$("erpStaff").value,location_id=$("erpStaffShop").value;
 if(!user_id||!location_id){notify("Select staff and shop.",true);return;}
 try{
 await query(state.client.from("erp_staff_locations").insert({user_id,location_id}));
 notify("Shop permission assigned.");await loadStaff();
 }catch(e){notify(e.message,true);}
}
async function reloadSummary() {
 if(!state.admin)return;
 try{
  const summary=await query(state.client.rpc("erp_dashboard_snapshot"));
  const target=$("erpSummary");target.replaceChildren();
  for(const [label,value] of [
   ["Master products",summary.master_products],
   ["Locations",summary.locations],
   ["On hand (all locations)",summary.on_hand],
   ["Reserved online",summary.reserved],
   ["In transit",summary.in_transit],
   ["Low-stock variants",summary.low_stock],
   ["Pending transfers",summary.pending_transfers]
  ]){const row=document.createElement("article");row.textContent=label+": "+format(value);target.append(row);}
 }catch(e){$("erpSummary").textContent="Dashboard unavailable: "+e.message;}
}
async function loadSuppliers() {
 state.suppliers=await query(state.client.from("erp_suppliers").select("id,name").eq("active",true).order("name").limit(250))||[];
 options($("erpSupplierSelect"),state.suppliers.map(x=>({id:x.id,label:x.name})),"Choose supplier");
}
async function saveSupplier(event) {
 event.preventDefault();const name=$("erpSupplierName").value.trim(),phone=$("erpSupplierPhone").value.trim();
 if(name.length<2||name.length>160){notify("Supplier name must be 2–160 characters.",true);return;}
 const button=event.submitter;button.disabled=true;
 try{
 await query(state.client.from("erp_suppliers").insert({name,phone:phone||null}));
 event.target.reset();await loadSuppliers();notify("Supplier created.");
 }catch(e){notify(e.message,true);}finally{button.disabled=false;}
}
async function makePurchase(event) {
 event.preventDefault();const supplier_id=$("erpSupplierSelect").value,destination_id=$("erpPurchaseDestination").value;
 const variant_id=$("erpPurchaseVariant").value,qty=$("erpPurchaseQty").value,price=$("erpPurchaseCost").value;
 if(!supplier_id||!destination_id||!variant_id||!positiveInt(qty)||! /^\d+(\.\d{1,2})?$/.test(price)){notify("Invalid purchase order values.",true);return;}
 const button=event.submitter;button.disabled=true;
 try{
  const order=await query(state.client.from("erp_purchase_orders").insert({
   supplier_id,destination_id,status:"draft",created_by:state.user.id
  }).select("id").single());
  await query(state.client.from("erp_purchase_lines").insert({
   purchase_id:order.id,variant_id,ordered_qty:Number(qty),unit_cost:Number(price)
  }));
  await query(state.client.rpc("erp_submit_purchase",{p_purchase:order.id}));
  notify("Purchase order created and submitted.");await loadPurchases();
 }catch(e){notify("Purchase may be left as draft if a step failed: "+e.message,true);}
 finally{button.disabled=false;}
}
async function loadPurchases() {
 if(!state.admin)return;
 const rows=await query(state.client.from("erp_purchase_orders")
 .select("id,status,created_at,erp_suppliers(name),erp_purchase_lines(id,variant_id,ordered_qty,received_qty,unit_cost)")
 .order("created_at",{ascending:false}).limit(30));
 const target=$("erpPurchases");target.replaceChildren();
 if(!rows?.length){target.textContent="No purchase orders yet.";return;}
 for(const order of rows) {
 const article=document.createElement("article");
 const title=document.createElement("b");
 title.textContent=(order.erp_suppliers?.name||"Supplier")+" · "+order.status+" · "+new Date(order.created_at).toLocaleDateString("en-IN");
 article.append(title);
 for(const line of order.erp_purchase_lines||[]) {
  const div=document.createElement("div");div.className="erp-search-row";
  const desc=document.createElement("span");
  desc.textContent="Variant "+line.variant_id.slice(0,8)+" · "+line.received_qty+"/"+line.ordered_qty+" received · ₹"+line.unit_cost;
  div.append(desc);
  if(["ordered","partial"].includes(order.status) && line.received_qty<line.ordered_qty) {
   const input=document.createElement("input");input.type="number";input.min="1";input.max=String(line.ordered_qty-line.received_qty);
   input.step="1";input.value=String(line.ordered_qty-line.received_qty);input.style.maxWidth="115px";
   const button=document.createElement("button");button.type="button";button.textContent="Receive";
   let key=uuid(),prev=input.value;
   input.addEventListener("input",()=>{if(input.value!==prev){key=uuid();prev=input.value;}});
   button.addEventListener("click",async()=>{
    if(!positiveInt(input.value)||Number(input.value)>line.ordered_qty-line.received_qty){notify("Quantity exceeds remaining purchase order.",true);return;}
    button.disabled=true;
    try{await query(state.client.rpc("erp_receive_purchase",{p_line:line.id,p_qty:Number(input.value),p_request:key}));
    notify("Supplier receipt recorded.");await Promise.all([loadPurchases(),refreshSelected(),reloadSummary()]);}
    catch(e){notify(e.message+" Retry unchanged receipt to avoid duplication.",true);button.disabled=false;}
   });
   div.append(input,button);
  }
  article.append(div);
 }
 target.append(article);
 }
}
function csvFromText(text) {
 if(!window.RainbowAdminCatalogue?.csvParse)throw Error("CSV parser unavailable.");
 const rows=window.RainbowAdminCatalogue.csvParse(text);
 if(rows.length<2||rows.length>201)throw Error("CSV must have 1–200 data rows.");
 const head=rows[0].map(x=>x.trim().toLowerCase());
 if(!head.includes("quantity")||!head.includes("reason")||!(head.includes("product_code")||head.includes("barcode")))
 throw Error("Required columns: quantity, reason, plus product_code or barcode.");
 if(new Set(head).size!==head.length)throw Error("Duplicate column heading.");
 return rows.slice(1).map((row,i)=>{
 const get=k=>String(row[head.indexOf(k)]||"").trim();
 return {number:i+2,code:head.includes("product_code")?get("product_code"):"",barcode:head.includes("barcode")?get("barcode"):"",
 qty:get("quantity"),reason:get("reason"),request:uuid(),status:"pending"};
 });
}
async function validateCsv() {
 if(!state.admin){notify("Admin only.",true);return;}
 const file=$("erpCsv").files?.[0];
 if(!file){notify("Select a CSV file.",true);return;}
 $("erpCommitCsv").disabled=true;$("erpCsvPreview").textContent="Validating…";
 try{
 const rows=csvFromText(await file.text());
 const codes=[...new Set(rows.map(x=>x.code).filter(Boolean))];
 const barcodes=[...new Set(rows.map(x=>x.barcode).filter(Boolean))];
 const [products,byBarcode]=await Promise.all([
 codes.length?query(state.client.from("products").select("id,product_code,product_name").in("product_code",codes).limit(500)):Promise.resolve([]),
 barcodes.length?query(state.client.from("product_variants").select("id,product_id,barcode").in("barcode",barcodes).limit(500)):Promise.resolve([])
 ]);
 const ids=[...new Set((products||[]).map(p=>p.id))];
 const variants=ids.length?await query(state.client.from("product_variants").select("id,product_id,barcode").in("product_id",ids).limit(500)): [];
 const seen=new Set();
 for(const row of rows){
 const product=products.find(x=>x.product_code===row.code);
 const matched=byBarcode.find(x=>x.barcode===row.barcode);
 const fromProduct=variants.filter(x=>x.product_id===product?.id);
 let candidate=row.barcode?(matched||null):(fromProduct.length===1?fromProduct[0]:null);
 row.variant=candidate?.id||null;
 const problems=[];
 if(!row.code&&!row.barcode)problems.push("Missing code and barcode");
 if(row.code && !product)problems.push("Unknown product code");
 if(row.barcode&&!matched)problems.push("Unknown barcode");
 if(row.barcode&&product&&matched?.product_id!==product.id)problems.push("Code/barcode disagree");
 if(!candidate)problems.push("Missing or ambiguous variant");
 if(!positiveInt(row.qty))problems.push("Quantity must be 1–100000");
 if(row.reason.length<8||row.reason.length>240)problems.push("Reason must be 8–240 characters");
 if(candidate && seen.has(candidate.id))problems.push("Repeated variant; consolidate before importing");
 if(candidate)seen.add(candidate.id);
 row.problems=problems;
 }
 state.csvRows=rows;const errors=rows.filter(x=>x.problems.length);
 $("erpCsvPreview").innerHTML="<p>"+rows.length+" rows; "+errors.length+" invalid. The import applies each validated row separately and reports failures.</p>"+
 "<table><thead><tr><th>Line</th><th>Product</th><th>Qty</th><th>Result</th></tr></thead><tbody>"+
 rows.slice(0,40).map(x=>"<tr><td>"+x.number+"</td><td>"+esc(x.code||x.barcode)+"</td><td>"+esc(x.qty)+"</td><td>"+esc(x.problems.join("; ")||"Ready")+"</td></tr>").join("")+"</tbody></table>";
 $("erpCommitCsv").disabled=errors.length>0||rows.length===0;
 }catch(e){state.csvRows=[];$("erpCsvPreview").textContent=e.message;notify(e.message,true);}
}
async function commitCsv() {
 if(!state.admin||!state.csvRows.length||state.csvRows.some(x=>x.problems?.length))return;
 const loc=chosenLocation();if(!loc){notify("Choose a destination shop.",true);return;}
 const button=$("erpCommitCsv");button.disabled=true;
 let done=0,failed=0;
 for(const row of state.csvRows){
  if(row.status==="done")continue;
  try{
   await query(state.client.rpc("erp_adjust_stock",{
    p_location:loc.id,p_variant:row.variant,p_delta:Number(row.qty),
    p_reason:row.reason,p_request:row.request
   }));
   row.status="done";done++;
  }catch(e){row.status="failed";row.error=e.message;failed++;}
 }
 $("erpCsvPreview").textContent=done+" newly processed; "+failed+" failed. "+
 state.csvRows.filter(x=>x.status==="done").length+" total confirmed. "+
 (failed?"Retry uses the same request IDs in this tab.":"Import complete.");
 notify(failed?"Some rows were not saved; inspect before retrying.":"Stock import completed.",Boolean(failed));
 if(failed)button.disabled=false;
 await Promise.all([refreshSelected(),reloadSummary()]);
}
async function scanBarcode() {
 const button=$("erpScan");const video=$("erpCamera");
 if(state.scanner){state.scanner.stop();return;}
 if(typeof BarcodeDetector==="undefined"||!navigator.mediaDevices?.getUserMedia){
 notify("Camera barcode detection is unavailable on this browser. Enter the barcode manually.",true);return;
 }
 try{
 const detector=new BarcodeDetector({formats:["code_128","ean_13","ean_8","qr_code"]});
 const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
 video.srcObject=stream;video.hidden=false;await video.play();button.textContent="Stop scanner";
 let running=true,last=0;
 const stop=()=>{running=false;stream.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;video.hidden=true;button.textContent="Scan barcode";state.scanner=null;};
 state.scanner={stop};
 const loop=async t=>{
  if(!running)return;
  if(t-last>400){last=t;
   try{const codes=await detector.detect(video);if(codes.length&&running){$("erpSearch").value=codes[0].rawValue;stop();await search();return;}}
   catch {/* Camera detection can fail on a frame; continue. */}
  }
  if(running)requestAnimationFrame(loop);
 };
 requestAnimationFrame(loop);
 }catch(e){notify("Camera not available: "+e.message,true);}
}
async function init() {
 try{
  await window.requireSession();
  state.client=window.bootSupabase();
  state.user=await window.getAuthUser();
  const profile=await window.getMyProfile();
  state.admin=Boolean(profile.active&&profile.role==="admin");
  $("erpRole").textContent=state.admin?"Super Admin":"Authorized Staff";
  $("erpAdminTools").hidden=!state.admin;
  $("erpOnlinePanel").hidden=!state.admin;
  await refreshLocations();
  if(!state.locations.length){notify("No shops assigned. Ask the admin to assign your staff account.",true);return;}
  $("erpLocation").addEventListener("change",()=>{if(state.selected)refreshSelected().catch(e=>notify(e.message,true));reloadPending().catch(e=>notify(e.message,true));});
  $("erpSearchBtn").addEventListener("click",search);
  $("erpSearch").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();search();}});
  $("erpScan").addEventListener("click",scanBarcode);
  $("erpAdjustForm").addEventListener("submit",saveAdjustment);
  $("erpTransferForm").addEventListener("submit",dispatchTransfer);
  $("erpRefreshTransfers").addEventListener("click",()=>reloadPending().catch(e=>notify(e.message,true)));
  $("erpPublishBtn").addEventListener("click",publish);
  if(state.admin){
   $("erpAssignBtn").addEventListener("click",assignStaff);
   $("erpRefreshSummary").addEventListener("click",reloadSummary);
   $("erpSupplierForm").addEventListener("submit",saveSupplier);
   $("erpPurchaseForm").addEventListener("submit",makePurchase);
   $("erpValidateCsv").addEventListener("click",validateCsv);
   $("erpCommitCsv").addEventListener("click",commitCsv);
   $("erpCsv").addEventListener("change",()=>{state.csvRows=[];$("erpCommitCsv").disabled=true;$("erpCsvPreview").textContent="Select Preview CSV to validate.";});
   await Promise.all([loadStaff(),loadSuppliers(),loadPurchases(),reloadSummary()]);
  }
  await reloadPending();notify("ERP inventory loaded. Choose an existing product to update its shop stock.");
  window.addEventListener("pagehide",()=>state.scanner?.stop(),{once:true});
 }catch(e){notify("ERP unavailable: "+e.message+". No changes have been made.",true);console.warn("ERP boot failed",e);}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
