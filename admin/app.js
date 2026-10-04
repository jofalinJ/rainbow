const SUPABASE_URL="https://ajnicsvtymvvkgepjmmk.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_8DVJ4VEsYhfq2RwbbElrGw_h-RsKoWj";
const sbClient=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

async function requireSession(){
  const {data:{session}}=await sbClient.auth.getSession();
  if(!session){location.href="login.html";throw new Error("Please sign in.");}
  return session;
}
async function sb(path,options={}){
  const session=await requireSession();
  const headers={apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json",...(options.headers||{})};
  const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...options,headers});
  const body=await r.text();
  if(!r.ok) throw new Error(body||("Request failed: "+r.status));
  if(!body.trim()) return null;
  try{return JSON.parse(body);}catch(e){throw new Error("Invalid response from server.");}
}
async function logout(){await sbClient.auth.signOut();location.href="login.html";}
function comingSoon(name){alert(name+" is the next module. Products is active now.");return false;}

async function loadDashboard(){
  try{
    const [products,orders,low,best]=await Promise.all([
      sb("products?select=id&active=eq.true"),
      sb("orders?select=id,total_amount,created_at,status&order=created_at.desc&limit=50"),
      sb("low_stock_products?select=*"),
      sb("best_selling_products?select=*&limit=5")
    ]);
    const today=new Date();today.setHours(0,0,0,0);
    const todayOrders=orders.filter(o=>new Date(o.created_at)>=today&&!["cancelled","refunded"].includes(o.status));
    const sales=todayOrders.reduce((s,o)=>s+Number(o.total_amount||0),0);
    document.querySelector("#sales").textContent="₹"+sales.toLocaleString("en-IN",{maximumFractionDigits:0});
    document.querySelector("#salesMeta").textContent=todayOrders.length+" orders today";
    document.querySelector("#orders").textContent=orders.length;
    document.querySelector("#products").textContent=products.length;
    document.querySelector("#lowCount").textContent=low.length;
    document.querySelector("#orderRows").innerHTML=orders.slice(0,5).map(o=>"<tr><td>#"+o.id.slice(0,8).toUpperCase()+"</td><td>₹"+Number(o.total_amount||0).toLocaleString("en-IN")+"</td><td><b>"+o.status+"</b></td></tr>").join("")||"<tr><td colspan='3'>No orders yet.</td></tr>";
    document.querySelector("#lowRows").innerHTML=low.slice(0,5).map(x=>"<div class='stock'><div><b>"+x.product_name+"</b><small>"+x.product_code+"</small></div><strong>"+x.stock_quantity+" left</strong></div>").join("")||"<p>No low-stock products.</p>";
    document.querySelector("#bestRows").innerHTML=best.map((x,i)=>"<div class='seller'><span>0"+(i+1)+"</span><div><b>"+x.product_name+"</b><small>"+x.units_sold+" sold</small></div><strong>₹"+Number(x.sales_amount||0).toLocaleString("en-IN")+"</strong></div>").join("")||"<p>No sales yet.</p>";
  }catch(e){
    console.error(e);
    document.querySelector("#salesMeta").textContent="Dashboard data unavailable";
    document.querySelector("#orderRows").innerHTML="<tr><td colspan='3'>Could not load orders.</td></tr>";
  }
}
if(document.querySelector(".cards")){requireSession().then(loadDashboard).catch(console.error);}