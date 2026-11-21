import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {hmacHex} from "../src/payment-crypto.js";

const env={
  WHATSAPP_APP_SECRET:"fake-test-app-secret",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN:"local-verification-token",
  WHATSAPP_PHONE_NUMBER_ID:"123456789012",
  SUPABASE_URL:"https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:"fake-local-service-key"
};
const messageId="wamid.HBgMfake_message_123456";
const rawStatus=(status="delivered",phoneId=env.WHATSAPP_PHONE_NUMBER_ID)=>
  JSON.stringify({object:"whatsapp_business_account",entry:[{
    changes:[{field:"messages",value:{
      metadata:{phone_number_id:phoneId},
      statuses:[{id:messageId,status,timestamp:"1760000000"}]
    }}]
  }]});
const request=(method,url,body,headers={})=>new Request(
  "https://worker.example"+url,{method,headers,
    ...(body===undefined?{}:{body})});
const signed=async body=>({
  "Content-Type":"application/json",
  "X-Hub-Signature-256":"sha256="+await hmacHex(env.WHATSAPP_APP_SECRET,body)
});

test("Meta verification token is required before webhook subscription",async()=>{
 const valid=await worker.fetch(request("GET",
  "/api/whatsapp/status?hub.mode=subscribe&hub.verify_token=local-verification-token&hub.challenge=12345"),env);
 assert.equal(valid.status,200);assert.equal(await valid.text(),"12345");
 const invalid=await worker.fetch(request("GET",
  "/api/whatsapp/status?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"),env);
 assert.equal(invalid.status,403);
 const unconfigured=await worker.fetch(request("GET",
  "/api/whatsapp/status?hub.mode=subscribe&hub.verify_token=local-verification-token&hub.challenge=12345"),
  {...env,WHATSAPP_WEBHOOK_VERIFY_TOKEN:undefined});
 assert.equal(unconfigured.status,403);
});
test("unsigned or forged status POST cannot write database",async()=>{
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);throw Error("no DB calls expected");};
 try{
  const raw=rawStatus();
  const res=await worker.fetch(request("POST","/api/whatsapp/status",raw,{
    "X-Hub-Signature-256":"sha256="+"0".repeat(64)
  }),env);
  assert.equal(res.status,401);assert.equal(calls.length,0);
 }finally{globalThis.fetch=old;}
});
test("signed delivered status is recorded through private RPC and nothing else",async()=>{
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts)=>{
  calls.push({url:new URL(url).pathname,method:opts.method,payload:JSON.parse(opts.body)});
  assert.equal(opts.headers.Authorization,"Bearer fake-local-service-key");
  return new Response("true",{status:200});
 };
 try{
  const raw=rawStatus("delivered");
  const res=await worker.fetch(request("POST","/api/whatsapp/status",raw,await signed(raw)),env);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{success:true,recorded:1});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"/rest/v1/rpc/record_whatsapp_delivery_status");
  assert.deepEqual(calls[0].payload,{
    p_provider_message_id:messageId,p_status:"delivered",
    p_status_at:new Date(1760000000*1000).toISOString()
  });
 }finally{globalThis.fetch=old;}
});
test("status for another business sender is ignored",async()=>{
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);throw Error("no DB call expected");};
 try{
  const raw=rawStatus("read","999999999999");
  const res=await worker.fetch(request("POST","/api/whatsapp/status",raw,await signed(raw)),env);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{success:true,ignored:true});
  assert.equal(calls.length,0);
 }finally{globalThis.fetch=old;}
});
test("a storage error is retriable; callback is never falsely acknowledged",async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async()=>new Response("error",{status:503});
 try{
  const raw=rawStatus("failed");
  const res=await worker.fetch(request("POST","/api/whatsapp/status",raw,await signed(raw)),env);
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{success:false,error:"Webhook temporarily unavailable"});
 }finally{globalThis.fetch=old;}
});
test("invalid messages cannot be recorded as delivery",async()=>{
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);throw Error("unexpected DB call");};
 try{
  const raw=rawStatus("unknown");
  const res=await worker.fetch(request("POST","/api/whatsapp/status",raw,await signed(raw)),env);
  assert.equal(res.status,200);assert.equal(calls.length,0);
 }finally{globalThis.fetch=old;}
});
