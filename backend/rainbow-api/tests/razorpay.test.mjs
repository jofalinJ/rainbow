import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {hmacHex,verifyHmac,isTestConfigured} from "../src/payment-crypto.js";

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
const manualCustomer={...checkoutCustomer,checkout_id:checkoutId,
  payment_method:"upi",payment_reference:"UPITEST123456"};
const databaseOnlyEnv={...baseEnv,PAYMENTS_ENABLED:"false",RAZORPAY_KEY_ID:undefined,
  RAZORPAY_KEY_SECRET:undefined,RAZORPAY_WEBHOOK_SECRET:undefined};
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
test("manual UPI uses the fixed service-role RPC while Razorpay is disabled",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_online_order":options=>{
      assert.equal(options.headers.apikey,baseEnv.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(options.headers.Authorization,"Bearer "+baseEnv.SUPABASE_SERVICE_ROLE_KEY);
      assert.deepEqual(JSON.parse(options.body),{p_items:items,p_customer:manualCustomer});
      return mockReply({order_number:"RG-MANUALTEST",total_amount:150,already_created:true});
    }
  },calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/manual-upi",{
      items:items.map(item=>({...item,price:1})),customer:{...manualCustomer,payment_status:"paid"},
      rpc:"complete_razorpay_checkout"
    },"POST",undefined,{Authorization:"Bearer browser-cannot-select-db-role"}),databaseOnlyEnv);
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{success:true,order_number:"RG-MANUALTEST",total_amount:150,already_created:true});
    assert.deepEqual(calls.map(call=>call.path),["/rest/v1/rpc/create_online_order"]);
  }finally{globalThis.fetch=oldFetch;}
});
test("manual UPI validates references, checkout UUID, bounded customer fields and unique items",async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch");};
  try{
    for(const body of [
      {items,customer:{...manualCustomer,checkout_id:"invalid"}},
      {items,customer:{...manualCustomer,payment_method:"cash"}},
      {items,customer:{...manualCustomer,payment_reference:"bad reference"}},
      {items,customer:{...manualCustomer,name:"x".repeat(161)}},
      {items,customer:{...manualCustomer,email:{address:"private"}}},
      {items,customer:{...manualCustomer,whatsapp_number:"123"}},
      {items,customer:{...manualCustomer,pin_code:"60000"}},
      {items,customer:{...manualCustomer,whatsapp_opt_in:"true"}},
      {items:[null],customer:manualCustomer},
      {items:[...items,...items],customer:manualCustomer},
      {items:items.map(item=>({...item,quantity:101})),customer:manualCustomer}
    ]){
      const res=await worker.fetch(request("/api/razorpay/manual-upi",body),databaseOnlyEnv);
      assert.equal(res.status,400);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});
test("guest tracking normalizes Indian phone numbers and excludes customer fields",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/track_guest_order_shipments":options=>{
      assert.equal(options.headers.Authorization,"Bearer "+baseEnv.SUPABASE_SERVICE_ROLE_KEY);
      assert.deepEqual(JSON.parse(options.body),{p_product_code:"RG-001",p_phone:"919999999999"});
      return mockReply([{order_number:"RG-TEST123",product_name:"Test product",shipment_status:"booked",
        whatsapp_number:"9999999999",email:"private@example.com",address:"Private address"}]);
    }
  },calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/track",{
      product_code:" RG-001 ",phone:"+91 99999-99999",rpc:"customers"
    }),databaseOnlyEnv);
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{success:true,orders:[{
      order_number:"RG-TEST123",product_name:"Test product",shipment_status:"booked"
    }]});
    assert.deepEqual(calls.map(call=>call.path),["/rest/v1/rpc/track_guest_order_shipments"]);
  }finally{globalThis.fetch=oldFetch;}
});
test("guest tracking gives an empty successful result without confirming an order",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({"/rest/v1/rpc/track_guest_order_shipments":[]},calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/track",{product_code:"RG-001",phone:"9999999999"}),databaseOnlyEnv);
    assert.equal(res.status,200);assert.deepEqual(await res.json(),{success:true,orders:[]});
  }finally{globalThis.fetch=oldFetch;}
});
test("guest tracking rejects unbounded codes and invalid Indian phone numbers",async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch");};
  try{
    for(const body of [{product_code:"",phone:"9999999999"},{product_code:"x".repeat(65),phone:"9999999999"},
      {product_code:"RG-001",phone:"123"},{product_code:"RG-001",phone:"19999999999"},
      {product_code:"RG-001",phone:"123456789012"},{product_code:"RG-001",phone:"919999999999999"},
      {product_code:"RG-001",phone:{value:"9999999999"}}]){
      const res=await worker.fetch(request("/api/razorpay/track",body),databaseOnlyEnv);
      assert.equal(res.status,400);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});
test("manual and tracking proxies require allowed Origin, shared protection and a safe DB configuration",async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch");};
  try{
    for(const path of ["/api/razorpay/manual-upi","/api/razorpay/track"]){
      for(const origin of ["https://malicious.example",""]){
        const res=await worker.fetch(request(path,{},"POST",origin),databaseOnlyEnv);
        assert.equal(res.status,403);
      }
      for(const env of [{...databaseOnlyEnv,SUPABASE_URL:undefined},
        {...databaseOnlyEnv,SUPABASE_URL:"http://example.supabase.co"},
        {...databaseOnlyEnv,SUPABASE_URL:"https://example.supabase.co/?key=secret"},
        {...databaseOnlyEnv,SUPABASE_SERVICE_ROLE_KEY:""},
        {...databaseOnlyEnv,CHECKOUT_RATE_LIMITER:undefined}]){
        const res=await worker.fetch(request(path,{}),env);assert.equal(res.status,503);
      }
      const res=await worker.fetch(request(path,{}),{...databaseOnlyEnv,
        CHECKOUT_RATE_LIMITER:{limit:async({key})=>{assert.match(key,new RegExp(path+"$"));return {success:false};}}
      });
      assert.equal(res.status,429);assert.equal(res.headers.get("Retry-After"),"60");
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});
test("manual and tracking proxies reject malformed JSON and oversized bodies before any RPC",async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch");};
  try{
    for(const path of ["/api/razorpay/manual-upi","/api/razorpay/track"]){
      for(const [body,status,headers] of [["{",400,{}],["[]",400,{}],
        [JSON.stringify({value:"₹".repeat(5000)}),413,{}],["{}",415,{"Content-Type":"text/plain"}]]){
        const res=await worker.fetch(request(path,body,"POST",undefined,headers),databaseOnlyEnv);
        assert.equal(res.status,status);
      }
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});
test("proxy upstream errors never expose database details or secrets",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_online_order":()=>mockReply({error:"private customer data fake-service"},400),
    "/rest/v1/rpc/track_guest_order_shipments":()=>mockReply({error:"private customer data fake-service"},500)
  },calls);
  try{
    for(const [path,body] of [["/api/razorpay/manual-upi",{items,customer:manualCustomer}],
      ["/api/razorpay/track",{product_code:"RG-001",phone:"9999999999"}]]){
      const res=await worker.fetch(request(path,body),databaseOnlyEnv);
      assert.equal(res.status,503);const text=await res.text();
      assert.equal(text.includes("private customer"),false);assert.equal(text.includes("fake-service"),false);
    }
  }finally{globalThis.fetch=oldFetch;}
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
    assert.equal(body.recoveryToken,await hmacHex(baseEnv.RAZORPAY_KEY_SECRET,
      "checkout-recovery:v1|"+checkoutId+"|"+rOrder));
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
    const body=await res.json();
    assert.equal(body.gatewayOrderId,rOrder);
    assert.equal(body.recoveryToken,await hmacHex(baseEnv.RAZORPAY_KEY_SECRET,
      "checkout-recovery:v1|"+checkoutId+"|"+rOrder));
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
      id:rPayment,order_id:rOrder,amount:50050,currency:"INR",status:"captured",
      captured:true,amount_refunded:0,refund_status:null
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
      id:rPayment,order_id:rOrder,amount:2500,currency:"INR",status:"captured",
      captured:true,amount_refunded:0,refund_status:null
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

test("rate limiter exceptions and malformed replies fail closed without upstream requests",async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch");};
  try{
    for(const limit of [async()=>{throw new Error("Binding unavailable");},async()=>undefined,async()=>({success:"true"})]){
      for(const [path,method] of [["/api/razorpay/create","POST"],["/api/razorpay/provider-check","GET"],
        ["/api/razorpay/status","POST"],["/api/razorpay/manual-upi","POST"],["/api/razorpay/track","POST"]]){
        const res=await worker.fetch(request(path,method==="POST"?{}:undefined,method),{
          ...baseEnv,CHECKOUT_RATE_LIMITER:{limit}
        });
        assert.equal(res.status,503);
        assert.match((await res.json()).error,/protection/);
      }
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});

test("malformed, unsupported and oversized JSON is rejected before creating a reservation",async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch");};
  try{
    for(const [body,status,headers] of [["{",400,{}],["[]",400,{}],
      [JSON.stringify({value:"₹".repeat(5000)}),413,{}],
      ["{}",415,{"Content-Type":"text/plain"}]]){
      const res=await worker.fetch(request("/api/razorpay/create",body,"POST",undefined,headers),baseEnv);
      assert.equal(res.status,status);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});

test("an expired ready checkout cannot reopen Razorpay checkout",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{state:"ready",amount_paise:1000,
      gateway_order_id:rOrder,expires_at:"2000-01-01T00:00:00Z",order_number:"RG-TEST123"}
  },calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/create",{checkout_id:checkoutId,items,customer:checkoutCustomer}),baseEnv);
    assert.equal(res.status,409);
    assert.equal(calls.length,1);
  }finally{globalThis.fetch=oldFetch;}
});

test("explicit withdrawal of WhatsApp consent reaches the pending checkout",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/create_razorpay_checkout":{state:"ready",amount_paise:1000,
      gateway_order_id:rOrder,expires_at:"2099-01-01T00:00:00Z",order_number:"RG-TEST123"},
    "/rest/v1/rpc/set_razorpay_whatsapp_opt_in":options=>{
      assert.equal(JSON.parse(options.body).p_opt_in,false);return mockReply(true);
    }
  },calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/create",{checkout_id:checkoutId,items,
      customer:{...checkoutCustomer,whatsapp_opt_in:false}}),baseEnv);
    assert.equal(res.status,200);
    assert.equal((await res.json()).recoveryToken,await hmacHex(baseEnv.RAZORPAY_KEY_SECRET,
      "checkout-recovery:v1|"+checkoutId+"|"+rOrder));
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=oldFetch;}
});

async function verifyPayment(payment,responses={}){
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/get_razorpay_checkout":{state:"ready",gateway_order_id:rOrder,amount_paise:50050},
    ["/v1/payments/"+rPayment]:payment,...responses
  },calls);
  try{
    const signature=await hmacHex(baseEnv.RAZORPAY_KEY_SECRET,rOrder+"|"+rPayment);
    const res=await worker.fetch(request("/api/razorpay/verify",{checkout_id:checkoutId,
      razorpay_order_id:rOrder,razorpay_payment_id:rPayment,razorpay_signature:signature}),baseEnv);
    return {status:res.status,body:await res.json(),calls};
  }finally{globalThis.fetch=oldFetch;}
}
const capturedPayment={id:rPayment,order_id:rOrder,amount:50050,currency:"INR",
  status:"captured",captured:true,amount_refunded:0,refund_status:null};

async function recoveryPayload(){
  return {checkout_id:checkoutId,gateway_order_id:rOrder,
    recovery_token:await hmacHex(baseEnv.RAZORPAY_KEY_SECRET,"checkout-recovery:v1|"+checkoutId+"|"+rOrder)};
}
const paymentCollection=items=>({entity:"collection",count:items.length,items});
const readyCheckout={state:"ready",gateway_order_id:rOrder,amount_paise:50050,
  gateway_payment_id:null,reservation_released_at:null,expires_at:"2099-01-01T00:00:00Z"};
async function recoverStatus(checkout,payments,responses={},env=baseEnv){
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/get_razorpay_checkout":checkout,
    ["/v1/orders/"+rOrder+"/payments"]:paymentCollection(payments),
    ...responses
  },calls);
  try{
    const res=await worker.fetch(request("/api/razorpay/status",await recoveryPayload()),env);
    return {status:res.status,body:await res.json(),calls};
  }finally{globalThis.fetch=oldFetch;}
}
test("checkout recovery rejects forged or cross-order capabilities before database/provider lookup",async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch");};
  try{
    const payload=await recoveryPayload();
    for(const patch of [{recovery_token:"f".repeat(64)},
      {gateway_order_id:"order_another123"},{checkout_id:"3888a960-3a02-4076-b7aa-f6bb0f31a2a1"}]){
      const res=await worker.fetch(request("/api/razorpay/status",{...payload,...patch}),baseEnv);
      assert.equal(res.status,401);
    }
    const res=await worker.fetch(request("/api/razorpay/status",{...payload,recovery_token:null}),baseEnv);
    assert.equal(res.status,400);assert.equal(calls,0);
  }finally{globalThis.fetch=oldFetch;}
});
test("lost browser callback recovers captured payment and its secure receipt without creating another order",async()=>{
  const invoiceUrl="https://rainbowgoldcovering.com/invoice.html?token="+checkoutId;
  const result=await recoverStatus(readyCheckout,[capturedPayment],{
    "/rest/v1/rpc/complete_razorpay_checkout":options=>{
      assert.deepEqual(JSON.parse(options.body),{p_gateway_order_id:rOrder,p_payment_id:rPayment,p_amount_paise:50050,p_event_id:null});
      return mockReply({paid:true,state:"paid",order_number:"RG-TEST123"});
    },
    "/rest/v1/rpc/get_paid_razorpay_receipt":{invoice_url:invoiceUrl,invoice_number:"INV-TEST123"}
  });
  assert.equal(result.status,200);
  assert.deepEqual(result.body,{success:true,paid:true,status:"paid",orderNumber:"RG-TEST123",invoiceUrl,invoiceNumber:"INV-TEST123"});
  assert.deepEqual(result.calls.map(call=>call.path),["/rest/v1/rpc/get_razorpay_checkout",
    "/v1/orders/"+rOrder+"/payments","/rest/v1/rpc/complete_razorpay_checkout","/rest/v1/rpc/get_paid_razorpay_receipt"]);
});
test("webhook-before-callback recovery rechecks its recorded payment and uses idempotent settlement",async()=>{
  const result=await recoverStatus({...readyCheckout,state:"paid",gateway_payment_id:rPayment},[],{
    ["/v1/payments/"+rPayment]:capturedPayment,
    "/rest/v1/rpc/complete_razorpay_checkout":{paid:true,state:"paid",order_number:"RG-TEST123"},
    "/rest/v1/rpc/get_paid_razorpay_receipt":{invoice_url:"https://rainbowgoldcovering.com/invoice.html?token="+checkoutId,invoice_number:"INV-TEST123"}
  },{...baseEnv,PAYMENTS_ENABLED:"false",PAYMENTS_SUSPENDED:"true"});
  assert.equal(result.status,200);assert.equal(result.body.paid,true);
  assert.deepEqual(result.calls.map(call=>call.path),["/rest/v1/rpc/get_razorpay_checkout",
    "/v1/payments/"+rPayment,"/rest/v1/rpc/complete_razorpay_checkout","/rest/v1/rpc/get_paid_razorpay_receipt"]);
});
test("recovery observes partial/full refunds without showing a confirmed order or sending a refund request",async()=>{
  for(const [amount_refunded,refund_status,state] of [[100,"partial","refund_required"],[50050,"full","refunded"]]){
    const result=await recoverStatus(readyCheckout,[{...capturedPayment,amount_refunded,refund_status}],{
      "/rest/v1/rpc/record_razorpay_refund":options=>{
        assert.equal(JSON.parse(options.body).p_amount_refunded_paise,amount_refunded);
        return mockReply({paid:false,state,order_number:"RG-TEST123"});
      }
    });
    assert.equal(result.status,200);assert.equal(result.body.paid,false);assert.equal(result.body.status,state);
    assert.equal(result.body.invoiceUrl,undefined);
    assert.deepEqual(result.calls.map(call=>call.path),["/rest/v1/rpc/get_razorpay_checkout",
      "/v1/orders/"+rOrder+"/payments","/rest/v1/rpc/record_razorpay_refund"]);
  }
});
test("empty or failed provider attempts keep active reservations pending",async()=>{
  for(const state of ["ready","creating"]){
    for(const payments of [[],[{...capturedPayment,status:"failed",captured:false}]]){
      const result=await recoverStatus({...readyCheckout,state},payments);
      assert.equal(result.status,200);assert.equal(result.body.paid,false);
      assert.equal(result.body.status,payments.length?"payment_failed":"pending");
      assert.equal(result.body.invoiceUrl,undefined);assert.equal(result.calls.length,2);
    }
  }
});
test("recovery permits checkout replacement only after DB release and no payable provider attempt",async()=>{
  for(const reservation_released_at of [null,"invalid","2026-10-20T12:00:00Z"]){
    const result=await recoverStatus({...readyCheckout,state:"expired",reservation_released_at},[]);
    assert.equal(result.body.status,reservation_released_at?.startsWith("2026")?"checkout_expired":"pending");
    assert.equal(result.body.paid,false);
  }
  for(const status of ["created","authorized"]){
    const result=await recoverStatus({...readyCheckout,state:"expired",reservation_released_at:"2026-10-20T12:00:00Z"},
      [{...capturedPayment,status,captured:false}]);
    assert.equal(result.body.status,"awaiting_capture");assert.equal(result.body.paid,false);
  }
});
test("late captured recovery records refund-required instead of confirming a released reservation",async()=>{
  const result=await recoverStatus({...readyCheckout,state:"expired",reservation_released_at:"2026-10-20T12:00:00Z"},[capturedPayment],{
    "/rest/v1/rpc/complete_razorpay_checkout":{paid:false,state:"refund_required",order_number:"RG-TEST123"}
  });
  assert.equal(result.status,200);assert.deepEqual(result.body,{success:true,paid:false,status:"refund_required",orderNumber:"RG-TEST123"});
  assert.equal(result.calls.some(call=>call.path.endsWith("get_paid_razorpay_receipt")),false);
});
test("recovery rejects inconsistent, cross-order or multiple captured provider attempts",async()=>{
  for(const payments of [[{...capturedPayment,order_id:"order_another123"}],
    [{...capturedPayment,amount:1}],[{...capturedPayment,status:"failed"}],
    [capturedPayment,{...capturedPayment,id:"pay_second12345"}]]){
    const result=await recoverStatus(readyCheckout,payments);
    assert.ok([409,503].includes(result.status));assert.equal(result.body.paid,undefined);assert.equal(result.calls.length,2);
  }
});
test("recovery upstream failures expose no provider payment/customer data and create no duplicate orders",async()=>{
  const result=await recoverStatus(readyCheckout,[],{
    ["/v1/orders/"+rOrder+"/payments"]:()=>mockReply({contact:"private",email:"private@example.com",error:"test-secret"},500)
  });
  assert.equal(result.status,503);assert.equal(JSON.stringify(result.body).includes("private"),false);
  assert.equal(JSON.stringify(result.body).includes("test-secret"),false);assert.equal(result.calls.length,2);
});

test("authorized and failed payments never settle or expose invoices",async()=>{
  for(const [status,expected] of [["authorized","awaiting_capture"],["created","awaiting_capture"],["failed","payment_failed"]]){
    const result=await verifyPayment({...capturedPayment,status,captured:false});
    assert.equal(result.status,200);
    assert.equal(result.body.status,expected);
    assert.equal(result.body.paid,false);
    assert.equal(result.body.invoiceUrl,undefined);
    assert.equal(result.calls.length,2);
  }
});

test("inconsistent capture or amount data cannot confirm an order",async()=>{
  for(const patch of [{captured:false},{amount_refunded:undefined},{refund_status:undefined},
    {amount:50049},{currency:"USD"},{amount:"50050"},{status:"refunded"},
    {amount_refunded:50050,refund_status:"partial"}]){
    const result=await verifyPayment({...capturedPayment,...patch});
    assert.equal(result.status,409);
    assert.equal(result.body.paid,undefined);
    assert.equal(result.calls.length,2);
  }
});

test("partially and fully refunded payments reconcile current provider state without confirmation",async()=>{
  for(const [amount_refunded,refund_status,state] of [[100,"partial","refund_required"],[50050,"full","refunded"]]){
    const result=await verifyPayment({...capturedPayment,amount_refunded,refund_status}, {
      "/rest/v1/rpc/record_razorpay_refund":options=>{
        const args=JSON.parse(options.body);
        assert.equal(args.p_payment_id,rPayment);
        assert.equal(args.p_amount_refunded_paise,amount_refunded);
        assert.equal(args.p_event_id,null);
        return mockReply({paid:false,state,order_number:"RG-TEST123"});
      }
    });
    assert.equal(result.status,200);
    assert.equal(result.body.paid,false);
    assert.equal(result.body.status,state);
    assert.equal(result.body.invoiceUrl,undefined);
    assert.equal(result.calls.some(c=>c.path.endsWith("complete_razorpay_checkout")),false);
  }
});

test("verified paid settlement stays successful if invoice lookup temporarily fails",async()=>{
  const result=await verifyPayment(capturedPayment, {
    "/rest/v1/rpc/complete_razorpay_checkout":{paid:true,state:"paid",order_number:"RG-TEST123"},
    "/rest/v1/rpc/get_paid_razorpay_receipt":()=>mockReply({error:"private"},503)
  });
  assert.equal(result.status,200);
  assert.equal(result.body.paid,true);
  assert.equal(result.body.status,"paid");
  assert.equal(result.body.invoiceUrl,undefined);
});

test("refund webhook rechecks provider instead of trusting event amount, including capture replay",async()=>{
  const oldFetch=globalThis.fetch;
  try{
    for(const event of ["payment.refunded","refund.processed","payment.captured"]){
      const calls=[];
      const payload=JSON.stringify({event,payload:{
        payment:{entity:{id:rPayment,order_id:rOrder,amount_refunded:1}},
        ...(event==="refund.processed"?{refund:{entity:{id:"rfnd_example123",payment_id:rPayment}}}:{})
      }});
      globalThis.fetch=mockFetch({
        ["/v1/payments/"+rPayment]:{...capturedPayment,amount_refunded:50050,refund_status:"full",status:"refunded"},
        "/rest/v1/rpc/record_razorpay_refund":options=>{
          const args=JSON.parse(options.body);
          assert.equal(args.p_amount_refunded_paise,50050);
          assert.equal(args.p_event_id,"evt_refund");
          assert.equal(args.p_refund_id,event==="refund.processed"?"rfnd_example123":null);
          return mockReply({paid:false,state:"refunded"});
        }
      },calls);
      const signature=await hmacHex(baseEnv.RAZORPAY_WEBHOOK_SECRET,payload);
      const res=await worker.fetch(request("/api/razorpay/webhook",payload,"POST","",{
        "x-razorpay-signature":signature,"x-razorpay-event-id":"evt_refund"
      }),baseEnv);
      assert.equal(res.status,200);
      assert.deepEqual(await res.json(),{success:true,paid:false,status:"refunded"});
      assert.equal(calls.length,2);
    }
  }finally{globalThis.fetch=oldFetch;}
});

test("a webhook with a failed settlement is not acknowledged as success",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  const payload=JSON.stringify({event:"payment.captured",payload:{payment:{entity:{id:rPayment,order_id:rOrder}}}});
  globalThis.fetch=mockFetch({
    ["/v1/payments/"+rPayment]:capturedPayment,
    "/rest/v1/rpc/complete_razorpay_checkout":()=>mockReply({},503)
  },calls);
  try{
    const signature=await hmacHex(baseEnv.RAZORPAY_WEBHOOK_SECRET,payload);
    const res=await worker.fetch(request("/api/razorpay/webhook",payload,"POST","",{
      "x-razorpay-signature":signature,"x-razorpay-event-id":"evt_failed_settlement"
    }),baseEnv);
    assert.equal(res.status,503);
    assert.equal((await res.json()).success,false);
  }finally{globalThis.fetch=oldFetch;}
});

test("scheduled expiry attempts both payment methods even when one cleanup fails",async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=mockFetch({
    "/rest/v1/rpc/expire_razorpay_checkouts":()=>mockReply({},503),
    "/rest/v1/rpc/expire_manual_upi_checkouts":2
  },calls);
  try{
    await worker.scheduled({},baseEnv);
    assert.deepEqual(calls.map(x=>x.path),[
      "/rest/v1/rpc/expire_razorpay_checkouts","/rest/v1/rpc/expire_manual_upi_checkouts"
    ]);
  }finally{globalThis.fetch=oldFetch;}
});
