import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {hmacHex,verifyHmac,isTestConfigured,isLiveConfigured,isPaymentsConfigured,gatewayCredentials} from "../src/payment-crypto.js";

const baseEnv={
  PAYMENTS_ENABLED:"true",RAZORPAY_KEY_ID:"rzp_test_Example123",
  RAZORPAY_KEY_SECRET:"test-secret",RAZORPAY_WEBHOOK_SECRET:"test-webhook",
  SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fake-service",
  ALLOWED_ORIGINS:"https://jofalinj.github.io",
  CHECKOUT_RATE_LIMITER:{limit:async()=>({success:true})}
};
const checkoutId="4d43dc4b-f8e4-4629-972b-7979f3abcdf7";
const rOrder="order_example12345",rPayment="pay_example1234567";
const checkoutCustomer={
  name:"Test Customer",whatsapp_number:"9999999999",
  address:"Test address",state:"Tamil Nadu"
};
const items=[{variant_id:"8dde9565-0a39-4acb-b177-3defabc81765",quantity:1}];
function request(path,body,method="POST",origin="https://jofalinj.github.io",headers={}){
  return new Request("https://rainbow-api.example"+path,{
    method,headers:{"Origin":origin,...(body===undefined?{}:{"Content-Type":"application/json"}),...headers},
    ...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)})
  });
}
function mockReply(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
}
function mockFetch(responses,record){
  return async (url,options={})=>{
    const path=new URL(url.toString()).pathname;
    record.push({path,method:options.method||"GET"});
    if(!(path in responses))throw new Error("Unexpected fetch "+path);
    const response=responses[path];
    return typeof response==="function"?response(options):mockReply(response);
  };
}
test("HMAC verifies signatures and rejects altered data",async()=>{
  const signature=await hmacHex("key","order_1|pay_1");
  assert.equal(signature.length,64);
  assert.equal(await verifyHmac("key","order_1|pay_1",signature),true);
  assert.equal(await verifyHmac("key","order_2|pay_1",signature),false);
  assert.equal(await verifyHmac("key","order_1|pay_1","bad"),false);
});
test("default is fail-closed, including accidental live keys",async()=>{
  assert.equal(isTestConfigured({}),false);
  assert.equal(isTestConfigured({...baseEnv,RAZORPAY_KEY_ID:"rzp_live_Example123"}),false);
  assert.equal(isTestConfigured({...baseEnv,PAYMENTS_SUSPENDED:"true"}),false);
  let res=await worker.fetch(request("/api/razorpay/config",undefined,"GET"),{});
  assert.equal((await res.json()).enabled,false);
  res=await worker.fetch(request("/api/razorpay/create",{checkout_id:checkoutId,items,customer:checkoutCustomer}),{});
  assert.equal(res.status,503);
});
test("health check remains operational",async()=>{
  const res=await worker.fetch(request("/api/health",undefined,"GET"),{});
  assert.equal(res.status,200);
  assert.equal((await res.json()).status,"online");
});
test("CORS blocks unknown origins without exposing payment secrets",async()=>{
  const res=await worker.fetch(request("/api/razorpay/create",{checkout_id:checkoutId,items,customer:checkoutCustomer},"POST","https://malicious.example"),baseEnv);
  assert.equal(res.status,403);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"),null);
  const config=await worker.fetch(request("/api/razorpay/config",undefined,"GET"),baseEnv);
  const body=await config.json();
  assert.equal(body.enabled,true);
  assert.equal(body.release,"paid-invoice-20261021-v4");
  assert.equal(body.keyId,baseEnv.RAZORPAY_KEY_ID);
  assert.equal(JSON.stringify(body).includes(baseEnv.RAZORPAY_KEY_SECRET),false);
  assert.equal(config.headers.get("Access-Control-Allow-Origin"),"https://jofalinj.github.io");
});
test("payment requests fail closed without a rate limiter",async()=>{
  const env={...baseEnv,CHECKOUT_RATE_LIMITER:undefined};
  const res=await worker.fetch(request("/api/razorpay/create",{
    checkout_id:checkoutId,items,customer:checkoutCustomer
  }),env);
  assert.equal(res.status,503);
  assert.match((await res.json()).error,/protection/);
});
test("rate-limited requests return HTTP 429 without creating orders",async()=>{
  const env={...baseEnv,CHECKOUT_RATE_LIMITER:{
    limit:async({key})=>{
      assert.match(key,/\/api\/razorpay\/create$/);
      return {success:false};
    }
  }};
  const res=await worker.fetch(request("/api/razorpay/create",{
    checkout_id:checkoutId,items,customer:checkoutCustomer
  }),env);
  assert.equal(res.status,429);
});
test("rejected browser request never creates orders",async()=>{
  const res=await worker.fetch(request("/api/razorpay/create",
    {checkout_id:"wrong",items,customer:checkoutCustomer}),baseEnv);
  assert.equal(res.status,400);
});
test("creates only the database-approved order amount",async()=>{
  const oldFetch=globalThis.fetch, calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{
      state:"new",order_number:"RG-TEST123",amount_paise:50050,
      expires_at:"2099-01-01T00:00:00Z"
    },
    "/v1/orders":options=>{
      const body=JSON.parse(options.body);
      assert.equal(body.amount,50050);
      assert.equal(body.currency,"INR");
      return mockReply({id:rOrder,amount:50050,currency:"INR"});
    },
    "/rest/v1/rpc/attach_razorpay_order":{
      state:"ready",gateway_order_id:rOrder
    }
  },calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/create",
      {checkout_id:checkoutId,items,customer:checkoutCustomer}),baseEnv);
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.gatewayOrderId,rOrder);
    assert.equal(body.amount,50050);
    assert.deepEqual(calls.map(x=>x.path),[
      "/rest/v1/rpc/create_razorpay_checkout","/v1/orders",
      "/rest/v1/rpc/attach_razorpay_order"
    ]);
  }finally{globalThis.fetch=oldFetch;}
});
test("creating state checks Razorpay receipt but never creates a duplicate provider order",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{state:"creating",amount_paise:1000,
      expires_at:"2099-01-01T00:00:00Z",order_number:"RG-TEST123"},
    "/v1/orders":{items:[]}
  },calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/create",
      {checkout_id:checkoutId,items,customer:checkoutCustomer}),baseEnv);
    assert.equal(res.status,409);
    assert.deepEqual(calls.map(x=>x.method),["POST","GET"]);
  }finally{globalThis.fetch=oldFetch;}
});
test("reuses the exact Razorpay receipt after a lost database attachment",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  const receipt=checkoutId.replace(/-/g,"");
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{state:"creating",amount_paise:1000,
      expires_at:"2099-01-01T00:00:00Z",order_number:"RG-TEST123"},
    "/v1/orders":{items:[{receipt,id:rOrder,amount:1000,currency:"INR",status:"created"}]},
    "/rest/v1/rpc/attach_razorpay_order":{state:"ready",gateway_order_id:rOrder}
  },calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/create",
      {checkout_id:checkoutId,items,customer:checkoutCustomer}),baseEnv);
    assert.equal(res.status,200);
    assert.equal((await res.json()).gatewayOrderId,rOrder);
    assert.deepEqual(calls.map(x=>x.method),["POST","GET","POST"]);
  }finally{globalThis.fetch=oldFetch;}
});
test("ambiguous receipts are not attached to the local payment reservation",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  const receipt=checkoutId.replace(/-/g,"");
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{state:"creating",amount_paise:1000,
      expires_at:"2099-01-01T00:00:00Z",order_number:"RG-TEST123"},
    "/v1/orders":{items:[
      {receipt,id:rOrder,amount:1000,currency:"INR",status:"created"},
      {receipt,id:"order_second00000",amount:1000,currency:"INR",status:"created"}
    ]}
  },calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/create",
      {checkout_id:checkoutId,items,customer:checkoutCustomer}),baseEnv);
    assert.equal(res.status,409);
    assert.deepEqual(calls.map(x=>x.method),["POST","GET"]);
  }finally{globalThis.fetch=oldFetch;}
});
test("provider-check never returns gateway order data or credentials",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/v1/orders":{items:[{id:"order_private",receipt:"private"}]}
  },calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/provider-check",undefined,"GET"),baseEnv);
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{provider:"connected"});
    assert.deepEqual(calls.map(x=>x.method),["GET"]);
  }finally{globalThis.fetch=oldFetch;}
});
test("provider-check reports credentials rejected without exposing sensitive details",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({"/v1/orders":()=>mockReply({error:"private"},401)},calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/provider-check",undefined,"GET"),baseEnv);
    assert.deepEqual(await res.json(),{provider:"credentials_rejected"});
  }finally{globalThis.fetch=oldFetch;}
});
test("expired reservation is confirmed before client can safely replace its checkout token",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{state:"expired",amount_paise:1000}
  },calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/create",
      {checkout_id:checkoutId,items,customer:checkoutCustomer}),baseEnv);
    assert.equal(res.status,410);
    assert.equal((await res.json()).code,"CHECKOUT_EXPIRED");
    assert.deepEqual(calls.map(x=>x.path),["/rest/v1/rpc/create_razorpay_checkout"]);
  }finally{globalThis.fetch=oldFetch;}
});
test("provider amount mismatch is rejected before database attachment",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{
      state:"new",order_number:"RG-TEST123",amount_paise:1000,
      expires_at:"2099-01-01T00:00:00Z"
    },
    "/v1/orders":{id:rOrder,amount:500,currency:"INR"}
  },calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/create",
      {checkout_id:checkoutId,items,customer:checkoutCustomer}),baseEnv);
    assert.equal(res.status,503);
    assert.equal(calls.some(x=>x.path.includes("attach_razorpay_order")),false);
  }finally{globalThis.fetch=oldFetch;}
});
test("bad browser payment signature is rejected without fetching payment",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/get_razorpay_checkout":{
      state:"ready",gateway_order_id:rOrder,amount_paise:50050
    }
  },calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/verify",{
      checkout_id:checkoutId,razorpay_order_id:rOrder,
      razorpay_payment_id:rPayment,razorpay_signature:"f".repeat(64)
    }),baseEnv);
    assert.equal(res.status,401);
    assert.equal(calls.length,1);
  }finally{globalThis.fetch=oldFetch;}
});
test("captured payment requires matching order, INR amount and verified HMAC",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/get_razorpay_checkout":{
      state:"ready",gateway_order_id:rOrder,amount_paise:50050
    },
    ["/v1/payments/"+rPayment]:{
      id:rPayment,order_id:rOrder,amount:50050,currency:"INR",status:"captured"
    },
    "/rest/v1/rpc/complete_razorpay_checkout":{paid:true,state:"paid",order_number:"RG-TEST123"},
    "/rest/v1/rpc/get_paid_razorpay_receipt":{
      order_number:"RG-TEST123",invoice_number:"RGC-INV-TEST",
      invoice_url:"https://rainbowgoldcovering.com/invoice.html?token=00000000-0000-4000-8000-000000000001"
    }
  },calls);
  try{
    const sig=await hmacHex(baseEnv.RAZORPAY_KEY_SECRET,rOrder+"|"+rPayment);
    const res=await worker.fetch(request("/api/razorpay/verify",{
      checkout_id:checkoutId,razorpay_order_id:rOrder,
      razorpay_payment_id:rPayment,razorpay_signature:sig
    }),baseEnv);
    assert.equal(res.status,200);
    const receipt=await res.json();
    assert.equal(receipt.paid,true);
    assert.match(receipt.invoiceUrl,/invoice\.html\?token=/);
    assert.equal(calls.length,4);
  }finally{globalThis.fetch=oldFetch;}
});
test("webhook rejects invalid signature before querying provider",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({},calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/webhook","{}", "POST","",{
      "x-razorpay-signature":"f".repeat(64),"x-razorpay-event-id":"evt_123"
    }),baseEnv);
    assert.equal(res.status,401);
    assert.equal(calls.length,0);
  }finally{globalThis.fetch=oldFetch;}
});
test("valid payment.captured webhook rechecks provider and settles",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  const payload=JSON.stringify({event:"payment.captured",payload:{
    payment:{entity:{id:rPayment,order_id:rOrder}}}});
  globalThis.fetch=mockFetch({
    ["/v1/payments/"+rPayment]:{
      id:rPayment,order_id:rOrder,amount:2500,currency:"INR",status:"captured"
    },
    "/rest/v1/rpc/complete_razorpay_checkout":options=>{
      const body=JSON.parse(options.body);
      assert.equal(body.p_event_id,"evt_123");
      assert.equal(body.p_amount_paise,2500);
      return mockReply({paid:true,state:"paid"});
    }
  },calls);
  try{
    const sig=await hmacHex(baseEnv.RAZORPAY_WEBHOOK_SECRET,payload);
    const res=await worker.fetch(request("/api/razorpay/webhook",payload,"POST","",{
      "x-razorpay-signature":sig,"x-razorpay-event-id":"evt_123"
    }),baseEnv);
    assert.equal(res.status,200);
    assert.equal((await res.json()).paid,true);
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=oldFetch;}
});

const liveEnv={...baseEnv,PAYMENTS_MODE:"live",
  RAZORPAY_LIVE_KEY_ID:"rzp_live_Example123",RAZORPAY_LIVE_KEY_SECRET:"live-secret",
  RAZORPAY_LIVE_WEBHOOK_SECRET:"live-webhook",LIVE_PAYMENTS_RELEASED:"true",
  ALLOWED_ORIGINS:"https://rainbowgoldcovering.com,https://jofalinj.github.io"};
test("live mode requires a separate release flag and dedicated live keys",async()=>{
  assert.equal(isLiveConfigured({...baseEnv,PAYMENTS_MODE:"live"}),false);
  assert.equal(isLiveConfigured({...liveEnv,LIVE_PAYMENTS_RELEASED:"false"}),false);
  assert.equal(isLiveConfigured({...liveEnv,RAZORPAY_LIVE_KEY_ID:baseEnv.RAZORPAY_KEY_ID}),false);
  assert.equal(isLiveConfigured({...liveEnv,RAZORPAY_LIVE_KEY_SECRET:null}),false);
  assert.equal(isLiveConfigured({...liveEnv,PAYMENTS_SUSPENDED:"true"}),false);
  assert.equal(isLiveConfigured(liveEnv),true);
  assert.equal(isPaymentsConfigured(liveEnv),true);
  assert.equal(gatewayCredentials(liveEnv).keySecret,"live-secret");
  const res=await worker.fetch(request("/api/razorpay/config",undefined,"GET",
    "https://rainbowgoldcovering.com"),liveEnv);
  const body=await res.json();
  assert.equal(body.enabled,true);
  assert.equal(body.mode,"live");
  assert.equal(body.keyId,"rzp_live_Example123");
  assert.ok(!JSON.stringify(body).includes("live-secret"));
  assert.ok(!JSON.stringify(body).includes("live-webhook"));
});
test("live mode denies the GitHub Pages origin and never creates a real order there",async()=>{
  const res=await worker.fetch(request("/api/razorpay/create",{
    checkout_id:checkoutId,items,customer:checkoutCustomer
  }),liveEnv);
  assert.equal(res.status,403);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"),null);
});
test("live mode accepts a release-authorized production checkout with live public key",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{
      state:"ready",gateway_order_id:rOrder,order_number:"RG-LIVE",amount_paise:19900,
      expires_at:"2099-01-01T00:00:00Z"
    }
  },calls);
  try {
    const res=await worker.fetch(request("/api/razorpay/create",
      {checkout_id:checkoutId,items,customer:checkoutCustomer},
      "POST","https://rainbowgoldcovering.com"),liveEnv);
    assert.equal(res.status,200);
    assert.deepEqual((await res.json()).mode,"live");
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=oldFetch;}
});
test("webhook can reconcile captured live payment while checkout is suspended",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  const payload=JSON.stringify({event:"payment.captured",payload:{
    payment:{entity:{id:rPayment,order_id:rOrder}}}});
  globalThis.fetch=mockFetch({
    ["/v1/payments/"+rPayment]:{
      id:rPayment,order_id:rOrder,amount:2500,currency:"INR",status:"captured"
    },
    "/rest/v1/rpc/complete_razorpay_checkout":{paid:true,state:"paid"}
  },calls);
  try {
    const env={...liveEnv,PAYMENTS_SUSPENDED:"true"};
    assert.equal(isPaymentsConfigured(env),false);
    const sig=await hmacHex(env.RAZORPAY_LIVE_WEBHOOK_SECRET,payload);
    const res=await worker.fetch(request("/api/razorpay/webhook",payload,"POST","",{
      "x-razorpay-signature":sig,"x-razorpay-event-id":"evt_live_123"
    }),env);
    assert.equal(res.status,200);
    assert.equal((await res.json()).paid,true);
    assert.equal(calls.length,2);
  } finally {globalThis.fetch=oldFetch;}
});
