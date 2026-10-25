import test from "node:test";
import assert from "node:assert/strict";
import { erpCatalogue } from "../src/routes/erp-catalogue.js";

const environment={
 ERP_CATALOGUE_ENABLED:"true",
 SUPABASE_URL:"https://example.supabase.co",
 SUPABASE_SERVICE_ROLE_KEY:"fake-service-key"
};
test("disabled ERP API never calls the database",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=()=>{throw Error("Must not fetch");};
 try{
 const response=await erpCatalogue(new Request("https://example.com/api/erp/catalogue"),{});
 assert.equal(response.status,404);
 assert.equal((await response.json()).success,false);
 }finally{globalThis.fetch=original;}
});
test("public request retrieves only the controlled database projection",async()=>{
 const original=globalThis.fetch;
 let call=null;
 globalThis.fetch=async(input,options)=>{
  call={url:String(input),...options};
  return new Response(JSON.stringify({page:0,page_size:12,items:[{product_code:"JM001",available:2}]}),{
   headers:{"Content-Type":"application/json"}
  });
 };
 try{
  const request=new Request("https://example.com/api/erp/catalogue?limit=12&q=Jimmiki",{
   headers:{Origin:"https://rainbowgoldcovering.com"}
  });
  const response=await erpCatalogue(request,environment);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"),"https://rainbowgoldcovering.com");
  assert.match(response.headers.get("Cache-Control"),/max-age=15/);
  assert.equal(call.url,"https://example.supabase.co/rest/v1/rpc/erp_public_catalogue");
  assert.deepEqual(JSON.parse(call.body),{p_page:0,p_limit:12,p_search:"Jimmiki"});
  const result=await response.json();
  assert.equal(result.items[0].available,2);
  assert.equal(result.success,true);
 }finally{globalThis.fetch=original;}
});
test("rejects unsafe unbounded catalogue inputs before fetching",async()=>{
 const original=globalThis.fetch;let called=false;
 globalThis.fetch=()=>{called=true;throw Error("Network call must not happen");};
 try{
  for(const invalid of ["?limit=5000","?limit=0","?page=-1","?q="+("x".repeat(71))]){
   const response=await erpCatalogue(new Request("https://example.com/api/erp/catalogue"+invalid),environment);
   assert.equal(response.status,400);
  }
  assert.equal(called,false);
 }finally{globalThis.fetch=original;}
});
test("HEAD suppresses body and untrusted origins get no CORS grant",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({items:[],page:0,page_size:24}));
 try{
  const response=await erpCatalogue(new Request("https://example.com/api/erp/catalogue",{
   method:"HEAD",headers:{Origin:"https://malicious.invalid"}
  }),environment);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"),null);
  assert.equal(await response.text(),"");
 }finally{globalThis.fetch=original;}
});
test("unsupported methods do not invoke the database",async()=>{
 const response=await erpCatalogue(new Request("https://example.com/api/erp/catalogue",{method:"POST"}),environment);
 assert.equal(response.status,405);
 assert.equal(response.headers.get("Allow"),"GET, HEAD, OPTIONS");
});
