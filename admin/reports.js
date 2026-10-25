const reportsClient=bootSupabase();
const reportEsc=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const reportMoney=value=>{const n=Number(value??0);return "₹"+(Number.isFinite(n)?n:0).toLocaleString("en-IN",{maximumFractionDigits:2});};
const reportDate=value=>{if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString("en-IN");};
function setReportValue(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
function reportStatus(message,error=false){const el=document.querySelector("#reportMessage");if(el){el.textContent=message;el.className="form-msg"+(error?" error":"");}}
async function loadReports(){
  const button=document.querySelector("#refreshReports"),rows=document.querySelector("#reportRows");
  if(button){button.disabled=true;button.textContent="Refreshing…";}
  if(rows)rows.innerHTML="<tr><td colspan='6'>Loading report…</td></tr>";
  reportStatus("");
  try{
    const [{data:metrics,error:metricsError},{data:orders,error:ordersError}]=await Promise.all([
      reportsClient.rpc("get_admin_operational_metrics"),
      reportsClient.from("orders")
        .select("id,order_number,source,status,payment_status,total_amount,created_at")
        .order("created_at",{ascending:false}).limit(30)
    ]);
    if(metricsError)throw metricsError;
    if(ordersError)throw ordersError;
    setReportValue("reportOrders",Number(metrics.orders||0).toLocaleString("en-IN"));
    setReportValue("reportSales",reportMoney(metrics.total_sales));
    setReportValue("reportTodayOrders",Number(metrics.today_orders||0).toLocaleString("en-IN"));
    setReportValue("reportProducts",Number(metrics.products||0).toLocaleString("en-IN"));
    const recent=Array.isArray(orders)?orders:[];
    if(rows)rows.innerHTML=recent.map(o=>"<tr><td><b>"+reportEsc(o.order_number||("Order "+String(o.id||"").slice(0,8)))+"</b></td><td>"+reportEsc(reportDate(o.created_at))+"</td><td>"+reportEsc(o.source||"—")+"</td><td>"+reportEsc(o.payment_status||"—")+"</td><td>"+reportEsc(o.status||"—")+"</td><td>"+reportMoney(o.total_amount)+"</td></tr>").join("")||"<tr><td colspan='6'>No orders are available to report.</td></tr>";
    reportStatus("Report refreshed at "+new Date().toLocaleTimeString("en-IN")+".");
  }catch(error){
    console.error("Report could not be loaded",error);
    if(rows)rows.innerHTML="<tr><td colspan='6'>Could not load report: "+reportEsc(error?.message||"Check your staff permissions.")+"</td></tr>";
    reportStatus("Report loading failed. Use Refresh to retry.",true);
  }finally{
    if(button){button.disabled=false;button.textContent="Refresh";}
  }
}
document.querySelector("#refreshReports")?.addEventListener("click",loadReports);
requireSession().then(loadReports).catch(error=>{
  const rows=document.querySelector("#reportRows");if(rows)rows.innerHTML="<tr><td colspan='6'>"+reportEsc(error?.message||"Please sign in.")+"</td></tr>";
});