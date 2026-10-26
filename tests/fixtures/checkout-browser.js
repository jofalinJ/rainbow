/* Local QA transport only; injected by scripts/checkout-fixture-server.mjs. */
(() => {
 "use strict";
 const fakeApi="https://rainbow-checkout-fixture.invalid";
 const originalFetch=window.fetch.bind(window),originalOpen=window.open.bind(window);
 let lastVerification=null;
 const cart=[{variant_id:"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",quantity:1,variant_label:"Standard test option",
  product:{id:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",product_code:"TEST001",product_name:"Test chain",selling_price:100,type:"chain"}}];
 function seed(){localStorage.setItem("rainbow_cart_v1",JSON.stringify(cart));sessionStorage.setItem("rainbow_fixture_seeded","1");}
 if(sessionStorage.getItem("rainbow_fixture_seeded")!=="1")seed();
 window.fetch=(input,options={})=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  if(url.origin===fakeApi){
   if(url.pathname.endsWith("/verify"))lastVerification=options.body;
   return originalFetch("/__fixture"+url.pathname+url.search,options);
  }
  if(url.origin!==location.origin)return Promise.reject(new Error("Outbound network blocked in local QA"));
  return originalFetch(input,options);
 };
 window.open=(href,target,features)=>{
  const url=new URL(String(href),location.href);
  if(url.origin==="https://rainbowgoldcovering.com"&&url.pathname==="/invoice.html")return originalOpen(url.pathname+url.search,target,features);
  if(url.origin!==location.origin){alert("External navigation blocked in local QA.");return null;}
  return originalOpen(href,target,features);
 };
 class Query{
  constructor(table){this.table=table;this.filters={eq:{},in:{}};}
  select(){return this;}
  eq(key,value){this.filters.eq[key]=value;return this;}
  in(key,value){this.filters.in[key]=value;return this;}
  order(){return this;}
  gt(){return this;}
  gte(){return this;}
  lte(){return this;}
  ilike(){return this;}
  or(){return this;}
  limit(value){this.filters.limit=value;return this;}
  range(first,last){this.filters.range=[first,last];return this;}
  single(){this.filters.single=true;return this;}
  maybeSingle(){this.filters.single=true;return this;}
  then(resolve,reject){return originalFetch("/__fixture/db/select?table="+encodeURIComponent(this.table)+"&filters="+encodeURIComponent(JSON.stringify(this.filters))).then(r=>r.json()).then(resolve,reject);}
 }
 const client={from:table=>new Query(table),rpc:(name,payload)=>originalFetch("/__fixture/db/rpc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,payload})}).then(r=>r.json()),
  auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel(){}};
 window.supabase={createClient:()=>client};
 class FixtureRazorpay{
  constructor(options){this.options=options;this.events={};}
  on(name,handler){this.events[name]=handler;}
  open(){
   const modal=document.createElement("section");modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-label","Simulated Razorpay TEST");
   modal.style.cssText="position:fixed;inset:18% 12%;z-index:100001;overflow:auto;background:white;padding:28px;border:4px solid #81232d;border-radius:18px;box-shadow:0 0 0 100vmax #0008;font:16px Arial";
   modal.innerHTML='<h2>Simulated Razorpay TEST</h2><p>Local provider simulator. No real money, bank, card or external provider request.</p><p>Authoritative amount: ₹'+(this.options.amount/100).toFixed(2)+'</p>';
   const action=(label,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="display:block;padding:12px;margin:12px 0;font:inherit";b.onclick=fn;modal.append(b);};
   const payment=async(status,twice=false)=>{
    const res=await originalFetch("/__fixture/pay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({order_id:this.options.order_id,status})});
    const response=await res.json();modal.remove();
    await this.options.handler(response);if(twice)await this.options.handler(response);
   };
   action("Simulate captured payment",()=>payment("captured"));
   action("Capture with duplicate callback",()=>payment("captured",true));
   action("Simulate authorized, not captured",()=>payment("authorized"));
   action("Simulate failed payment",()=>{this.events["payment.failed"]?.({error:{description:"Simulated declined test payment"}});});
   action("Cancel simulated payment",()=>{modal.remove();this.options.modal.ondismiss();});
   modal.addEventListener("keydown",event=>{if(event.key==="Escape"){modal.remove();this.options.modal.ondismiss();}});
   document.body.append(modal);modal.querySelector("button").focus();
  }
 }
 window.Razorpay=FixtureRazorpay;
 function mount(){
  const panel=document.createElement("aside");panel.id="fixtureControls";panel.style.cssText="position:fixed;bottom:0;left:0;right:0;z-index:100000;background:#fff7d8;border-top:3px solid #81232d;padding:10px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font:12px Arial";
  const label=document.createElement("strong");label.textContent="LOCAL QA · SIMULATED TEST PAYMENT · NO EXTERNAL NETWORK";panel.append(label);
  const action=(label,fn)=>{const b=document.createElement("button");b.textContent=label;b.type="button";b.onclick=fn;panel.append(b);};
  action("Reset local fixture",async()=>{await originalFetch("/__fixture/reset",{method:"POST"});sessionStorage.clear();seed();location.assign("/order.html");});
  action("View fixture state",()=>originalOpen("/__fixture/state","_blank"));
  action("Repeat last verification",async()=>{
   if(!lastVerification)return alert("No verification callback has been sent yet.");
   const response=await window.fetch(fakeApi+"/api/razorpay/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:lastVerification});
   const value=await response.json();alert("Repeated verification: "+JSON.stringify({status:response.status,paid:value.paid,orderNumber:value.orderNumber}));
  });
  action("Fail next verification",async()=>{await originalFetch("/__fixture/verify-failure",{method:"POST"});label.textContent="LOCAL QA · next verification returns a temporary error";});
  document.body.style.paddingBottom="90px";document.body.append(panel);
  new MutationObserver(()=>{
   document.querySelectorAll('a[href^="https://rainbowgoldcovering.com/invoice.html"]').forEach(a=>{const u=new URL(a.href);a.href=u.pathname+u.search;});
  }).observe(document.body,{childList:true,subtree:true});
  document.addEventListener("click",event=>{const a=event.target.closest("a[href]");if(!a)return;const u=new URL(a.href,location.href);if(u.origin!==location.origin){event.preventDefault();alert("External navigation blocked in local QA.");}},true);
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
})();
