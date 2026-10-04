const SUPABASE_URL="https://ajnicsvtymvvkgepjmmk.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_8DVJ4VEsYhfq2RwbbElrGw_h-RsKoWj";
const sbClient=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

async function getAuthUser(){
  const {data,error}=await sbClient.auth.getUser();
  if(error||!data.user) throw new Error("Please sign in.");
  return data.user;
}
async function requireSession(){
  const {data:{session}}=await sbClient.auth.getSession();
  if(!session){location.href="login.html";throw new Error("Please sign in.");}
  return session;
}
async function getMyProfile(){
  const user=await getAuthUser();
  const {data,error}=await sbClient.from("staff_profiles").select("role,active,full_name,username").eq("user_id",user.id).maybeSingle();
  if(error) throw new Error("Could not load staff profile: "+error.message);
  if(!data) throw new Error("No staff profile exists for this login.");
  return data;
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
async function applyRoleNavigation(){
  try{
    const p=await getMyProfile();
    if(!p.active){location.href="login.html";return null;}
    const role=p.role;
    const allowed={
      admin:["index.html","products.html","inventory.html","orders.html","billing.html","customers.html","reports.html","staff.html","settings.html"],
      inventory_staff:["products.html","inventory.html"],
      cashier:["orders.html","billing.html","customers.html"]
    };
    if(!allowed[role]) throw new Error("Invalid staff role.");
    const page=(location.pathname.split("/").pop()||"index.html").toLowerCase();
    if(!allowed[role].includes(page)){
      location.href=role==="admin"?"index.html":role==="inventory_staff"?"products.html":"billing.html";
      return null;
    }
    document.querySelectorAll("aside nav a").forEach(a=>{
      const href=(a.getAttribute("href")||"").split("/").pop().split("?")[0].toLowerCase();
      if(href&&href.endsWith(".html")&&!allowed[role].includes(href)) a.remove();
      else if(role!=="admin"&&a.hasAttribute("data-admin-only")) a.remove();
    });
    const user=document.querySelector("aside .user");
    if(user){
      const label=role==="admin"?"Admin":role==="cashier"?"Cashier":"Inventory Staff";
      user.innerHTML=(p.full_name||p.username||"Staff")+"<br><small>"+label+"</small><button onclick="logout()" style="margin-top:12px">Sign out</button>";
    }
    return p;
  }catch(e){
    console.error(e);
    const msg=document.querySelector("#pageError");
    if(msg) msg.textContent=e.message;
    else location.href="login.html";
    return null;
  }
}
async function logout(){await sbClient.auth.signOut();location.href="login.html";}
function comingSoon(name){alert(name+" is the next module.");return false;}

async function loadDashboard(){
  try{
    const [products,orders,low,best]=await Promise.all([
      sb("products?select=id&active=eq.true"),
      sb("orders?select=id,total_amount,created_at,status&order=created_at.desc&limit=50"),
      sb("low_stock_products?select=*"),
      sb("best_selling_products?select=*&limit=5")
    ]);
    const today=new Date();today.setHours(0,0,0,0);
    const todayOrders=(orders||[]).filter(o=>new Date(o.created_at)>=today&&!["cancelled","refunded"].includes(o.status));
    const sales=todayOrders.reduce((s,o)=>s+Number(o.total_amount||0),0);
    const salesEl=document.querySelector("#sales"); if(salesEl) salesEl.textContent="₹"+sales.toLocaleString("en-IN",{maximumFractionDigits:0});
    const meta=document.querySelector("#salesMeta"); if(meta) meta.textContent=todayOrders.length+" orders today";
    const ordersEl=document.querySelector("#orders"); if(ordersEl) ordersEl.textContent=(orders||[]).length;
    const productsEl=document.querySelector("#products"); if(productsEl) productsEl.textContent=(products||[]).length;
    const lowEl=document.querySelector("#lowCount"); if(lowEl) lowEl.textContent=(low||[]).length;
    const orderRows=document.querySelector("#orderRows"); if(orderRows) orderRows.innerHTML=(orders||[]).slice(0,5).map(o=>"<tr><td>#"+o.id.slice(0,8).toUpperCase()+"</td><td>₹"+Number(o.total_amount||0).toLocaleString("en-IN")+"</td><td><b>"+o.status+"</b></td></tr>").join("")||"<tr><td colspan='3'>No orders yet.</td></tr>";
    const lowRows=document.querySelector("#lowRows"); if(lowRows) lowRows.innerHTML=(low||[]).slice(0,5).map(x=>"<div class='stock'><div><b>"+x.product_name+"</b><small>"+x.product_code+"</small></div><strong>"+x.stock_quantity+" left</strong></div>").join("")||"<p>No low-stock products.</p>";
    const bestRows=document.querySelector("#bestRows"); if(bestRows) bestRows.innerHTML=(best||[]).map((x,i)=>"<div class='seller'><span>0"+(i+1)+"</span><div><b>"+x.product_name+"</b><small>"+x.units_sold+" sold</small></div><strong>₹"+Number(x.sales_amount||0).toLocaleString("en-IN")+"</strong></div>").join("")||"<p>No sales yet.</p>";
  }catch(e){
    console.error(e);
    const meta=document.querySelector("#salesMeta"); if(meta) meta.textContent="Dashboard data unavailable";
    const rows=document.querySelector("#orderRows"); if(rows) rows.innerHTML="<tr><td colspan='3'>Could not load dashboard data.</td></tr>";
  }
}
document.addEventListener("DOMContentLoaded",async()=>{
  const profile=await applyRoleNavigation();
  if(profile&&profile.role==="admin"&&document.querySelector("#sales")) await loadDashboard();
});