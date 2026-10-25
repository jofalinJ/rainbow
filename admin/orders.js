import {setupShipmentManagement} from "./shipment-management.mjs";
const ordersClient=bootSupabase();
let allOrders=[];
let orderPage=0,orderTotal=0,ordersSearchTimer=null;
const ORDERS_PAGE_SIZE=50;
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
function needsPaymentReconciliation(o){
  return ["cancelled","refunded"].includes(o.status) && o.payment_status==="paid";
}
function manualStatusChoices(o){
  const current=String(o.status||"pending");
  if(o.payment_status!=="paid"||["delivered","cancelled","refunded"].includes(current))return [current];
  if(current==="pending")return ["pending","confirmed","processing"];
  if(current==="confirmed")return ["confirmed","processing"];
  return [current];
}
let openOrderId="";
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
    const request=ordersClient.rpc("search_online_orders",{
      p_search:document.querySelector("#search")?.value.trim().slice(0,90)||"",
      p_status:document.querySelector("#status")?.value||"all",
      p_offset:orderPage*ORDERS_PAGE_SIZE,
      p_limit:ORDERS_PAGE_SIZE
    }).abortSignal(controller.signal);
    const timeout=new Promise((resolve,reject)=>{
      timeoutId=setTimeout(()=>{
        controller.abort();
        reject(new Error("The orders request timed out. Check the connection and select Refresh to try again."));
      },15000);
    });
    const {data,error}=await Promise.race([request,timeout]);
    if(error){console.error("Orders fetch error:",error);throw error;}
    console.log("Orders data:",{count:Array.isArray(data)?data.length:0});
    orderTotal=Number(data?.total||0);
    allOrders=Array.isArray(data?.rows)?data.rows:[];
    if(!allOrders.length&&orderPage>0){
      orderPage--;ordersReloadQueued=true;
    }
    render();
    const info=document.querySelector("#ordersPageInfo");
    if(info)info.textContent=orderTotal
      ?"Page "+(orderPage+1)+" of "+Math.ceil(orderTotal/ORDERS_PAGE_SIZE)
      :"No matching orders";
    const previous=document.querySelector("#ordersPrev");
    const next=document.querySelector("#ordersNext");
    if(previous)previous.disabled=orderPage===0;
    if(next)next.disabled=(orderPage+1)*ORDERS_PAGE_SIZE>=orderTotal;
    setOrdersMessage(orderTotal
      ?orderTotal+" matching online orders · refreshed "+new Date().toLocaleTimeString("en-IN")
      :"No matching online orders.");
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
  // Server has already applied the customer/order search and status filter.
  return allOrders;
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
    const reviewNeeded=needsPaymentReconciliation(o);
    const action=reviewNeeded
      ?"<span class='order-detail-warning'>Review captured payment / refund</span>"
      :o.payment_status==="paid"
      ?"<button type='button' class='wa' data-wa='"+esc(o.id)+"'>Send full WhatsApp alert</button>"
      :"<button type='button' data-verify='"+esc(o.id)+"' "+(verificationDisabled?"disabled":"")+">Verify payment</button>";
    const shipmentAction=currentRole==="admin"&&!reviewNeeded?"<button type='button' class='shipment-action' data-shipment='"+esc(o.id)+"'>Manage Shipment</button>":"";
    return "<tr><td><b>"+esc(orderLabel)+"</b><small>"+esc(dateLabel(o.created_at))+"</small></td>"+
      "<td><b>"+esc(c.name||"—")+"</b><small>"+esc(c.whatsapp_number||c.email||"—")+"</small></td>"+
      "<td>"+esc(address||"—")+"</td>"+
      "<td><b>"+money(o.total_amount)+"</b><small>"+esc(o.payment_status||"—")+"</small></td>"+
      "<td><span class='order-status'>"+esc(o.payment_status!=="paid"?"Awaiting payment · Not placed":o.status||"pending")+"</span></td>"+
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
  const invoice=relationOne(o.invoices);
  const invoiceToken=String(invoice.public_token||"");
  const billUrl=o.payment_status==="paid"&&
    ["confirmed","processing","shipped","delivered"].includes(o.status)&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceToken)
    ?"../invoice.html?token="+encodeURIComponent(invoiceToken):null;
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
  const reviewNeeded=needsPaymentReconciliation(o);
  const paymentAction=reviewNeeded?"":o.payment_status==="paid"
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
    (reviewNeeded?"<p class='order-detail-warning'>⚠ Cancelled or refunded order shows captured payment. Do not ship or send a paid-order notification. Investigate and refund when required.</p>":"")+
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
    "<div class='modal-actions'>"+(billUrl?
      "<a class='button' target='_blank' rel='noopener noreferrer' href='"+esc(billUrl)+"'>View / Print Invoice ↗</a>":"")+(address?"<a class='button' href='"+esc(map)+"' target='_blank' rel='noopener noreferrer'>Open delivery location ↗</a>":"")+
       paymentAction+(currentRole==="admin"&&!reviewNeeded?"<button type='button' id='manageOrderShipment'>Manage Shipment</button>":"")+"</div>"+
    "<div class='order-status-editor'><label for='mStatus'>Manual order status</label>"+
      "<div class='modal-actions'><select id='mStatus' "+(!canUpdate?"disabled":"")+">"+selectOptions+"</select>"+
      "<button type='button' data-save-status "+(!canUpdate?"disabled":"")+">Save status</button></div>"+
      "<small>Verify payment first. Use Manage Shipment to record dispatch and delivery. Cancellation or refunds require a dedicated workflow.</small></div>"+
    "<section class='order-audit'><h3>Shipment and status history</h3><div id='orderHistory' role='status' aria-live='polite'>Loading history…</div></section>";
  document.querySelector("#mStatus").value=o.status||"pending";
  document.querySelector("[data-modal-wa]")?.addEventListener("click",()=>sendAlert(o.id));
  document.querySelector("[data-modal-verify]")?.addEventListener("click",()=>verifyPayment(o.id));
  document.querySelector("[data-save-status]").onclick=()=>updateStatus(o.id);
  if(currentRole==="admin")loadOrderAudit(o.id);
  else document.querySelector("#orderHistory").textContent="Shipment audit history is available to administrators.";
  document.querySelector("#manageOrderShipment")?.addEventListener("click",event=>shipmentManager?.open(o.id,event.currentTarget));
  document.querySelector("#modal").classList.add("open");
  document.querySelector("#modal").setAttribute("aria-hidden","false");
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
  if(!order||order.payment_status!=="paid"||needsPaymentReconciliation(order)){
    alert("This order needs payment or refund review before sending a paid-order notification.");return;
  }
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
document.querySelector("#search")?.addEventListener("input",()=>{
  orderPage=0;clearTimeout(ordersSearchTimer);
  ordersSearchTimer=setTimeout(()=>loadOrders(),260);
});
document.querySelector("#status")?.addEventListener("change",()=>{orderPage=0;loadOrders();});
document.querySelector("#ordersPrev")?.addEventListener("click",()=>{
  if(orderPage>0){orderPage--;loadOrders();}
});
document.querySelector("#ordersNext")?.addEventListener("click",()=>{
  if((orderPage+1)*ORDERS_PAGE_SIZE<orderTotal){orderPage++;loadOrders();}
});
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
