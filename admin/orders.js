import {setupShipmentManagement} from "./shipment-management.mjs";
const ordersClient=bootSupabase();
let allOrders=[];
let ordersLoading=false;
let ordersReloadQueued=false;
let ordersRefreshTimer=null;
let ordersPollTimer=null;
let ordersChannel=null;
let currentRole="";
let shipmentManager=null;

const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const money=x=>{
  const n=Number(x??0);
  return "₹"+(Number.isFinite(n)?n:0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
};
function relationOne(value){return Array.isArray(value)?(value[0]||{}):(value||{});}
function bestPayment(o){
  const rows=Array.isArray(o.payments)?o.payments:o.payments?[o.payments]:[];
  return rows.find(item=>item.status==="paid")||rows.find(item=>item.transaction_reference)||rows[0]||{};
}
function deliveryAddress(o){
  const customer=relationOne(o.customers);
  return [o.shipping_address||customer.address,customer.city,customer.state,customer.pin_code].filter(Boolean).join(", ");
}
function manualStatusChoices(o){
  const current=String(o.status||"pending");
  if(o.payment_status!=="paid"||["delivered","cancelled","refunded"].includes(current))return [current];
  if(current==="pending")return ["pending","confirmed","processing"];
  if(current==="confirmed")return ["confirmed","processing"];
  return [current];
}
let openOrderId="";
let cancelInFlight=false;

function canCancelUnpaidOnlineOrder(o){
  return currentRole==="admin"&&o?.source==="online"&&
    o?.status==="pending"&&o?.payment_status==="pending";
}
function refreshCancelControl(){
  const reason=document.querySelector("#cancelUnpaidReason");
  const attestation=document.querySelector("#cancelPaymentChecked");
  const button=document.querySelector("#cancelUnpaidConfirm");
  if(!button)return;
  const valid=Boolean(reason&&attestation&&
    reason.value.trim().length>=12&&reason.value.trim().length<=240&&
    attestation.checked&&!cancelInFlight);
  button.disabled=!valid;
}

function dateLabel(value){
  if(!value)return "Date unavailable";
  const d=new Date(value);
  return Number.isNaN(d.getTime())?"Date unavailable":d.toLocaleString("en-IN");
}
function setOrdersMessage(message,kind=""){
  const el=document.querySelector("#msg");
  if(el){el.textContent=message;el.className="form-msg "+kind;}
}
function showOrdersError(message){
  const rows=document.querySelector("#rows");
  if(rows)rows.innerHTML="<tr><td colspan='6'>"+esc(message)+"</td></tr>";
  setOrdersMessage(message,"msg-error");
}
function scheduleOrdersRefresh(delay=250){
  if(ordersRefreshTimer)clearTimeout(ordersRefreshTimer);
  ordersRefreshTimer=setTimeout(()=>{ordersRefreshTimer=null;loadOrders({quiet:true});},delay);
}
async function loadOrders({quiet=false}={}){
  const rows=document.querySelector("#rows");
  const refresh=document.querySelector("#refresh");
  if(!rows)return;
  if(ordersLoading){ordersReloadQueued=true;return;}
  ordersLoading=true;
  if(refresh){refresh.disabled=true;refresh.textContent="Refreshing…";}
  if(!quiet)rows.innerHTML="<tr><td colspan='6'>Loading customer orders…</td></tr>";
  const controller=new AbortController();
  let timeoutId;
  try{
    const request=ordersClient.from("orders")
      .select("id,order_number,source,status,payment_status,subtotal,discount_amount,cgst_amount,sgst_amount,delivery_fee,total_amount,shipping_address,created_at,updated_at,customers:customers!orders_customer_id_fkey(name,whatsapp_number,email,address,city,state,pin_code),order_items:order_items!order_items_order_id_fkey(product_code,product_name,quantity,unit_price,line_total,variant_color,variant_size,length_cm,thickness,discount_amount),payments:payments!payments_order_id_fkey(id,method,status,transaction_reference,amount,paid_at,verified_at)")
      .eq("source","online")
      .order("created_at",{ascending:false})
      .abortSignal(controller.signal);
    const timeout=new Promise((resolve,reject)=>{
      timeoutId=setTimeout(()=>{
        controller.abort();
        reject(new Error("The orders request timed out. Check the connection and select Refresh to try again."));
      },15000);
    });
    const {data,error}=await Promise.race([request,timeout]);
    if(error){console.error("Orders fetch error:",error);throw error;}
    console.log("Orders data:",{count:Array.isArray(data)?data.length:0});
    allOrders=Array.isArray(data)?data.filter(row=>row.source==="online"):[];
    render();
    setOrdersMessage(allOrders.length
      ?allOrders.length+" order"+(allOrders.length===1?"":"s")+" loaded · refreshed "+new Date().toLocaleTimeString("en-IN")
      :"No customer orders found.");
  }catch(e){
    console.error("Orders fetch error:",e);
    const message=e?.name==="AbortError"
      ?"The orders request was cancelled or timed out. Check the connection and select Refresh to retry."
      :(e?.message||"Check the connection and staff permissions.");
    showOrdersError("Could not load orders. "+message);
  }finally{
    if(timeoutId)clearTimeout(timeoutId);
    ordersLoading=false;
    if(refresh){refresh.disabled=false;refresh.textContent="Refresh";}
    if(ordersReloadQueued){ordersReloadQueued=false;scheduleOrdersRefresh(0);}
  }
}
function filtered(){
  const search=document.querySelector("#search"),status=document.querySelector("#status");
  const q=String(search?.value||"").toLowerCase().trim(),s=status?.value||"all";
  return allOrders.filter(o=>(s==="all"||o.status===s)&&(!q||[
    o.order_number,relationOne(o.customers).name,relationOne(o.customers).whatsapp_number
  ].some(v=>String(v??"").toLowerCase().includes(q))));
}
function render(){
  const rows=document.querySelector("#rows");if(!rows)return;
  const visibleOrders=filtered();
  const emptyMessage=allOrders.length?"No orders match these filters.":"No customer orders found.";
  rows.innerHTML=visibleOrders.map(o=>{
    const c=relationOne(o.customers);
    const address=deliveryAddress(o);
    const orderLabel=o.order_number||("Order "+String(o.id||"").slice(0,8).toUpperCase());
    const itemCount=Array.isArray(o.order_items)?o.order_items.length:0;
    const verificationDisabled=currentRole!=="admin"||!bestPayment(o).transaction_reference||["cancelled","refunded"].includes(o.status);
    const action=o.payment_status==="paid"
      ?"<button type='button' class='wa' data-wa='"+esc(o.id)+"'>Send full WhatsApp alert</button>"
      :"<button type='button' data-verify='"+esc(o.id)+"' "+(verificationDisabled?"disabled":"")+">Verify payment</button>";
    const shipmentAction=currentRole==="admin"?"<button type='button' class='shipment-action' data-shipment='"+esc(o.id)+"'>Manage Shipment</button>":"";
    return "<tr><td><b>"+esc(orderLabel)+"</b><small>"+esc(dateLabel(o.created_at))+"</small></td>"+
      "<td><b>"+esc(c.name||"—")+"</b><small>"+esc(c.whatsapp_number||c.email||"—")+"</small></td>"+
      "<td>"+esc(address||"—")+"</td>"+
      "<td><b>"+money(o.total_amount)+"</b><small>"+esc(o.payment_status||"—")+"</small></td>"+
      "<td><span class='order-status'>"+esc(o.status||"pending")+"</span></td>"+
      "<td><div class='action-row'><button type='button' data-view='"+esc(o.id)+"'>View"+(itemCount?" ("+itemCount+")":"")+"</button>"+action+shipmentAction+"</div></td></tr>";
  }).join("")||"<tr><td colspan='6'>"+esc(emptyMessage)+"</td></tr>";
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>openOrder(b.dataset.view));
  document.querySelectorAll("[data-wa]").forEach(b=>b.onclick=()=>sendAlert(b.dataset.wa));
  document.querySelectorAll("[data-verify]").forEach(b=>b.onclick=()=>verifyPayment(b.dataset.verify));
  document.querySelectorAll("[data-shipment]").forEach(b=>b.onclick=()=>shipmentManager?.open(b.dataset.shipment,b));
}
function openOrder(id){
  const o=allOrders.find(x=>String(x.id)===String(id));if(!o)return;
  const c=relationOne(o.customers),payment=bestPayment(o);
  const address=deliveryAddress(o);
  const map="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(address);
  openOrderId=String(id);
  document.querySelector("#mTitle").textContent=o.order_number||"Order";
  const itemRows=(Array.isArray(o.order_items)?o.order_items:[]).map(i=>{
    const variant=[
      i.variant_color&&i.variant_color!=="0"?"Color: "+i.variant_color:null,
      i.variant_size&&i.variant_size!=="0"?"Size: "+i.variant_size:null,
      i.length_cm!=null?"Length: "+i.length_cm+" cm":null,
      i.thickness?"Thickness: "+i.thickness:null
    ].filter(Boolean).join(" · ");
    return "<div class='order-item-row'><span><b>"+esc([i.product_code,i.product_name].filter(Boolean).join(" — "))+"</b>"+
      (variant?"<small>"+esc(variant)+"</small>":"")+
      "<small>"+esc(i.quantity??0)+" × "+money(i.unit_price)+
      (Number(i.discount_amount)>0?" · discount "+money(i.discount_amount):"")+"</small></span>"+
      "<strong>"+money(i.line_total)+"</strong></div>";
  }).join("")||"<p>No item details were returned for this order.</p>";
  const canVerify=currentRole==="admin"&&o.payment_status!=="paid"&&
    !["cancelled","refunded"].includes(o.status)&&Boolean(payment.transaction_reference);
  const paymentAction=o.payment_status==="paid"
    ?"<button type='button' class='wa' data-modal-wa='"+esc(o.id)+"'>Send full WhatsApp alert</button>"
    :"<button type='button' data-modal-verify='"+esc(o.id)+"' "+(!canVerify?"disabled":"")+">Verify payment</button>";
  const choices=manualStatusChoices(o),canUpdate=currentRole==="admin"&&choices.length>1;
  const selectOptions=choices.map(status=>"<option value='"+esc(status)+"'"+(status===o.status?" selected":"")+">"+esc(status)+"</option>").join("");
  const mismatch=o.status==="delivered"&&o.payment_status!=="paid";
  const recordedAmount=Number(o.subtotal||0)-Number(o.discount_amount||0)+
    Number(o.cgst_amount||0)+Number(o.sgst_amount||0)+Number(o.delivery_fee||0);
  const amountMismatch=Math.abs(recordedAmount-Number(o.total_amount||0))>0.02;
  const amounts=[["Subtotal",o.subtotal],["Discount",o.discount_amount],["CGST",o.cgst_amount],
    ["SGST",o.sgst_amount],["Delivery",o.delivery_fee],["Order total",o.total_amount]]
    .map(([name,value])=>"<div><span>"+esc(name)+"</span><strong>"+money(value)+"</strong></div>").join("");
  document.querySelector("#mBody").innerHTML=
    (mismatch?"<p class='order-detail-warning'>⚠ Delivered order has no verified payment. Check the original receipt before taking action.</p>":"")+
    (amountMismatch?"<p class='order-detail-warning'>⚠ Stored total differs from the recorded tax, discount, subtotal and delivery figures. Existing data was not changed.</p>":"")+
    "<div class='detail-grid'>"+
    "<div class='detail-box'><span>Placed</span><strong>"+esc(dateLabel(o.created_at))+"</strong></div>"+
    "<div class='detail-box'><span>Status</span><strong>"+esc(o.status||"pending")+"</strong></div>"+
    "<div class='detail-box'><span>Customer</span><strong>"+esc(c.name||"—")+"</strong></div>"+
    "<div class='detail-box'><span>WhatsApp</span><strong>"+esc(c.whatsapp_number||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Email</span><strong>"+esc(c.email||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Delivery address</span><strong>"+esc(address||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Payment status</span><strong>"+esc(o.payment_status||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Payment method</span><strong>"+esc(payment.method||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Transaction reference</span><strong>"+esc(payment.transaction_reference||"Not provided")+"</strong></div>"+
    "<div class='detail-box'><span>Payment verified</span><strong>"+esc(payment.verified_at?dateLabel(payment.verified_at):"Not verified")+"</strong></div>"+
    "<div class='detail-box'><span>Payment amount</span><strong>"+money(payment.amount)+"</strong></div>"+
    "<div class='detail-box'><span>Last updated</span><strong>"+esc(dateLabel(o.updated_at))+"</strong></div></div>"+
    "<h3 class='order-detail-heading'>Ordered items</h3><div class='items'>"+itemRows+"</div>"+
    "<h3 class='order-detail-heading'>Billing breakdown</h3><div class='order-amount-breakdown'>"+amounts+"</div>"+
    "<div class='modal-actions'>"+(address?"<a class='button' href='"+esc(map)+"' target='_blank' rel='noopener noreferrer'>Open delivery location ↗</a>":"")+
       paymentAction+(currentRole==="admin"?"<button type='button' id='manageOrderShipment'>Manage Shipment</button>":"")+"</div>"+
    (canCancelUnpaidOnlineOrder(o)?
      "<section class='order-cancel-panel' aria-label='Cancel unpaid online order'>"+
        "<h3>Cancel unpaid order &amp; release reserved stock</h3>"+
        "<p class='order-detail-warning'>Only use this after checking the actual UPI/bank statement and confirming no money has been received. Orders with recorded shipments or incomplete stock history cannot be cancelled automatically.</p>"+
        "<label for='cancelUnpaidReason'>Cancellation reason (12–240 characters)</label>"+
        "<textarea id='cancelUnpaidReason' rows='3' minlength='12' maxlength='240' placeholder='e.g. Customer cancelled; checked UPI statement and no payment was received'></textarea>"+
        "<label class='cancel-payment-check'><input type='checkbox' id='cancelPaymentChecked'> I personally checked the bank/UPI statement and verified that this order is unpaid.</label>"+
        "<button type='button' id='cancelUnpaidConfirm' disabled>Cancel order &amp; release stock</button>"+
        "<p id='cancelUnpaidFeedback' role='status' aria-live='polite'></p>"+
      "</section>"
      :"")+
    "<div class='order-status-editor'><label for='mStatus'>Manual order status</label>"+
      "<div class='modal-actions'><select id='mStatus' "+(!canUpdate?"disabled":"")+">"+selectOptions+"</select>"+
      "<button type='button' data-save-status "+(!canUpdate?"disabled":"")+">Save status</button></div>"+
      "<small>Verify payment before confirming/processing an order. Use Manage Shipment for dispatch and delivery. Unpaid pending orders may be cancelled using the separate verified-unpaid control. Paid refunds and returns require a separate controlled workflow.</small></div>"+
    "<section class='order-audit'><h3>Shipment and status history</h3><div id='orderHistory' role='status' aria-live='polite'>Loading history…</div></section>";
  document.querySelector("#mStatus").value=o.status||"pending";
  document.querySelector("[data-modal-wa]")?.addEventListener("click",()=>sendAlert(o.id));
  document.querySelector("[data-modal-verify]")?.addEventListener("click",()=>verifyPayment(o.id));
  document.querySelector("[data-save-status]").onclick=()=>updateStatus(o.id);
  document.querySelector("#cancelUnpaidReason")?.addEventListener("input",refreshCancelControl);
  document.querySelector("#cancelPaymentChecked")?.addEventListener("change",refreshCancelControl);
  document.querySelector("#cancelUnpaidConfirm")?.addEventListener("click",()=>cancelUnpaidOrder(o.id));
  if(currentRole==="admin")loadOrderAudit(o.id);
  else document.querySelector("#orderHistory").textContent="Shipment audit history is available to administrators.";
  document.querySelector("#manageOrderShipment")?.addEventListener("click",event=>shipmentManager?.open(o.id,event.currentTarget));
  document.querySelector("#modal").classList.add("open");
  document.querySelector("#modal").setAttribute("aria-hidden","false");
}
async function cancelUnpaidOrder(id){
  if(cancelInFlight||currentRole!=="admin")return;
  const order=allOrders.find(o=>String(o.id)===String(id));
  if(!canCancelUnpaidOnlineOrder(order)||openOrderId!==String(id))return;
  const reason=document.querySelector("#cancelUnpaidReason")?.value.trim()||"";
  const checked=Boolean(document.querySelector("#cancelPaymentChecked")?.checked);
  if(reason.length<12||reason.length>240||!checked){
    const msg=document.querySelector("#cancelUnpaidFeedback");
    if(msg)msg.textContent="Provide a clear reason and confirm the bank/UPI statement was checked.";
    return;
  }
  const label=order.order_number||String(id).slice(0,8);
  if(!confirm("Cancel order "+label+" and restore its reserved stock? You must have checked that no payment was received. This cannot be undone automatically."))return;
  cancelInFlight=true;refreshCancelControl();
  const feedback=document.querySelector("#cancelUnpaidFeedback");
  if(feedback)feedback.textContent="Checking payment and allocation history, then cancelling…";
  try{
    const {data,error}=await ordersClient.rpc("cancel_unpaid_online_order",{
      p_order_id:id,p_reason:reason,p_payment_checked:true
    });
    if(error)throw error;
    if(feedback)feedback.textContent=data?.already_cancelled
      ?"Order was already cancelled; no additional stock was released."
      :"Order cancelled. Stock released for "+Number(data?.released_variants||0)+" variant(s).";
    await loadOrders({quiet:true});
    if(openOrderId===String(id)){
      document.querySelector("#modal")?.classList.remove("open");
      document.querySelector("#modal")?.setAttribute("aria-hidden","true");
      openOrderId="";
    }
  }catch(error){
    console.warn("Unpaid order cancellation could not be confirmed",error?.code||"");
    if(feedback)feedback.textContent="Cancellation not confirmed: "+(error?.message||"Connection error")+
      ". Refresh Orders and inspect the order before attempting again.";
    // A timeout may happen AFTER commit. Preserve the filled reason and force
    // manual refresh/reconciliation rather than assuming a second release.
  }finally{
    cancelInFlight=false;refreshCancelControl();
  }
}

async function verifyPayment(id){
  if(currentRole!=="admin"){alert("Only an admin can verify UPI payments.");return;}
  if(!confirm("Verify the UPI reference against the store's payment receipt before marking this order paid."))return;
  try{
    const {data,error}=await ordersClient.rpc("verify_online_order_payment",{p_order_id:id});
    if(error)throw error;
    document.querySelector("#modal").classList.remove("open");
    document.querySelector("#modal").setAttribute("aria-hidden","true");
    await loadOrders();
    if(data?.already_paid)alert("This payment was already verified.");
    await sendAlert(id);
  }catch(e){alert("Could not verify payment: "+(e?.message||"Unknown error"));}
}
async function loadOrderAudit(id){
  const target=document.querySelector("#orderHistory");
  if(!target)return;
  try{
    const [history,shipment]=await Promise.all([
      ordersClient.from("online_order_status_events").select("previous_status,new_status,changed_at")
        .eq("order_id",id).order("changed_at",{ascending:false}).limit(20),
      ordersClient.from("order_shipments").select("courier_provider,consignment_number,dispatch_date,status,updated_at")
        .eq("order_id",id).maybeSingle()
    ]);
    if(openOrderId!==String(id)||!document.querySelector("#modal")?.classList.contains("open"))return;
    if(history.error)throw history.error;
    if(shipment.error)throw shipment.error;
    const entries=[];
    if(shipment.data)entries.push("<div><strong>Courier shipment: "+esc(shipment.data.status)+"</strong>"+
      "<small>"+esc(shipment.data.courier_provider)+
      (shipment.data.consignment_number?" · AWB "+esc(shipment.data.consignment_number):"")+
      (shipment.data.dispatch_date?" · "+esc(shipment.data.dispatch_date):"")+"</small></div>");
    for(const item of history.data||[]){
      entries.push("<div><strong>"+esc(item.previous_status)+" → "+esc(item.new_status)+"</strong>"+
        "<small>Changed "+esc(dateLabel(item.changed_at))+"</small></div>");
    }
    target.innerHTML=entries.join("")||"<p>No shipment or newly recorded status changes yet. Earlier changes may not appear.</p>";
  }catch{
    if(openOrderId===String(id))target.textContent="Status history is currently unavailable. You can still review the order.";
  }
}
async function updateStatus(id){
  if(currentRole!=="admin"){alert("Only an administrator can change online order status.");return;}
  const status=document.querySelector("#mStatus")?.value;
  const order=allOrders.find(o=>String(o.id)===String(id));
  if(!order||!status||status===order.status)return;
  if(!manualStatusChoices(order).includes(status)){alert("Verify payment or use Manage Shipment.");return;}
  try{
    const {error}=await ordersClient.rpc("update_online_order_status",{p_order_id:id,p_next_status:status});
    if(error)throw error;
    document.querySelector("#modal").classList.remove("open");
    document.querySelector("#modal").setAttribute("aria-hidden","true");
    openOrderId="";
    await loadOrders();
  }catch(error){alert("Could not update order status: "+(error?.message||"Unknown error"));}
}
async function sendAlert(id){
  const order=allOrders.find(item=>String(item.id)===String(id));
  if(!order||order.payment_status!=="paid"){alert("Verify payment before sending full order details.");return;}
  try{
    const session=await requireSession();
    const r=await fetch(SUPABASE_URL+"/functions/v1/send-order-alert",{
      method:"POST",
      headers:{apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
      body:JSON.stringify({order_id:id})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"WhatsApp alert failed");
    alert(d.already_sent?"The WhatsApp order alert was already sent to "+(d.recipient_number||"the store"):"Full order details sent to "+(d.recipient_number||"the store")+".");
  }catch(e){alert(e.message||"WhatsApp alert failed");}
}
function startOrdersLiveUpdates(){
  if(ordersPollTimer)return;
  ordersChannel=ordersClient.channel("rainbow-admin-orders-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"orders"},()=>scheduleOrdersRefresh())
    .on("postgres_changes",{event:"*",schema:"public",table:"order_items"},()=>scheduleOrdersRefresh())
    .subscribe();
  ordersPollTimer=setInterval(()=>{if(document.visibilityState==="visible")loadOrders({quiet:true});},15000);
  window.addEventListener("focus",()=>loadOrders({quiet:true}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")loadOrders({quiet:true});});
}
document.querySelector("#search")?.addEventListener("input",render);
document.querySelector("#status")?.addEventListener("change",render);
document.querySelector("#refresh")?.addEventListener("click",()=>loadOrders());
document.querySelector("#close")?.addEventListener("click",()=>{
  document.querySelector("#modal").classList.remove("open");
  document.querySelector("#modal").setAttribute("aria-hidden","true");
  openOrderId="";
});
async function bootOrdersPage(){
  const rows=document.querySelector("#rows");
  try{
    let sessionTimeout;
    const session=await Promise.race([
      requireSession(),
      new Promise((resolve,reject)=>{sessionTimeout=setTimeout(()=>reject(new Error("Session check timed out. Refresh the page and sign in again if needed.")),12000);})
    ]).finally(()=>clearTimeout(sessionTimeout));
    if(!session)return;
    const profile=await getMyProfile();currentRole=profile.role;
    if(currentRole==="admin"){
      shipmentManager=setupShipmentManagement({
        client:ordersClient,
        getOrder:id=>allOrders.find(item=>String(item.id)===String(id)),
        role:()=>currentRole,
        afterSave:()=>loadOrders({quiet:true})
      });
    }
    await loadOrders();
    startOrdersLiveUpdates();
  }catch(e){
    console.error("Could not start orders page.",e);
    showOrdersError(e?.message||"Could not initialize order loading. Refresh and try again.");
  }
}
bootOrdersPage();
window.addEventListener("pagehide",()=>{
  if(ordersRefreshTimer)clearTimeout(ordersRefreshTimer);
  if(ordersPollTimer)clearInterval(ordersPollTimer);
  if(ordersChannel)ordersClient.removeChannel(ordersChannel);
});
