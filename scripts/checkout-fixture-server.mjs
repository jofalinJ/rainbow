/*
 * Isolated checkout QA: actual storefront + actual Worker + actual PostgreSQL RPCs.
 * Razorpay and Supabase HTTP transports are local fixtures. No outbound fetch is allowed.
 * Usage: node scripts/checkout-fixture-server.mjs (http://127.0.0.1:8844/order.html)
 * The server and all synthetic rows disappear when the process is stopped.
 */
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";
import {pgcrypto} from "@electric-sql/pglite/contrib/pgcrypto";
import worker from "../backend/rainbow-api/src/index.js";
import {hmacHex} from "../backend/rainbow-api/src/payment-crypto.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const port=Number(process.env.CHECKOUT_FIXTURE_PORT||8844);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Invalid fixture port");
const origin="http://127.0.0.1:"+port;
const fakeApi="https://rainbow-checkout-fixture.invalid";
const fakeDb="https://supabase-checkout-fixture.invalid";
const env={PAYMENTS_ENABLED:"true",PAYMENTS_MODE:"test",LIVE_PAYMENTS_RELEASED:"false",
 RAZORPAY_KEY_ID:"rzp_test_Fixture123",RAZORPAY_KEY_SECRET:"fixture-test-secret",
 RAZORPAY_WEBHOOK_SECRET:"fixture-webhook-secret",SUPABASE_URL:fakeDb,
 SUPABASE_SERVICE_ROLE_KEY:"fixture-service-only",ALLOWED_ORIGINS:origin,
 CHECKOUT_RATE_LIMITER:{limit:async()=>({success:true})}};
let db,providerOrders=new Map(),providerPayments=new Map(),events=[],sequence=0;
let scenario={verifyFailure:false};
const rpcTypes={
 create_razorpay_checkout:{p_checkout_id:"uuid",p_items:"jsonb",p_customer:"jsonb"},
 attach_razorpay_order:{p_checkout_id:"uuid",p_gateway_order_id:"text",p_amount_paise:"bigint"},
 get_razorpay_checkout:{p_checkout_id:"uuid"},
 complete_razorpay_checkout:{p_gateway_order_id:"text",p_payment_id:"text",p_amount_paise:"bigint",p_event_id:"text"},
 set_razorpay_whatsapp_opt_in:{p_checkout_id:"uuid",p_opt_in:"boolean"},
 get_paid_razorpay_receipt:{p_checkout_id:"uuid",p_gateway_order_id:"text"},
 expire_razorpay_checkouts:{p_limit:"integer"},get_public_invoice:{p_token:"uuid"},
 create_online_order:{p_items:"jsonb",p_customer:"jsonb"}
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
async function reset(){
 if(db)await db.close();
 db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
 for(const name of ["tests/sql/payment-fixture.sql",
  "supabase/migrations/20261021194000_razorpay_test_reservation_checkout.sql",
  "supabase/migrations/20261021202500_manual_upi_guest_idempotency.sql",
  "tests/fixtures/checkout-postgres.sql",
  "supabase/migrations/20261021234000_finalize_paid_orders_invoice_whatsapp.sql"])
  await db.exec(await fs.readFile(path.join(root,name),"utf8"));
 await db.exec("set request.jwt.claim.role='service_role'");
 providerOrders=new Map();providerPayments=new Map();events=[];sequence=0;
 scenario={verifyFailure:false};
}
async function rpc(name,payload){
 const types=rpcTypes[name];if(!types)throw new Error("Unexpected fixture RPC "+name);
 const keys=Object.keys(types),args=keys.map((key,i)=>key+"=>$"+(i+1)+"::"+types[key]);
 const values=keys.map(key=>types[key]==="jsonb"?JSON.stringify(payload[key]):payload[key]??null);
 const result=await db.query("select public."+name+"("+args.join(",")+") as value",values);
 events.push({type:"rpc",name});return result.rows[0]?.value??null;
}

// Deliberately replace Node's outbound transport: unknown hosts always fail closed.
globalThis.fetch=async (input,options={})=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 const body=options.body?JSON.parse(options.body):{};
 if(url.origin===fakeDb&&url.pathname.startsWith("/rest/v1/rpc/")){
  try{return json(await rpc(url.pathname.split("/").at(-1),body));}
  catch(error){events.push({type:"rpc_error",message:error.message});return json({message:error.message},400);}
 }
 if(url.origin!=="https://api.razorpay.com")throw new Error("Outbound network blocked by checkout fixture: "+url.origin);
 const method=options.method||"GET",pathname=url.pathname;
 events.push({type:"simulated_provider",method,path:pathname});
 if(pathname==="/v1/orders"&&method==="POST"){
  const id="order_fixture"+String(++sequence).padStart(8,"0");
  const value={...body,id,status:"created",amount_paid:0,amount_due:body.amount};
  providerOrders.set(id,value);return json(value);
 }
 if(pathname==="/v1/orders")return json({items:[...providerOrders.values()].filter(x=>!url.searchParams.has("receipt")||x.receipt===url.searchParams.get("receipt"))});
 if(pathname.startsWith("/v1/orders/"))return providerOrders.has(pathname.split("/").at(-1))?json(providerOrders.get(pathname.split("/").at(-1))):json({},404);
 if(pathname.startsWith("/v1/payments/"))return providerPayments.has(pathname.split("/").at(-1))?json(providerPayments.get(pathname.split("/").at(-1))):json({},404);
 return json({error:"Unsupported simulated provider route"},404);
};

async function selectTable(table,filters={}){
 let data;
 if(table==="product_variants")data=(await db.query("select * from public.product_variants")).rows;
 else if(table==="products"){
  data=(await db.query("select * from public.products")).rows;
  const variants=(await db.query("select * from public.product_variants")).rows;
  data=data.map(p=>({...p,description:"Synthetic local QA jewellery only",gender:"unisex",category_id:"dddddddd-dddd-4ddd-dddd-dddddddddddd",
   categories:{name:"Chain",storefront_order:1,show_in_storefront:true},product_images:[],
   product_variants:variants.filter(v=>v.product_id===p.id)}));
 }else if(table==="categories")data=[{id:"dddddddd-dddd-4ddd-dddd-dddddddddddd",name:"Chain",active:true,storefront_order:1,show_in_storefront:true}];
 else if(table==="business_settings")data=[{id:true,business_name:"Rainbow Gold Covering",legal_display_name:"Rainbow Gold Covering",trust_line:"Local QA only"}];
 else data=[];
 for(const [column,value]of Object.entries(filters.eq||{}))data=data.filter(row=>String(row[column])===String(value));
 for(const [column,value]of Object.entries(filters.in||{}))data=data.filter(row=>value.map(String).includes(String(row[column])));
 const count=data.length;
 if(filters.range)data=data.slice(filters.range[0],filters.range[1]+1);
 else if(filters.limit)data=data.slice(0,filters.limit);
 return {data:filters.single?(data[0]||null):data,error:null,count};
}
async function state(){
 const first=async sql=>(await db.query(sql)).rows;
 return {fixture:true,mode:"test",realProvider:false,externalNetworkAllowed:false,
  products:await first("select product_code,product_name,selling_price from public.products"),
  variants:await first("select id,stock_quantity from public.product_variants"),
  checkouts:await first("select checkout_id,gateway_order_id,status,amount_paise from public.razorpay_checkouts order by created_at"),
  orders:await first("select order_number,status,payment_status,total_amount from public.orders order by created_at"),
  payments:await first("select method,status,amount,transaction_reference from public.payments order by created_at"),
  invoices:await first("select invoice_number,public_token from public.invoices order by issued_at"),
  inventory:await first("select transaction_type,quantity,quantity_delta from public.inventory_transactions"),
  notifications:await first("select notification_type,status from public.whatsapp_notifications"),
  simulatedProviderOrders:providerOrders.size,events};
}
async function body(req){
 let value="";for await(const chunk of req){value+=chunk;if(value.length>30000)throw new Error("Fixture request too large");}
 return value?JSON.parse(value):{};
}
async function send(res,response){
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".svg":"image/svg+xml"};
await reset();
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);
  if(req.headers.host!=="127.0.0.1:"+port)return send(res,json({error:"Loopback fixture only"},403));
  if(url.pathname==="/__fixture/state")return send(res,json(await state()));
  if(url.pathname==="/__fixture/reset"&&req.method==="POST"){await reset();return send(res,json({ok:true}));}
  if(url.pathname==="/__fixture/db/select")return send(res,json(await selectTable(url.searchParams.get("table"),JSON.parse(url.searchParams.get("filters")||"{}"))));
  if(url.pathname==="/__fixture/db/rpc"&&req.method==="POST"){
   const input=await body(req);if(!["get_public_invoice","create_online_order"].includes(input.name))return send(res,json({data:null,error:{message:"Only public checkout/invoice RPCs are exposed to the fixture browser"}},403));
   return send(res,json({data:await rpc(input.name,input.payload),error:null}));
  }
  if(url.pathname==="/__fixture/pay"&&req.method==="POST"){
   const input=await body(req),order=providerOrders.get(input.order_id);
   if(!order)return send(res,json({error:"Unknown local provider order"},404));
   const id="pay_fixture"+String(++sequence).padStart(8,"0");
   const payment={id,order_id:order.id,amount:order.amount,currency:"INR",status:input.status==="authorized"?"authorized":"captured"};
   providerPayments.set(id,payment);
   return send(res,json({razorpay_order_id:order.id,razorpay_payment_id:id,
    razorpay_signature:await hmacHex(env.RAZORPAY_KEY_SECRET,order.id+"|"+id)}));
  }
  if(url.pathname==="/__fixture/capture"&&req.method==="POST"){
   const input=await body(req),payment=providerPayments.get(input.payment_id);
   if(!payment)return send(res,json({error:"Unknown local provider payment"},404));
   payment.status="captured";
   return send(res,json({razorpay_order_id:payment.order_id,razorpay_payment_id:payment.id,
    razorpay_signature:await hmacHex(env.RAZORPAY_KEY_SECRET,payment.order_id+"|"+payment.id)}));
  }
  if(url.pathname==="/__fixture/webhook"&&req.method==="POST"){
   const input=await body(req),payment=providerPayments.get(input.payment_id);
   if(!payment)return send(res,json({error:"Unknown local provider payment"},404));
   const raw=JSON.stringify({event:"payment.captured",payload:{payment:{entity:payment}}});
   const request=new Request(fakeApi+"/api/razorpay/webhook",{method:"POST",headers:{
    "Content-Type":"application/json","x-razorpay-event-id":String(input.event_id||"fixture-event-1"),
    "x-razorpay-signature":await hmacHex(env.RAZORPAY_WEBHOOK_SECRET,raw)},body:raw});
   return send(res,await worker.fetch(request,env));
  }
  if(url.pathname==="/__fixture/expire"&&req.method==="POST"){
   const input=await body(req);
   await db.query("update public.razorpay_checkouts set expires_at=now()-interval '36 minutes' where checkout_id=$1::uuid",[input.checkout_id]);
   return send(res,json({expired:await rpc("expire_razorpay_checkouts",{p_limit:100})}));
  }
  if(url.pathname.startsWith("/__fixture/api/razorpay/")){
   if(scenario.verifyFailure&&url.pathname.endsWith("/verify")){scenario.verifyFailure=false;return send(res,json({error:"Simulated temporary verification failure"},503));}
   const text=req.method==="GET"?undefined:JSON.stringify(await body(req));
   const request=new Request(fakeApi+url.pathname.slice("/__fixture".length)+url.search,{method:req.method,
    headers:{Origin:origin,"Content-Type":"application/json"},...(text?{body:text}:{})});
   return send(res,await worker.fetch(request,env));
  }
  if(url.pathname==="/__fixture/verify-failure"&&req.method==="POST"){scenario.verifyFailure=true;return send(res,json({ok:true}));}
  if(url.pathname==="/__fixture/bootstrap.js")return send(res,new Response(await fs.readFile(path.join(root,"tests/fixtures/checkout-browser.js")),{headers:{"Content-Type":"text/javascript"}}));
  if(url.pathname==="/__fixture/sdk-placeholder.js")return send(res,new Response("/* SDK transport is the local fixture bootstrap. */",{headers:{"Content-Type":"text/javascript"}}));
  if(url.pathname==="/admin/config.js")return send(res,new Response("window.RAINBOW_SUPABASE_CONFIG={supabaseUrl:"+JSON.stringify(fakeDb)+",supabasePublishableKey:'fixture-public-only'};",{headers:{"Content-Type":"text/javascript"}}));
  if(url.pathname==="/payment-config.js")return send(res,new Response("window.RAINBOW_PAYMENT_CONFIG={apiBaseUrl:"+JSON.stringify(fakeApi)+"};",{headers:{"Content-Type":"text/javascript"}}));
  const pathname=decodeURIComponent(url.pathname==="/"?"/order.html":url.pathname),file=path.resolve(root,"."+pathname);
  if(!file.startsWith(root+path.sep)||!/^\/(?:order[^/]*|invoice[^/]*|index\.html|content[^/]*|mobile-storefront[^/]*|config\.js|shop-[^/]*|analytics\.js|business-live\.js|supabase-client\.js|recovery-redirect\.js|assets\/[^?]+)$/.test(pathname))return send(res,json({error:"Not a checkout fixture asset"},404));
  let content=await fs.readFile(file);
  if(file.endsWith(".html")){
   let html=content.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/g,'<script src="/__fixture/sdk-placeholder.js"></script>');
   html=html.replace(/<head([^>]*)>/i,'<head$1><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\'; img-src \'self\' data: blob:; frame-src \'none\'; form-action \'self\'; base-uri \'self\'"><script src="/__fixture/bootstrap.js"></script>');
   content=Buffer.from(html);
  }
  res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(content);
 }catch(error){console.error("Fixture request failed:",error.message);return send(res,json({error:error.message},500));}
});
server.listen(port,"127.0.0.1",()=>console.log("LOCAL SIMULATED CHECKOUT: "+origin+"/order.html — outbound network disabled"));
for(const name of ["SIGINT","SIGTERM"])process.once(name,()=>server.close(async()=>{await db.close();process.exit(0);}));
