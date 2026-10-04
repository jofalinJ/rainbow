const SUPABASE_URL="https://ajnicsvtymvvkgepjmmk.supabase.co";
const SUPABASE_ANON_KEY="PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

async function sb(path, options={}){
  if(SUPABASE_ANON_KEY.startsWith("PASTE_")) throw new Error("Add the Supabase anon/publishable key in admin/app.js");
  const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...options,headers:{
    apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+SUPABASE_ANON_KEY,
    "Content-Type":"application/json",...(options.headers||{})
  }});
  if(!r.ok) throw new Error(await r.text());
  return r.status===204?null:r.json();
}
async function loadDashboard(){
  const [products,orders,low,best]=await Promise.all([
    sb("products?select=id,selling_price&active=eq.true"),
    sb("orders?select=id,total_amount,created_at,status&order=created_at.desc&limit=8"),
    sb("low_stock_products?select=*"),
    sb("best_selling_products?select=*&limit=5")
  ]);
  const today=new Date(); today.setHours(0,0,0,0);
  const todayOrders=orders.filter(o=>new Date(o.created_at)>=today && !["cancelled","refunded"].includes(o.status));
  const sales=todayOrders.reduce((s,o)=>s+Number(o.total_amount||0),0);
  document.querySelector(".cards").innerHTML=
    `<div><small>Today’s Sales</small><strong>₹${sales.toLocaleString("en-IN",{maximumFractionDigits:0})}</strong><span>${todayOrders.length} orders today</span></div>
     <div><small>Orders</small><strong>${orders.length}</strong><span>Recent orders</span></div>
     <div><small>Products</small><strong>${products.length}</strong><span>Active products</span></div>
     <div class="alert"><small>Low Stock</small><strong>${low.length}</strong><span>Needs attention</span></div>`;
  const tbody=document.querySelector("tbody");
  tbody.innerHTML=orders.slice(0,5).map(o=>`<tr><td>#${o.id.slice(0,8).toUpperCase()}</td><td>—</td><td>₹${Number(o.total_amount).toLocaleString("en-IN")}</td><td><b class="${o.status==="delivered"||o.status==="confirmed"?"green":"orange"}">${o.status}</b></td></tr>`).join("");
  document.querySelector(".grid .panel:nth-child(2)").innerHTML='<div class="panelhead"><h2>Low Stock</h2></div>'+
    (low.slice(0,5).map(x=>`<div class="stock"><div><b>${x.product_name}</b><small>${x.product_code}${x.color!=="0"?" · "+x.color:""}</small></div><strong>${x.stock_quantity} left</strong></div>`).join("")||"<p>No low-stock products.</p>");
  const sellerPanel=document.querySelectorAll(".grid .panel")[2];
  sellerPanel.innerHTML='<div class="panelhead"><h2>Best Sellers</h2></div>'+
    (best.map((x,i)=>`<div class="seller"><span>0${i+1}</span><div><b>${x.product_name}</b><small>${x.units_sold} sold</small></div><strong>₹${Number(x.sales_amount||0).toLocaleString("en-IN")}</strong></div>`).join("")||"<p>No sales yet.</p>");
}
loadDashboard().catch(e=>console.error(e));