const SUPABASE_CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
const SUPABASE_URL=String(SUPABASE_CONFIG.supabaseUrl||"").trim();
const SUPABASE_ANON_KEY=String(SUPABASE_CONFIG.supabasePublishableKey||"").trim();
let sbClient=null;
let portalUserId=null;
function bootSupabase(){if(sbClient)return sbClient;if(!window.supabase?.createClient)throw new Error("Supabase library did not load. Refresh the page.");sbClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);return sbClient;}
function redirectToStaffLogin(){
  location.href=location.pathname.endsWith("/owner.html")?"login.html?next=owner.html":"login.html";
}
async function getAuthUser(){
  const {data,error}=await bootSupabase().auth.getUser();
  if(error){
    if(error.name==="AuthSessionMissingError"||error.status===401||error.status===403)redirectToStaffLogin();
    throw new Error("Session error: "+error.message);
  }
  if(!data?.user){redirectToStaffLogin();throw new Error("Please sign in.");}
  return data.user;
}
async function findActiveStaffProfile(client,userId){
  const {data,error}=await client.from("staff_profiles")
    .select("role,active,archived_at,full_name,username").eq("user_id",userId).maybeSingle();
  if(error)throw new Error("Could not load staff profile: "+error.message);
  return data?.active===true&&!data.archived_at&&["admin","inventory_staff","cashier"].includes(data.role)?data:null;
}
async function requireStaffProfile(userId){
  const profile=await findActiveStaffProfile(bootSupabase(),userId);
  if(!profile){redirectToStaffLogin();throw new Error("An active staff account is required.");}
  return profile;
}
function closeStaffPage(){
  document.body.inert=true;
  document.body.style.visibility="hidden";
  redirectToStaffLogin();
}
async function getStaffAccess(){
  const client=bootSupabase();
  const user=await getAuthUser();
  const profile=await requireStaffProfile(user.id);
  const {data,error}=await client.auth.getSession();
  if(error||data?.session?.user?.id!==user.id){
    redirectToStaffLogin();
    throw new Error("Session expired. Please sign in again.");
  }
  if(portalUserId&&portalUserId!==user.id){
    closeStaffPage();
    throw new Error("Session changed. Please sign in again.");
  }
  portalUserId=user.id;
  return {profile,session:data.session};
}
async function requireSession(){return (await getStaffAccess()).session;}
async function getMyProfile(){
  return (await getStaffAccess()).profile;
}

function bindStaffLogin(form){
  const msg=document.getElementById("msg");
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!window.supabase?.createClient){
    msg.textContent="Login configuration is unavailable.";
    return;
  }
  const username=document.getElementById("username");
  const password=document.getElementById("password");
  const submit=form.querySelector("button");
  // Keep credentials entered here out of the shared browser session until staff
  // membership has been verified. A rejected attempt leaves storefront sign-in intact.
  const verifier=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{
    storageKey:"rainbow-staff-login-check",persistSession:false,autoRefreshToken:false,detectSessionInUrl:false
  }});
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(submit.disabled)return;
    submit.disabled=true;
    msg.textContent="Signing in…";
    try{
      const loginId=username.value.trim();
      const email=loginId.includes("@")?loginId:loginId.toLowerCase()+"@staff.rainbow.local";
      const {data,error}=await verifier.auth.signInWithPassword({email,password:password.value});
      if(error||!data?.user||!data.session||!await findActiveStaffProfile(verifier,data.user.id)){
        msg.textContent="Invalid username or password.";
        return;
      }
      const {access_token,refresh_token}=data.session;
      const {data:stored,error:sessionError}=await bootSupabase().auth.setSession({access_token,refresh_token});
      if(sessionError||stored?.session?.user?.id!==data.user.id)throw new Error("Staff session could not be saved.");
      location.href=new URLSearchParams(location.search).get("next")==="owner.html"?"owner.html":"index.html";
    }catch{
      msg.textContent="Could not sign in right now. Please try again.";
    }finally{
      submit.disabled=false;
    }
  });
}
async function sb(path,options={}){const session=await requireSession();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...options,headers:{apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json",...(options.headers||{})},signal:controller.signal});const body=await r.text();if(!r.ok)throw new Error(body||("Request failed: "+r.status));if(!body.trim())return null;return JSON.parse(body);}catch(e){if(e.name==="AbortError")throw new Error("Supabase request timed out. Check your connection.");throw e;}finally{clearTimeout(timer);}}
const ADMIN_NAV_ITEMS=[
  {label:"Dashboard",href:"index.html",roles:["admin"]},
  {label:"Online Products",href:"owner.html?screen=categories",roles:["admin","inventory_staff","cashier"]},
  {label:"Products",href:"products.html",roles:["admin","cashier","inventory_staff"]},
  {label:"Inventory",href:"inventory.html",roles:["admin","cashier","inventory_staff"]},
  {label:"Bills",href:"bills.html",roles:["admin","cashier","inventory_staff"]},
  {label:"Orders",href:"orders.html",roles:["admin","cashier","inventory_staff"]},
  {label:"Billing",href:"billing.html",roles:["admin","cashier","inventory_staff"]},
  {label:"Customers",href:"customers.html",roles:["admin","cashier","inventory_staff"]},
  {label:"Reports",href:"reports.html",roles:["admin"]},
  {label:"Staff",href:"staff.html",roles:["admin"]},
  {label:"My Attendance",href:"my-attendance.html",roles:["cashier","inventory_staff"]},
  {label:"Attendance",href:"attendance.html",roles:["admin"]}
];
function renderSharedSidebar(){
  const aside=document.querySelector("body > aside");
  if(!aside)return;
  aside.replaceChildren();
  const brand=document.createElement("div");brand.className="brand";
  const logo=document.createElement("img");logo.src="../assets/brand/rainbow-logo.png";logo.alt="Rainbow Gold Covering logo";logo.width=36;logo.height=36;
  const name=document.createElement("span");name.innerHTML="RAINBOW<br>GOLD COVERING";
  brand.append(logo,name);aside.append(brand);
  // Keep navigation empty until Supabase confirms the signed-in staff role.
  // Rendering all links first caused a brief flash of admin-only pages for other roles.
  const nav=document.createElement("nav");nav.setAttribute("aria-label","Admin navigation");
  aside.append(nav);
  const user=document.createElement("div");user.className="user";
  const signOut=document.createElement("button");signOut.type="button";signOut.textContent="Sign out";signOut.style.marginTop="12px";signOut.addEventListener("click",()=>logout());
  user.append(signOut);aside.append(user);
}
function renderAuthorizedSidebar(profile,allowedItems){
  const aside=document.querySelector("body > aside");
  if(!aside)return;
  const nav=aside.querySelector("nav");
  const current=(location.pathname.split("/").pop()||"index.html").toLowerCase();
  const links=allowedItems.map(item=>{
    const link=document.createElement("a");
    link.href=item.href;link.textContent=item.label;
    if(item.href.split("?")[0]===current){link.classList.add("active");link.setAttribute("aria-current","page");}
    return link;
  });
  // Only publish links after the role and page have both been authorized.
  if(nav)nav.replaceChildren(...links);
  const user=aside.querySelector(".user");
  if(user){
    const label=document.createElement("span");
    label.textContent=profile.full_name||profile.username||"Staff";
    const line=document.createElement("br");
    const role=document.createElement("small");
    role.textContent=profile.role==="admin"?"Admin":"Staff";
    user.prepend(label,line,role);
  }
}
async function applyRoleNavigation(){
  try{
    const p=await getMyProfile();
    const allowedItems=ADMIN_NAV_ITEMS.filter(item=>item.roles.includes(p.role));
    const page=(location.pathname.split("/").pop()||"index.html").toLowerCase();
    if(!allowedItems.some(item=>item.href.split("?")[0]===page)){
      location.href=p.role==="admin"?"index.html":"billing.html";
      return null;
    }
    renderAuthorizedSidebar(p,allowedItems);
    document.body.inert=false;
    return p;
  }catch(e){
    console.error(e);
    const msg=document.querySelector("#pageError");
    if(msg){msg.textContent=e.message;msg.hidden=false;}
    else{
      const box=document.createElement("div");box.style="position:fixed;left:20px;right:20px;bottom:20px;padding:14px 16px;background:#fff0f0;color:#a00;border:1px solid #f5b5b5;border-radius:12px;z-index:99999;font:14px Arial";
      box.textContent="Admin loading error: "+e.message;document.body.appendChild(box);
    }
    return null;
  }
}
async function logout(){await bootSupabase().auth.signOut();location.href="login.html";}
function comingSoon(name){alert(name+" is not enabled yet.");return false;}
window.addEventListener("pageshow",event=>{if(event.persisted)window.location.reload();});
async function loadDashboard(){try{const [products,orders,low,best]=await Promise.all([sb("products?select=id&active=eq.true"),sb("orders?select=id,total_amount,created_at,status,payment_status&order=created_at.desc&limit=50"),sb("low_stock_products?select=*"),sb("best_selling_products?select=*&limit=5")]);const today=new Date();today.setHours(0,0,0,0);const todayPaidOrders=(orders||[]).filter(o=>new Date(o.created_at)>=today&&o.payment_status==="paid"&&!["cancelled","refunded"].includes(o.status));const sales=todayPaidOrders.reduce((s,o)=>s+Number(o.total_amount||0),0);const salesEl=document.querySelector("#sales");if(salesEl)salesEl.textContent="₹"+sales.toLocaleString("en-IN",{maximumFractionDigits:0});const meta=document.querySelector("#salesMeta");if(meta)meta.textContent=todayPaidOrders.length+" paid orders today";const ordersEl=document.querySelector("#orders");if(ordersEl)ordersEl.textContent=(orders||[]).length;const productsEl=document.querySelector("#products");if(productsEl)productsEl.textContent=(products||[]).length;const lowEl=document.querySelector("#lowCount");if(lowEl)lowEl.textContent=(low||[]).length;const orderRows=document.querySelector("#orderRows");if(orderRows)orderRows.innerHTML=(orders||[]).slice(0,5).map(o=>"<tr><td>#"+o.id.slice(0,8).toUpperCase()+"</td><td>₹"+Number(o.total_amount||0).toLocaleString("en-IN")+"</td><td><b>"+o.status+"</b></td></tr>").join("")||"<tr><td colspan='3'>No orders yet.</td></tr>";const lowRows=document.querySelector("#lowRows");if(lowRows)lowRows.innerHTML=(low||[]).slice(0,5).map(x=>"<div class='stock'><div><b>"+x.product_name+"</b><small>"+x.product_code+"</small></div><strong>"+x.stock_quantity+" left</strong></div>").join("")||"<p>No low-stock products.</p>";const bestRows=document.querySelector("#bestRows");if(bestRows)bestRows.innerHTML=(best||[]).map((x,i)=>"<div class='seller'><span>0"+(i+1)+"</span><div><b>"+x.product_name+"</b><small>"+x.units_sold+" sold</small></div><strong>₹"+Number(x.sales_amount||0).toLocaleString("en-IN")+"</strong></div>").join("")||"<p>No sales yet.</p>"}catch(e){console.error(e);const meta=document.querySelector("#salesMeta");if(meta)meta.textContent="Error: "+e.message;const rows=document.querySelector("#orderRows");if(rows)rows.innerHTML="<tr><td colspan='3'>Could not load dashboard: "+e.message+"</td></tr>";}}
let dashboardLiveChannel=null,dashboardRefreshTimer=null,dashboardPollTimer=null;
function startDashboardLiveUpdates(){
  if(dashboardPollTimer)return;
  const client=bootSupabase();
  const schedule=()=>{if(dashboardRefreshTimer)clearTimeout(dashboardRefreshTimer);dashboardRefreshTimer=setTimeout(()=>{dashboardRefreshTimer=null;if(document.visibilityState==="visible")loadDashboard();},400);};
  dashboardLiveChannel=client.channel("rainbow-admin-dashboard-orders")
    .on("postgres_changes",{event:"*",schema:"public",table:"orders"},schedule)
    .on("postgres_changes",{event:"*",schema:"public",table:"order_items"},schedule)
    .subscribe();
  dashboardPollTimer=setInterval(()=>{if(document.visibilityState==="visible")loadDashboard();},30000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")loadDashboard();});
  window.addEventListener("pagehide",()=>{if(dashboardRefreshTimer)clearTimeout(dashboardRefreshTimer);if(dashboardPollTimer)clearInterval(dashboardPollTimer);if(dashboardLiveChannel)client.removeChannel(dashboardLiveChannel);},{once:true});
}
async function bootAdminPage(){
  const profile=await applyRoleNavigation();
  if(profile?.role==="admin"&&document.querySelector("#sales")){
    await loadDashboard();startDashboardLiveUpdates();
  }
  return profile;
}
// Pages with privileged content can wait for the shared navigation to finish
// verifying staff access before removing their initial loading cover.
function startAdminPage(){
  if(window.supabase?.createClient){
    bootSupabase().auth.onAuthStateChange((_event,session)=>{
      if(portalUserId&&session?.user?.id!==portalUserId)closeStaffPage();
    });
  }
  window.rainbowSidebarReady=bootAdminPage();
}
const staffLoginForm=document.querySelector("#login");
if(staffLoginForm){
  bindStaffLogin(staffLoginForm);
}else{
  document.body.inert=true;
  // Staff app installation only: pages remain authenticated and require online APIs.
  if(typeof navigator!=="undefined"&&"serviceWorker" in navigator&&window.isSecureContext&&document.head){
    const link=document.createElement("link");link.rel="manifest";link.href="manifest.webmanifest";document.head.append(link);
    const script=document.createElement("script");script.src="pwa.js";document.head.append(script);
  }
  renderSharedSidebar();
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",startAdminPage,{once:true});else startAdminPage();
}
