const reportsClient=bootSupabase();
const reportEsc=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const reportMoney=value=>{const n=Number(value??0);return "₹"+(Number.isFinite(n)?n:0).toLocaleString("en-IN",{maximumFractionDigits:2});};
const reportDate=value=>{if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString("en-IN");};
function setReportValue(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
function reportStatus(message,error=false){const el=document.querySelector("#reportMessage");if(el){el.textContent=message;el.className="form-msg"+(error?" error":"");}}
function renderReports(orders,products){
  const activeOrders=orders.filter(o=>!["cancelled","refunded"].includes(String(o.status||"").toLowerCase()));
  const sales=activeOrders.reduce((sum,o)=>sum+Number(o.total_amount||0),0);
  const start=new Date();start.setHours(0,0,0,0);
  const todayCount=orders.filter(o=>o.created_at&&new Date(o.created_at)>=start&&!["cancelled","refunded"].includes(String(o.status||"").toLowerCase())).length;
  setReportValue("reportOrders",String(orders.length));
  setReportValue("reportSales",reportMoney(sales));
  setReportValue("reportTodayOrders",String(todayCount));
  setReportValue("reportProducts",String(products.length));
  const rows=document.querySelector("#reportRows");
  if(rows)rows.innerHTML=orders.slice(0,30).map(o=>"<tr><td><b>"+reportEsc(o.order_number||("Order "+String(o.id||"").slice(0,8)))+"</b></td><td>"+reportEsc(reportDate(o.created_at))+"</td><td>"+reportEsc(o.source||"—")+"</td><td>"+reportEsc(o.payment_status||"—")+"</td><td>"+reportEsc(o.status||"—")+"</td><td>"+reportMoney(o.total_amount)+"</td></tr>").join("")||"<tr><td colspan='6'>No orders are available to report.</td></tr>";
}
async function loadReports(){
  const button=document.querySelector("#refreshReports"),rows=document.querySelector("#reportRows");
  if(button){button.disabled=true;button.textContent="Refreshing…";}
  if(rows)rows.innerHTML="<tr><td colspan='6'>Loading report…</td></tr>";
  reportStatus("");
  const controller=new AbortController();let timer;
  try{
    const request=Promise.all([
      reportsClient.from("orders").select("id,order_number,source,status,payment_status,total_amount,created_at").order("created_at",{ascending:false}).limit(1000).abortSignal(controller.signal),
      reportsClient.from("products").select("id").eq("active",true).abortSignal(controller.signal)
    ]);
    const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Report request timed out. Check your connection and refresh."));},15000);});
    const [{data:orders,error:ordersError},{data:products,error:productsError}]=await Promise.race([request,timeout]);
    if(ordersError)throw ordersError;if(productsError)throw productsError;
    renderReports(Array.isArray(orders)?orders:[],Array.isArray(products)?products:[]);
    reportStatus("Report refreshed at "+new Date().toLocaleTimeString("en-IN")+".");
  }catch(error){
    console.error("Report could not be loaded",error);
    if(rows)rows.innerHTML="<tr><td colspan='6'>Could not load report: "+reportEsc(error?.message||"Check your staff permissions.")+"</td></tr>";
    reportStatus("Report loading failed. Use Refresh to retry.",true);
  }finally{if(timer)clearTimeout(timer);if(button){button.disabled=false;button.textContent="Refresh";}}
}
document.querySelector("#refreshReports")?.addEventListener("click",loadReports);
requireSession().then(loadReports).catch(error=>{
  const rows=document.querySelector("#reportRows");if(rows)rows.innerHTML="<tr><td colspan='6'>"+reportEsc(error?.message||"Please sign in.")+"</td></tr>";
});

async function loadVariance(){
 const table=document.querySelector("#varianceRows");
 const label=document.querySelector("#varianceMessage");
 const btn=document.querySelector("#checkVariance");
 if(!table)return;
 btn.disabled=true;
 try{
  const {data,error}=await reportsClient.rpc("inventory_variance_report",{p_limit:500});
  if(error)throw error;
  table.replaceChildren();
  const mismatch=(data||[]).filter(x=>x.status!=="MATCH");
  for(const x of mismatch){
   const tr=document.createElement("tr");
   for(const val of [x.variant_id,x.actual_qty,x.recorded_qty,x.status]){
    const td=document.createElement("td");
    td.textContent=String(val??"—");tr.append(td);
   }
   table.append(tr);
  }
  label.textContent="Checked "+(data||[]).length+" variants; "+mismatch.length+
   " journal mismatch(es). This is not full business ledger reconciliation.";
 }catch(e){label.textContent="Audit unavailable: "+e.message;}
 finally{btn.disabled=false;}
}
document.querySelector("#checkVariance")?.addEventListener("click",loadVariance);
