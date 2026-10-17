/* Rainbow procurement: client-side entry only. All authority and stock writes live
 * in security-definer database functions. This page never updates stock directly. */
const purchasingClient=bootSupabase();
const $p=id=>document.getElementById(id);
const state={suppliers:[],variants:[],orders:[],role:"",busy:false};
const HOLD_PO="rainbow.purchasing.pendingPO.v1";
const HOLD_GRN="rainbow.purchasing.pendingGRN.v1";
function readHold(key){
 try{const raw=sessionStorage.getItem(key);return raw?JSON.parse(raw):null;}
 catch{return null;}
}
function writeHold(key,data){
 try{if(data)sessionStorage.setItem(key,JSON.stringify(data));else sessionStorage.removeItem(key);}
 catch{throw new Error("Session storage is required to safely preserve unconfirmed purchase operations.");}
}
function message(id,text,isError=false){
 const element=$p(id);if(!element)return;
 element.textContent=text;element.toggleAttribute("data-error",isError);
}
function option(value,label){
 const node=document.createElement("option");
 node.value=String(value);node.textContent=label;return node;
}
function tdText(text){
 const el=document.createElement("td");
 el.textContent=String(text??"—");return el;
}
function prettyDate(date){
 const d=new Date(date);
 return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("en-IN");
}
function productLabel(v){
 const p=v.products||{};
 return [p.product_code,p.product_name,v.color,v.size].filter(Boolean).join(" · ");
}
function addPoLine(){
 if(readHold(HOLD_PO)||state.busy)return;
 const row=document.createElement("tr");
 const c1=document.createElement("td"),c2=document.createElement("td"),
       c3=document.createElement("td"),c4=document.createElement("td");
 const sku=document.createElement("select");sku.className="purchase-sku";sku.required=true;
 sku.append(option("","Choose product / variant"));
 for(const v of state.variants)sku.append(option(v.id,productLabel(v)));
 const qty=document.createElement("input");qty.type="number";qty.min="1";qty.max="100000";qty.step="1";qty.required=true;qty.value="1";qty.className="purchase-qty";
 const cost=document.createElement("input");cost.type="number";cost.min="0";cost.max="99999999.99";cost.step="0.01";cost.required=true;cost.value="0.00";cost.className="purchase-cost";
 const remove=document.createElement("button");remove.type="button";remove.textContent="Remove";
 remove.addEventListener("click",()=>{if(!readHold(HOLD_PO)&&!state.busy)row.remove();});
 c1.append(sku);c2.append(qty);c3.append(cost);c4.append(remove);
 row.append(c1,c2,c3,c4);$p("poDraftLines").append(row);
}
function buildPoPayload(){
 const rows=[...$p("poDraftLines").querySelectorAll("tr")];
 if(!rows.length)throw new Error("Add at least one product.");
 const items=rows.map(tr=>{
  const variant_id=tr.querySelector(".purchase-sku").value;
  const quantity=Number(tr.querySelector(".purchase-qty").value);
  const unit_cost=Number(tr.querySelector(".purchase-cost").value);
  if(!variant_id||!Number.isInteger(quantity)||quantity<1||quantity>100000||
     !Number.isFinite(unit_cost)||unit_cost<0||unit_cost>99999999.99||
     Math.round(unit_cost*100)!==unit_cost*100)
   throw new Error("Check product, integer quantity and unit cost (two decimals maximum).");
  return {variant_id,quantity,unit_cost:unit_cost.toFixed(2)};
 });
 if(new Set(items.map(i=>i.variant_id)).size!==items.length)
   throw new Error("Use each product variant only once per purchase order.");
 if(items.length>50)throw new Error("Limit a purchase order to 50 distinct product variants.");
 const supplierId=$p("poSupplier").value;
 if(!supplierId)throw new Error("Select a supplier first.");
 return {p_operation_id:crypto.randomUUID(),p_supplier_id:supplierId,
  p_items:items,p_notes:$p("poNote").value.trim()||null};
}
function openOrders(){
 return state.orders.filter(o=>["ordered","partially_received"].includes(o.status));
}
function receivedQty(po,variantId){
 return (po.goods_receipts||[]).flatMap(g=>g.goods_receipt_lines||[])
  .filter(line=>line.variant_id===variantId)
  .reduce((n,line)=>n+Number(line.quantity_received||0),0);
}
function selectedOrder(){
 return state.orders.find(o=>o.id===$p("grnOrder").value);
}
function renderReceiptLines(){
 const tbody=$p("grnDraftLines");tbody.replaceChildren();
 const po=selectedOrder();
 if(!po){tbody.append(rowMessage("Choose an open purchase order.",4));return;}
 for(const line of po.purchase_order_lines||[]){
  const remaining=Number(line.quantity_ordered)-receivedQty(po,line.variant_id);
  if(remaining<=0)continue;
  const tr=document.createElement("tr");
  const v=state.variants.find(p=>p.id===line.variant_id);
  tr.append(tdText(v?productLabel(v):line.variant_id.slice(0,8)),
    tdText(line.quantity_ordered),tdText(receivedQty(po,line.variant_id)));
  const input=document.createElement("input");input.type="number";
  input.min="0";input.max=String(remaining);input.step="1";
  input.value=String(remaining);input.dataset.variantId=line.variant_id;
  input.setAttribute("aria-label","Quantity received for "+(v?productLabel(v):"variant"));
  const cell=document.createElement("td");cell.append(input);tr.append(cell);tbody.append(tr);
 }
 updateHolds();
}
function rowMessage(text,colspan){
 const tr=document.createElement("tr");const td=tdText(text);td.colSpan=colspan;tr.append(td);return tr;
}
function renderData(){
 const suppliers=$p("poSupplier");const existing=suppliers.value;
 suppliers.replaceChildren(option("","Select supplier"));
 state.suppliers.filter(s=>s.active).forEach(s=>suppliers.append(option(s.id,s.supplier_name)));
 if(state.suppliers.some(s=>s.id===existing&&s.active))suppliers.value=existing;
 const select=$p("grnOrder");const original=select.value;
 select.replaceChildren(option("","Select open PO"));
 for(const po of openOrders()){
  const supplier=state.suppliers.find(s=>s.id===po.supplier_id);
  select.append(option(po.id,po.po_number+" · "+(supplier?.supplier_name||"Supplier")));
 }
 if(openOrders().some(po=>po.id===original))select.value=original;
 const history=$p("poHistory");history.replaceChildren();
 if(!state.orders.length)history.append(rowMessage("No purchase orders yet.",6));
 for(const po of state.orders){
  const supplier=state.suppliers.find(s=>s.id===po.supplier_id);
  const ordered=(po.purchase_order_lines||[]).reduce((n,line)=>n+Number(line.quantity_ordered),0);
  const received=(po.goods_receipts||[]).flatMap(g=>g.goods_receipt_lines||[])
    .reduce((n,line)=>n+Number(line.quantity_received),0);
  const row=document.createElement("tr");
  [po.po_number,supplier?.supplier_name||"Supplier",ordered,received,po.status,prettyDate(po.created_at)]
    .forEach(value=>row.append(tdText(value)));
  history.append(row);
 }
 renderReceiptLines();
 updateHolds();
}
async function fetchRows(query,label){
 const {data,error}=await query;
 if(error)throw new Error("Cannot load "+label+": "+error.message);
 return data||[];
}
async function refreshData(){
 const [suppliers,variants,orders]=await Promise.all([
  fetchRows(purchasingClient.from("suppliers").select("id,supplier_name,active").order("supplier_name"),"suppliers"),
  fetchRows(purchasingClient.from("product_variants")
   .select("id,color,size,products(product_code,product_name)")
   .eq("active",true).limit(2000),"product variants"),
  fetchRows(purchasingClient.from("purchase_orders").select(
   "id,po_number,status,supplier_id,created_at,purchase_order_lines(variant_id,quantity_ordered,unit_cost),goods_receipts(id,grn_number,goods_receipt_lines(variant_id,quantity_received))"
  ).order("created_at",{ascending:false}).limit(250),"purchase orders")
 ]);
 state.suppliers=suppliers;state.variants=variants;state.orders=orders;
 renderData();
 message("purchaseNotice","Loaded "+suppliers.length+" suppliers and "+orders.length+" purchase orders.");
}
function updateHolds(){
 const po=readHold(HOLD_PO),grn=readHold(HOLD_GRN);
 $p("poHold").hidden=!po;$p("grnHold").hidden=!grn;
 $p("submitPo").disabled=state.busy||!!po;
 $p("addPoLine").disabled=state.busy||!!po;
 $p("submitGrn").disabled=state.busy||!!grn;
 $p("poRetry").disabled=state.busy;$p("poClear").disabled=state.busy;
 $p("grnRetry").disabled=state.busy;$p("grnClear").disabled=state.busy;
 $p("supplierForm").querySelectorAll("button").forEach(b=>b.disabled=state.busy);
 for(const formId of ["poForm","grnForm"])
  $p(formId).querySelectorAll("input,select").forEach(el=>{
    el.disabled=state.busy||(formId==="poForm"?!!po:!!grn);
  });
}
async function runOperation(key,method,payload,feedback){
 if(state.busy)return;
 state.busy=true;updateHolds();
 message(feedback,"Submitting securely…");
 try{
  const {data,error}=await purchasingClient.rpc(method,payload);
  if(error)throw error;
  writeHold(key,null);
  message(feedback,(data?.replayed?"Already recorded: ":"Recorded: ")+
    (data?.po_number||data?.grn_number||"Operation completed"));
  try{await refreshData();}catch(loadError){
    message("purchaseNotice","Operation succeeded, but list refresh failed: "+loadError.message,true);
  }
 }catch(error){
  console.error("Purchasing operation could not be confirmed",error?.code||"");
  message(feedback,"Outcome unconfirmed. Retry the SAME operation or review records before clearing the hold. "+(error?.message||""),true);
 }finally{state.busy=false;updateHolds();}
}
async function submitPo(event){
 event.preventDefault();
 if(readHold(HOLD_PO)||state.busy)return;
 try{
  const payload=buildPoPayload();
  writeHold(HOLD_PO,payload);
  await runOperation(HOLD_PO,"create_purchase_order",payload,"poFeedback");
 }catch(error){message("poFeedback",error.message,true);}
}
function buildReceiptPayload(){
 const po=selectedOrder();
 if(!po)throw new Error("Select an open purchase order.");
 const supplier_invoice=$p("grnInvoice").value.trim();
 if(supplier_invoice.length<3||supplier_invoice.length>80)
  throw new Error("Enter a supplier invoice/delivery note number (3–80 characters).");
 const items=[...$p("grnDraftLines").querySelectorAll("input[data-variant-id]")]
 .map(el=>({variant_id:el.dataset.variantId,quantity:Number(el.value)}));
 if(items.some(i=>!Number.isInteger(i.quantity)||i.quantity<0||i.quantity>100000))
  throw new Error("Enter valid quantities, using zero for products not delivered.");
 const selected=items.filter(i=>i.quantity>0);
 if(!selected.length)throw new Error("Receive at least one unit.");
 if(!confirm("Confirm these goods have been physically counted? Recording a GRN immediately increases stock."))return null;
 return {p_receipt_id:crypto.randomUUID(),p_purchase_order_id:po.id,
  p_supplier_invoice:supplier_invoice,p_items:selected};
}
async function submitGrn(event){
 event.preventDefault();if(state.busy||readHold(HOLD_GRN))return;
 try{
  const payload=buildReceiptPayload();
  if(!payload)return;
  writeHold(HOLD_GRN,payload);
  await runOperation(HOLD_GRN,"receive_purchase_order",payload,"grnFeedback");
 }catch(error){message("grnFeedback",error.message,true);}
}
function clearHold(key){
 if(state.busy||!readHold(key))return;
 if(!confirm("Did you review the purchase order / goods receipt records and stock to verify that clearing this request hold is safe? Clearing does not undo a committed operation."))return;
 writeHold(key,null);updateHolds();
 message(key===HOLD_GRN?"grnFeedback":"poFeedback",
 "Hold cleared after manual review. If this operation committed, do not submit it again.",true);
}
async function bootPurchasing(){
 try{
  await requireSession();const profile=await getMyProfile();
  if(!profile.active||!["admin","inventory_staff"].includes(profile.role)){
    location.href="login.html";return;
  }
  state.role=profile.role;
  $p("supplierPanel").hidden=profile.role!=="admin";
  $p("poForm").addEventListener("submit",submitPo);
  $p("grnForm").addEventListener("submit",submitGrn);
  $p("addPoLine").addEventListener("click",addPoLine);
  $p("grnOrder").addEventListener("change",renderReceiptLines);
  $p("purchaseRefresh").addEventListener("click",()=>refreshData().catch(e=>message("purchaseNotice",e.message,true)));
  $p("poRetry").addEventListener("click",()=>{const op=readHold(HOLD_PO);if(op)runOperation(HOLD_PO,"create_purchase_order",op,"poFeedback");});
  $p("grnRetry").addEventListener("click",()=>{const op=readHold(HOLD_GRN);if(op)runOperation(HOLD_GRN,"receive_purchase_order",op,"grnFeedback");});
  $p("poClear").addEventListener("click",()=>clearHold(HOLD_PO));
  $p("grnClear").addEventListener("click",()=>clearHold(HOLD_GRN));
  $p("supplierForm").addEventListener("submit",async event=>{
   event.preventDefault();if(state.busy||state.role!=="admin")return;
   state.busy=true;updateHolds();
   try{
    const {error}=await purchasingClient.rpc("create_supplier",{
     p_name:$p("supplierName").value.trim(),p_phone:$p("supplierPhone").value.trim()||null,
     p_gstin:$p("supplierGstin").value.trim()||null
    });
    if(error)throw error;
    $p("supplierForm").reset();
    message("purchaseNotice","Supplier saved. Refreshing…");
    await refreshData();
   }catch(error){message("purchaseNotice","Supplier creation unconfirmed. Review supplier list before retrying. "+error.message,true);}
   finally{state.busy=false;updateHolds();}
  });
  await refreshData();
  if(readHold(HOLD_GRN))message("grnFeedback","A goods receipt is unresolved. Retry the same receipt or inspect records before clearing the hold.",true);
  if(readHold(HOLD_PO))message("poFeedback","A purchase order is unresolved. Retry the same PO or inspect records before clearing the hold.",true);
  if(!$p("poDraftLines").children.length)addPoLine();
 }catch(error){message("purchaseNotice",error.message,true);}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootPurchasing,{once:true});
else bootPurchasing();
