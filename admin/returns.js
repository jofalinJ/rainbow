/* Return receipt is inventory accounting, NOT payment processing. All
  validation and mutation occur in restricted PostgreSQL functions. */
const rc=bootSupabase(),$r=id=>document.getElementById(id);
const st={orders:[],returns:[],busy:false};
const HOLD_KEY="rainbow.returns.unconfirmed.v1";
function hold(){
 try{const s=sessionStorage.getItem(HOLD_KEY);return s?JSON.parse(s):null;}
 catch{return null;}
}
function saveHold(payload){
 if(payload)sessionStorage.setItem(HOLD_KEY,JSON.stringify(payload));
 else sessionStorage.removeItem(HOLD_KEY);
}
function say(id,message,error=false){
 const el=$r(id);el.textContent=message;el.toggleAttribute("data-error",error);
}
function elem(tag,text){
 const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;
}
function choice(value,label){
 const o=elem("option",label);o.value=String(value);return o;
}
function linesFor(order){
 return order?.order_items||[];
}
function returnedCount(orderItemId){
 return st.returns.flatMap(r=>r.customer_return_lines||[])
  .filter(line=>line.order_item_id===orderItemId)
  .reduce((n,line)=>n+Number(line.quantity||0),0);
}
function renderOrders(){
 const select=$r("returnOrder"),prev=select.value;
 select.replaceChildren(choice("","Select paid sale"));
 for(const o of st.orders.filter(o=>o.payment_status==="paid"&&!["cancelled","refunded"].includes(o.status))){
  select.append(choice(o.id,o.order_number+" · ₹"+Number(o.total_amount||0).toFixed(2)));
 }
 if([...select.options].some(o=>o.value===prev))select.value=prev;
 renderLines();
 const history=$r("returnHistory");history.replaceChildren();
 for(const r of st.returns){
  const o=st.orders.find(x=>x.id===r.order_id);
  const confirmed=r.customer_refund_confirmations?.[0];
  const tr=elem("tr");
  [new Date(r.received_at).toLocaleString("en-IN"),o?.order_number||r.order_id.slice(0,8),
   (r.customer_return_lines||[]).reduce((n,x)=>n+Number(x.quantity),0),
   "₹"+Number(r.expected_refund||0).toFixed(2),
   !Number(r.expected_refund)?"No refund due":confirmed?"Externally settled":"Pending external settlement",
   r.received_by.slice(0,8)].forEach(x=>tr.append(elem("td",x)));
  history.append(tr);
 }
 if(!st.returns.length){const t=elem("tr"),c=elem("td","No returns yet.");
  c.colSpan=6;t.append(c);history.append(t);}
 const refund=$r("refundReturn"),selected=refund.value;
 refund.replaceChildren(choice("","Select pending return"));
 for(const r of st.returns.filter(x=>Number(x.expected_refund)>0
   &&!(x.customer_refund_confirmations||[]).length)){
  const o=st.orders.find(x=>x.id===r.order_id);
  refund.append(choice(r.id,(o?.order_number||r.id.slice(0,8))+
   " · refund due ₹"+Number(r.expected_refund).toFixed(2)));
 }
 if([...refund.options].some(x=>x.value===selected))refund.value=selected;
 refreshHold();
}
function renderLines(){
 const o=st.orders.find(x=>x.id===$r("returnOrder").value),body=$r("returnLines");
 body.replaceChildren();
 if(!o){const tr=elem("tr"),td=elem("td","Select an original paid order.");
   td.colSpan=5;tr.append(td);body.append(tr);return;}
 for(const line of linesFor(o)){
  const already=returnedCount(line.id),remaining=Number(line.quantity)-already;
  if(remaining<=0)continue;
  const tr=elem("tr");tr.dataset.itemId=line.id;
  [line.product_code+" · "+line.product_name,line.quantity,already].forEach(x=>tr.append(elem("td",x)));
  const qty=elem("input");qty.type="number";qty.min="0";qty.max=String(remaining);
  qty.step="1";qty.value="0";qty.className="returned-qty";
  const cellQty=elem("td");cellQty.append(qty);
  const check=elem("input");check.type="checkbox";check.className="return-restockable";
  check.setAttribute("aria-label","Inspected and sellable: "+line.product_name);
  const checkTd=elem("td");checkTd.append(check);
  tr.append(cellQty,checkTd);body.append(tr);
 }
}
function refreshHold(){
 const unresolved=!!hold();$r("returnHold").hidden=!unresolved;
 $r("receiveReturn").disabled=st.busy||unresolved;
 $r("retryReturn").disabled=st.busy;$r("clearReturnHold").disabled=st.busy;
 $r("confirmRefund").disabled=st.busy;
 for(const el of $r("receiveReturnForm").querySelectorAll("input,select,textarea")){
  el.disabled=st.busy||unresolved;
 }
}
async function readList(query,label){
 const {data,error}=await query;
 if(error)throw new Error(label+": "+error.message);
 return data||[];
}
async function refresh(){
 const [orders,returns]=await Promise.all([
  readList(rc.from("orders").select(
   "id,order_number,status,payment_status,total_amount,order_items(id,variant_id,product_code,product_name,quantity)"
  ).order("created_at",{ascending:false}).limit(300),"Orders"),
  readList(rc.from("customer_returns").select(
   "id,order_id,received_at,received_by,expected_refund,customer_return_lines(order_item_id,quantity,restockable),customer_refund_confirmations(return_id,amount,method,external_reference)"
  ).order("received_at",{ascending:false}).limit(400),"Return records")
 ]);
 st.orders=orders;st.returns=returns;renderOrders();say("returnsNotice","Records refreshed.");
}
function payloadForReturn(){
 const order=$r("returnOrder").value;
 if(!order)throw Error("Choose a paid sale.");
 const lines=[...$r("returnLines").querySelectorAll("tr[data-item-id]")]
  .map(tr=>({order_item_id:tr.dataset.itemId,
   quantity:Number(tr.querySelector(".returned-qty").value),
   restockable:tr.querySelector(".return-restockable").checked}))
  .filter(x=>x.quantity>0);
 if(!lines.length||lines.some(x=>!Number.isInteger(x.quantity)||x.quantity>100000))
  throw Error("Enter a valid positive returned quantity.");
 const reason=$r("returnReason").value.trim();
 if(reason.length<12||reason.length>240)throw Error("Give an inspection reason (12–240 characters).");
 const refund=Number($r("returnAmount").value);
 if(!Number.isFinite(refund)||refund<0||Math.round(refund*100)!==refund*100)
  throw Error("Expected refund needs a valid amount with two decimals.");
 if(!confirm("Have you physically inspected the returned goods and checked the original bill? Only checked SELLABLE items will be restocked."))return null;
 return {p_return_id:crypto.randomUUID(),p_order_id:order,p_lines:lines,
  p_reason:reason,p_expected_refund:refund};
}
async function performReturn(payload){
 if(st.busy)return;
 st.busy=true;refreshHold();
 say("receiveReturnResult","Recording inspected return…");
 try{
  const {data,error}=await rc.rpc("receive_customer_return",payload);
  if(error)throw error;
  saveHold(null);
  say("receiveReturnResult",data.replayed?"Return already recorded. No duplicate stock change.":"Return recorded. Refund remains pending external settlement, if due.");
  try{await refresh();}catch(e){say("returnsNotice","Return committed but refresh failed: "+e.message,true);}
 }catch(e){say("receiveReturnResult",
  "Return outcome unconfirmed. Retry the SAME operation or inspect history. "+(e.message||""),true);}
 finally{st.busy=false;refreshHold();}
}
async function bootReturns(){
 try{
  await requireSession();
  const profile=await getMyProfile();
  if(!profile.active||profile.role!=="admin"){location.href="index.html";return;}
  $r("reloadReturns").addEventListener("click",()=>refresh().catch(e=>say("returnsNotice",e.message,true)));
  $r("returnOrder").addEventListener("change",renderLines);
  $r("receiveReturnForm").addEventListener("submit",e=>{
   e.preventDefault();if(hold()||st.busy)return;
   try{const payload=payloadForReturn();if(!payload)return;
     saveHold(payload);performReturn(payload);
   }catch(err){say("receiveReturnResult",err.message,true);}
  });
  $r("retryReturn").addEventListener("click",()=>{const payload=hold();if(payload)performReturn(payload);});
  $r("clearReturnHold").addEventListener("click",()=>{
   if(!hold()||st.busy)return;
   if(!confirm("Did you inspect the return ledger AND inventory before clearing? This does not undo any committed return."))return;
   saveHold(null);refreshHold();
   say("receiveReturnResult","Hold cleared after reconciliation. Never reissue a recorded return.",true);
  });
  $r("refundForm").addEventListener("submit",async e=>{
   e.preventDefault();if(st.busy)return;
   const id=$r("refundReturn").value;
   if(!id||!$r("refundChecked").checked)return;
   if(!confirm("Was this amount ACTUALLY refunded externally and verified against the bank/UPI/card record or signed cash voucher? This screen does not send money."))return;
   st.busy=true;refreshHold();
   try{
    const {data,error}=await rc.rpc("confirm_customer_refund",{
     p_return_id:id,p_method:$r("refundMethod").value,
     p_reference:$r("refundReference").value.trim(),p_settlement_checked:true
    });
    if(error)throw error;
    say("refundResult",data.replayed?"Settlement was already recorded.":"External refund evidence recorded.");
    await refresh();
   }catch(error){say("refundResult","Confirmation unverified: "+error.message+". Review return record before retrying.",true);}
   finally{st.busy=false;refreshHold();}
  });
  await refresh();
  if(hold())say("receiveReturnResult",
   "A previous return has an unknown outcome. Retry the saved operation or reconcile before clearing.",true);
 }catch(e){say("returnsNotice",e.message||"Unable to load returns.",true);}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootReturns,{once:true});else bootReturns();
