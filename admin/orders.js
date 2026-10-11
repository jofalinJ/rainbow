const sb=bootSupabase();
let allOrders=[];
let ordersLoading=false;
let ordersReloadQueued=false;
let ordersRefreshTimer=null;
let ordersPollTimer=null;
let ordersChannel=null;
const esc=x=>String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const money=x=>"₹"+Number(x||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
function setOrdersMessage(message,kind=""){const el=document.querySelector("#msg");if(el){el.textContent=message;el.className="form-msg "+kind;}}
function scheduleOrdersRefresh(delay=250){if(ordersRefreshTimer)clearTimeout(ordersRefreshTimer);ordersRefreshTimer=setTimeout(()=>{ordersRefreshTimer=null;loadOrders({quiet:true});},delay);}
async function loadOrders({quiet=false}={}){
  const rows=document.querySelector("#rows");
  if(ordersLoading){ordersReloadQueued=true;return;}
  if(!rows)return;
  ordersLoading=true;
  if(!quiet)rows.innerHTML="<tr><td colspan='6'>Loading customer orders…</td></tr>";
  try{
    const {data,error}=await sb.from("orders")
      .select("id,order_number,source,status,payment_status,subtotal,discount_amount,cgst_amount,sgst_amount,delivery_distance_km,delivery_fee,total_amount,shipping_address,created_at,updated_at,customers(name,whatsapp_number,email,city,state,pin_code),order_items(product_code,product_name,quantity,unit_price,line_total,variant_color,variant_size)")
      .order("created_at",{ascending:false});
    if(error)throw error;
    allOrders=Array.isArray(data)?data:[];
    render();
    setOrdersMessage(allOrders.length?allOrders.length+" order"+(allOrders.length===1?"":"s")+" loaded · refreshed "+new Date().toLocaleTimeString("en-IN"):"No customer orders are visible to this staff account yet.");
  }catch(e){
    console.error("Orders could not be loaded.",e);
    rows.innerHTML="<tr><td colspan='6'>Could not load orders. "+esc(e.message||"Check the connection and staff permissions.")+"</td></tr>";
    setOrdersMessage("Order loading failed. Use Refresh to retry, or check staff access to customer orders.","msg-error");
  }finally{ordersLoading=false;if(ordersReloadQueued){ordersReloadQueued=false;scheduleOrdersRefresh(0);}}
}
function filtered(){
  const q=document.querySelector("#search").value.toLowerCase().trim(),s=document.querySelector("#status").value;
  return allOrders.filter(o=>(s==="all"||o.status===s)&&(!q||[o.order_number,o.customers?.name,o.customers?.whatsapp_number].some(v=>String(v||"").toLowerCase().includes(q))));
}
function render(){
  const rows=document.querySelector("#rows");if(!rows)return;
  rows.innerHTML=filtered().map(o=>{
    const c=o.customers||{},address=[o.shipping_address,c.city,c.state,c.pin_code].filter(Boolean).join(", ");
    return "<tr><td><b>"+esc(o.order_number)+"</b><small>"+new Date(o.created_at).toLocaleString("en-IN")+"</small></td><td><b>"+esc(c.name||"—")+"</b><small>"+esc(c.whatsapp_number||"—")+"</small></td><td>"+esc(address||"—")+(o.delivery_distance_km!=null?"<small>"+esc(o.delivery_distance_km)+" km</small>":"")+"</td><td><b>"+money(o.total_amount)+"</b><small>"+esc(o.payment_status||"—")+"</small></td><td><span class='order-status'>"+esc(o.status||"pending")+"</span></td><td><div class='action-row'><button type='button' data-view='"+esc(o.id)+"'>View</button><button type='button' class='wa' data-wa='"+esc(o.id)+"'>WhatsApp Alert</button></div></td></tr>";
  }).join("")||"<tr><td colspan='6'>No orders match these filters.</td></tr>";
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>openOrder(b.dataset.view));
  document.querySelectorAll("[data-wa]").forEach(b=>b.onclick=()=>sendAlert(b.dataset.wa));
}
function openOrder(id){
  const o=allOrders.find(x=>String(x.id)===String(id));if(!o)return;
  const c=o.customers||{},address=[o.shipping_address,c.city,c.state,c.pin_code].filter(Boolean).join(", ");
  const map="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(address);
  document.querySelector("#mTitle").textContent=o.order_number||"Order";
  const itemRows=(o.order_items||[]).map(i=>"<div><span>"+esc(i.product_code||"")+" — "+esc(i.product_name)+" × "+Number(i.quantity)+"</span><b>"+money(i.line_total)+"</b></div>").join("")||"<p>No item details were returned for this order.</p>";
  document.querySelector("#mBody").innerHTML="<div class='detail-grid'>"+
    "<div class='detail-box'><span>Customer</span><strong>"+esc(c.name||"—")+"</strong></div>"+
    "<div class='detail-box'><span>WhatsApp</span><strong>"+esc(c.whatsapp_number||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Delivery address</span><strong>"+esc(address||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Payment</span><strong>"+esc(o.payment_status||"—")+"</strong></div>"+
    "<div class='detail-box'><span>Order total</span><strong>"+money(o.total_amount)+"</strong></div>"+
    "<div class='detail-box'><span>Delivery</span><strong>"+(o.delivery_distance_km==null?"Not provided":esc(o.delivery_distance_km)+" km")+" · "+(Number(o.delivery_fee||0)>0?money(o.delivery_fee):"To confirm")+"</strong></div></div>"+
    "<div class='modal-actions'><a class='button' href='"+esc(map)+"' target='_blank' rel='noopener noreferrer'>Open delivery location ↗</a><button class='wa' data-modal-wa='"+esc(o.id)+"'>Send WhatsApp Alert</button></div>"+
    "<div class='items'>"+itemRows+"</div>"+
    "<div class='modal-actions'><label>Status <select id='mStatus'><option value='pending'>pending</option><option value='confirmed'>confirmed</option><option value='processing'>processing</option><option value='shipped'>shipped</option><option value='delivered'>delivered</option><option value='cancelled'>cancelled</option><option value='refunded'>refunded</option></select></label><button type='button' data-save-status>Save status</button></div>";
  document.querySelector("#mStatus").value=o.status||"pending";
  document.querySelector("[data-modal-wa]").onclick=()=>sendAlert(o.id);
  document.querySelector("[data-save-status]").onclick=()=>updateStatus(o.id);
  document.querySelector("#modal").classList.add("open");document.querySelector("#modal").setAttribute("aria-hidden","false");
}
async function updateStatus(id){
  const status=document.querySelector("#mStatus").value;
  const {error}=await sb.from("orders").update({status,updated_at:new Date().toISOString()}).eq("id",id);
  if(error){alert(error.message);return;}
  document.querySelector("#modal").classList.remove("open");document.querySelector("#modal").setAttribute("aria-hidden","true");
  await loadOrders();
}
async function sendAlert(id){
  try{
    const session=await requireSession();
    const r=await fetch(SUPABASE_URL+"/functions/v1/send-order-alert",{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify({order_id:id})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||"WhatsApp alert failed");
    alert("WhatsApp order alert sent to "+d.recipient_number);
  }catch(e){alert(e.message);}
}
function startOrdersLiveUpdates(){
  if(ordersPollTimer)return;
  ordersChannel=sb.channel("rainbow-admin-orders-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"orders"},()=>scheduleOrdersRefresh())
    .on("postgres_changes",{event:"*",schema:"public",table:"order_items"},()=>scheduleOrdersRefresh())
    .subscribe();
  ordersPollTimer=setInterval(()=>{if(document.visibilityState==="visible")loadOrders({quiet:true});},15000);
  window.addEventListener("focus",()=>loadOrders({quiet:true}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")loadOrders({quiet:true});});
}
document.querySelector("#search").oninput=render;
document.querySelector("#status").onchange=render;
document.querySelector("#refresh").onclick=()=>loadOrders();
document.querySelector("#close").onclick=()=>{document.querySelector("#modal").classList.remove("open");document.querySelector("#modal").setAttribute("aria-hidden","true");};
requireSession().then(async()=>{await loadOrders();startOrdersLiveUpdates();}).catch(e=>{const rows=document.querySelector("#rows");if(rows)rows.innerHTML="<tr><td colspan=\"6\">"+esc(e.message||"Please sign in.")+"</td></tr>";});
window.addEventListener("pagehide",()=>{if(ordersRefreshTimer)clearTimeout(ordersRefreshTimer);if(ordersPollTimer)clearInterval(ordersPollTimer);if(ordersChannel)sb.removeChannel(ordersChannel);});
