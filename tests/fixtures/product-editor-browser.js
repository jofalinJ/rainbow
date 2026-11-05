/* Synthetic mutable transport for product-editor-fixture-server.mjs only.
   This file is excluded from public asset builds. No production data or network. */
(() => {
 "use strict";
 const params=new URLSearchParams(location.search),role=["admin","cashier","inventory_staff"].includes(params.get("fixtureRole"))?params.get("fixtureRole"):"cashier";
 const userId="11111111-1111-4111-8111-111111111111",productId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",variantId="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",categoryId="dddddddd-dddd-4ddd-dddd-dddddddddddd",branchId="22222222-2222-4222-8222-222222222222";
 const now=new Date().toISOString();
 const categories=[{id:categoryId,name:"Necklace",active:true,has_color:true,has_size:false,has_length:false,has_thickness:false,has_gold_amount:false,storefront_order:10,show_in_storefront:true},
 {id:"dddddddd-dddd-4ddd-addd-dddddddddddd",name:"Thali Chain",active:true,has_color:false,has_size:false,has_length:true,has_thickness:true,has_gold_amount:true,storefront_order:20,show_in_storefront:true}];
 const tables={
  categories,
  products:[{id:productId,product_code:"QA00001",product_name:"QA Rose Necklace",type:"Stone",selling_price:100,active:true,category_id:categoryId,gender:"women",description:"Synthetic jewellery for local product editor QA.",length_cm:null,created_at:now,display_priority:0}],
  product_variants:[{id:variantId,product_id:productId,stock_quantity:0,active:true,color:"Pink",size:"0",length_cm:null,low_stock_limit:3,barcode:"QA001",created_at:now}],
  product_images:[{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",product_id:productId,public_url:"/assets/brand/rainbow-logo.png",is_primary:true,sort_order:0}],
  staff_profiles:[{user_id:userId,full_name:"QA Staff",username:"qa",role,active:true}],
  erp_locations:[{id:branchId,code:"QA-SHOP",name:"QA Thuckalay",kind:"branch",active:true,branch_id:branchId},
   {id:"33333333-3333-4333-8333-333333333333",code:"QA-SHOP-TWO",name:"QA Verkilambi",kind:"branch",active:true,branch_id:"33333333-3333-4333-8333-333333333333"},
   ...(role==="admin"?[{id:"44444444-4444-4444-8444-444444444444",code:"QA-ONLINE",name:"QA Online",kind:"online",active:true,branch_id:null}]:[])],
  erp_staff_locations:[{user_id:userId,location_id:branchId}],
  erp_stock_balances:[{location_id:branchId,variant_id:variantId,on_hand:5,reserved:0}],
  erp_online_listings:[],erp_stock_events:[]
 };
 const stateKey="rainbow_product_editor_fixture_v1",persistedTables=["categories","products","product_variants","product_images","erp_stock_balances","erp_online_listings","erp_stock_events"];
 let restored=null;
 try{restored=JSON.parse(sessionStorage.getItem(stateKey)||"null");}catch{/* A malformed fixture state starts a new synthetic catalogue. */}
 if(restored&&restored.version===1){
  for(const table of persistedTables)if(Array.isArray(restored.tables?.[table]))tables[table]=restored.tables[table];
 }
 let failStock=restored?.version===1?Boolean(restored.failStock):params.get("failStock")==="1";
 let applied=Number(restored?.applied)||0,attempts=Number(restored?.attempts)||0,duplicates=Number(restored?.duplicates)||0;
 const requests=new Map(Array.isArray(restored?.requests)?restored.requests:[]);
 function persistState(){
  try{sessionStorage.setItem(stateKey,JSON.stringify({version:1,tables:Object.fromEntries(persistedTables.map(table=>[table,tables[table]])),failStock,applied,attempts,duplicates,requests:[...requests]}));}
  catch{/* Tests still work in memory if session storage is disabled. */}
 }
 persistState();
 const copy=value=>JSON.parse(JSON.stringify(value));
 const fail=message=>({data:null,error:{message},count:null});
 function rows(table){
  const data=tables[table]||[];
  if(table==="products")return data.map(p=>({...p,categories:tables.categories.find(c=>c.id===p.category_id),product_variants:tables.product_variants.filter(v=>v.product_id===p.id),product_images:tables.product_images.filter(i=>i.product_id===p.id)}));
  if(table==="product_variants")return data.map(v=>({...v,products:tables.products.find(p=>p.id===v.product_id)}));
  return data;
 }
 function refreshLedger(){
  persistState();
  const node=document.getElementById("fixtureLedger");if(!node)return;
  node.textContent="Products: "+tables.products.length+" · Stock applied: "+applied+" · Attempts: "+attempts+" · Duplicate-safe replies: "+duplicates+" · Next stock response: "+(failStock?"lost after apply":"normal");
 }
 function insert(table,value){
  if(!["products","product_variants","product_images","erp_online_listings"].includes(table))throw Error("Fixture write not allowed: "+table);
  const values=Array.isArray(value)?value:[value];
  const result=values.map(input=>{
   const record={id:crypto.randomUUID(),created_at:new Date().toISOString(),active:true,...copy(input)};
   if(table==="products"&&!record.product_code)record.product_code="QA"+String(tables.products.length+1).padStart(5,"0");
   if(table==="product_variants"){record.stock_quantity=Number(record.stock_quantity||0);record.barcode="QA-"+record.id.slice(0,8);}
   tables[table].push(record);return record;
  });refreshLedger();return result;
 }
 class Query{
  constructor(table){this.table=table;this.filters=[];this.one=false;this.action=null;this.payload=null;this.bounds=null;this.cap=null;this.sorts=[];}
  select(){return this;}abortSignal(){return this;}
  order(key,{ascending=true}={}){this.sorts.push([key,ascending]);return this;}
  limit(n){this.cap=n;return this;}range(a,b){this.bounds=[a,b];return this;}
  eq(k,v){this.filters.push(r=>r[k]===undefined||String(r[k])===String(v));return this;}
  neq(k,v){this.filters.push(r=>String(r[k])!==String(v));return this;}
  in(k,values){this.filters.push(r=>r[k]===undefined||values.map(String).includes(String(r[k])));return this;}
  is(k,v){return this.eq(k,v);}not(){return this;}
  ilike(k,value){const term=String(value).replaceAll("%","").toLowerCase();this.filters.push(r=>String(r[k]||"").toLowerCase().includes(term));return this;}
  or(value){
   const terms=String(value).split(",").map(term=>term.match(/^(\w+)\.ilike\.%(.+)%$/)).filter(Boolean);
   if(terms.length)this.filters.push(row=>terms.some(([,key,term])=>String(row[key]||"").toLowerCase().includes(term.toLowerCase())));return this;
  }
  gt(k,v){this.filters.push(r=>Number(r[k])>Number(v));return this;}gte(){return this;}lte(){return this;}
  single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}
  insert(value){this.action="insert";this.payload=value;return this;}
  update(value){this.action="update";this.payload=value;return this;}
  upsert(value){this.action="upsert";this.payload=value;return this;}
  then(resolve,reject){
   try{
    let data;
    if(this.action==="insert")data=insert(this.table,this.payload);
    else if(this.action){
     if(!["products","categories","erp_online_listings"].includes(this.table))throw Error("Fixture mutation blocked");
     if(this.action==="upsert"){
      const prior=(tables[this.table]||[]).find(x=>x.product_id===this.payload.product_id);
      if(prior){Object.assign(prior,this.payload);data=[prior];}else data=insert(this.table,this.payload);
     }else{data=(tables[this.table]||[]).filter(r=>this.filters.every(fn=>fn(r)));data.forEach(r=>Object.assign(r,this.payload));}
    }else data=rows(this.table).filter(r=>this.filters.every(fn=>fn(r)));
    const count=data.length;
    data=[...data].sort((a,b)=>{for(const [key,asc]of this.sorts){const n=String(a[key]??"").localeCompare(String(b[key]??""));if(n)return asc?n:-n;}return 0;});
    if(this.bounds)data=data.slice(this.bounds[0],this.bounds[1]+1);if(this.cap!==null)data=data.slice(0,this.cap);
    if(this.action)persistState();
    return Promise.resolve({data:copy(this.one?data[0]||null:data),error:null,count}).then(resolve,reject);
   }catch(error){return Promise.resolve(fail(error.message)).then(resolve,reject);}
  }
 }
 async function rpc(name,args={}){
  if(name!=="erp_adjust_stock")return fail("Only stock adjustment is simulated in this product editor fixture.");
  attempts++;
  const signature=JSON.stringify([args.p_location,args.p_variant,args.p_delta,args.p_reason]);
  if(requests.has(args.p_request)){
   const prior=requests.get(args.p_request);if(prior.signature!==signature){refreshLedger();return fail("Idempotency request reused with different details");}
   duplicates++;refreshLedger();return {data:{...prior.result,already_applied:true},error:null};
  }
  const location=tables.erp_locations.find(x=>x.id===args.p_location&&x.kind==="branch"),variant=tables.product_variants.find(x=>x.id===args.p_variant);
  if(!location||!variant||!Number.isSafeInteger(args.p_delta)||args.p_delta<=0||!args.p_request){refreshLedger();return fail("Choose a valid shop, variant and positive quantity.");}
  let balance=tables.erp_stock_balances.find(x=>x.location_id===args.p_location&&x.variant_id===args.p_variant);
  if(!balance){balance={location_id:args.p_location,variant_id:args.p_variant,on_hand:0,reserved:0};tables.erp_stock_balances.push(balance);}
  balance.on_hand+=args.p_delta;applied+=args.p_delta;
  const result={stock:balance.on_hand,already_applied:false};requests.set(args.p_request,{signature,result});
  tables.erp_stock_events.push({location_id:args.p_location,variant_id:args.p_variant,action:"adjustment",quantity_delta:args.p_delta,reason:args.p_reason,created_at:new Date().toISOString()});
  if(failStock){failStock=false;refreshLedger();return fail("Simulated connection lost after stock was recorded. Retry the same request.");}
  refreshLedger();return {data:result,error:null};
 }
 const client={from:table=>new Query(table),rpc,auth:{
  getUser:async()=>({data:{user:{id:userId}},error:null}),getSession:async()=>({data:{session:{access_token:"local-fixture-token",user:{id:userId}}},error:null}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})
 },storage:{from:()=>({upload:async()=>fail("Photo uploads are outside this fixture"),getPublicUrl:()=>({data:{publicUrl:"/assets/brand/rainbow-logo.png"}})})},channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel(){}};
 window.supabase={createClient:()=>client};
 const original=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  if(url.origin==="https://product-editor-fixture.invalid"&&url.pathname.startsWith("/rest/v1/")){
   const table=url.pathname.split("/").at(-1),method=String(options.method||"GET").toUpperCase(),query=new Query(table);
   for(const [key,value]of url.searchParams){if(value.startsWith("eq."))query.eq(key,value.slice(3));}
   try{
    if(method==="POST")query.insert(JSON.parse(options.body||"{}"));
    else if(method==="PATCH")query.update(JSON.parse(options.body||"{}"));
    else if(method!=="GET")return new Response("Fixture method blocked",{status:403});
    const result=await query;if(result.error)return new Response(JSON.stringify(result.error),{status:400});
    return new Response(JSON.stringify(result.data),{headers:{"Content-Type":"application/json"}});
   }catch(error){return new Response(JSON.stringify({message:error.message}),{status:400});}
  }
  if(url.origin!==location.origin)throw Error("External network is disabled in this local product editor fixture");
  return original(input,options);
 };
 document.addEventListener("DOMContentLoaded",()=>{
  const box=document.createElement("aside");box.setAttribute("aria-label","Local fixture controls");box.style.cssText="position:relative;margin:12px;padding:12px;border:2px solid #ba942d;border-radius:10px;background:#fff4c4;color:#4b3413;font:12px Arial;z-index:100001";
  const label=document.createElement("strong");label.textContent="LOCAL SYNTHETIC QA · "+role+" · production network blocked";
  const button=document.createElement("button");button.type="button";button.textContent="Fail next stock response";button.style.cssText="display:block;margin:10px 0;min-height:36px;padding:5px 10px";
  button.onclick=()=>{failStock=true;refreshLedger();};
  const reset=document.createElement("button");reset.type="button";reset.textContent="Reset local fixture";reset.style.cssText="display:block;margin:10px 0;min-height:36px;padding:5px 10px";
  reset.onclick=()=>{
   sessionStorage.removeItem(stateKey);sessionStorage.removeItem("rainbow_opening_stock_v1:"+userId);
   const target=new URL(location.href);target.searchParams.delete("failStock");location.assign(target.href);
  };
  const ledger=document.createElement("p");ledger.id="fixtureLedger";ledger.setAttribute("role","status");
  box.append(label,button,reset,ledger);document.querySelector("main")?.prepend(box);refreshLedger();
  document.addEventListener("click",event=>{const anchor=event.target.closest("a[href]");if(anchor&&new URL(anchor.href,location.href).origin!==location.origin)event.preventDefault();},true);
 },{once:true});
})();
