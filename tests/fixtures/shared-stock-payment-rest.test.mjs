// Requires a disposable loopback Supabase stack and a published synthetic variant.
// Uses the actual Worker and Supabase Auth/PostgREST. Razorpay transport is simulated.
import assert from "node:assert/strict";
import {test,before,after} from "node:test";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {Builder,By,Key} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import worker from "../../backend/rainbow-api/src/index.js";
import {hmacHex} from "../../backend/rainbow-api/src/payment-crypto.js";

const {
  QA_SUPABASE_URL, QA_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey, QA_SUPABASE_ANON_KEY,
  QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD, QA_CASHIER_EMAIL, QA_CASHIER_PASSWORD,
  QA_CUSTOMER_EMAIL, QA_CUSTOMER_PASSWORD, QA_PAYMENT_VARIANT_ID
}=process.env;
const db=new URL(QA_SUPABASE_URL||"http://invalid.invalid");
assert.equal(db.protocol,"http:","Only a disposable loopback Supabase stack is allowed");
assert.ok(["127.0.0.1","localhost","[::1]"].includes(db.hostname),"Only a loopback Supabase stack is allowed");
assert.ok(serviceRoleKey&&QA_SUPABASE_ANON_KEY&&QA_ADMIN_EMAIL&&QA_ADMIN_PASSWORD);
assert.match(QA_PAYMENT_VARIANT_ID,/^[a-f0-9-]{36}$/i);

const origin="https://rainbow-payment-qa.invalid";
const env={
  SUPABASE_URL:db.origin,SUPABASE_SERVICE_ROLE_KEY:serviceRoleKey,
  RAZORPAY_KEY_ID:"rzp_test_SyntheticQA",RAZORPAY_KEY_SECRET:"synthetic-provider-key",
  RAZORPAY_WEBHOOK_SECRET:"synthetic-webhook-key",PAYMENTS_ENABLED:"true",PAYMENTS_MODE:"test",
  ALLOWED_ORIGINS:origin,CHECKOUT_RATE_LIMITER:{limit:async()=>({success:true})}
};
const items=[{variant_id:QA_PAYMENT_VARIANT_ID,quantity:1}];
const customer={
  name:"Synthetic payment QA",whatsapp_number:"9999999999",email:"payments@example.invalid",
  address:"Synthetic staging address",city:"QA City",state:"Tamil Nadu",pin_code:"629175"
};
const originalFetch=globalThis.fetch;
const gatewayOrders=new Map();
const gatewayPayments=new Map();
const sessions=new Map();
const body=(data)=>JSON.stringify(data);
const json=(data,status=200)=>new Response(body(data),{status,headers:{"Content-Type":"application/json"}});

async function rest(path,{method="GET",payload,role="service"}={}){
  const apiKey=role==="service"?serviceRoleKey:QA_SUPABASE_ANON_KEY;
  const auth=sessions.get(role)||apiKey;
  const response=await originalFetch(db.origin+path,{
    method,redirect:"error",headers:{apikey:apiKey,Authorization:"Bearer "+auth,"Content-Type":"application/json"},
    ...(payload===undefined?{}:{body:body(payload)})
  });
  const data=response.status===204?null:await response.json();
  return {status:response.status,data};
}
const rpc=(name,payload,role)=>rest("/rest/v1/rpc/"+name,{method:"POST",payload,role});
async function expectOK(result){
  const {status,data}=await result;
  assert.ok(status>=200&&status<300,"Unexpected staging HTTP "+status+" ("+(data?.code||data?.error_code||"no error code")+")");
  return data;
}
async function request(path,payload,headers={},settings=env){
  const response=await worker.fetch(new Request(origin+"/api/razorpay/"+path,{
    method:"POST",headers:{Origin:origin,"Content-Type":"application/json",...headers},body:body(payload)
  }),settings);
  return {status:response.status,data:await response.json()};
}
async function create(id=crypto.randomUUID()){
  return {...await request("create",{checkout_id:id,items,customer}),id};
}
async function pay(order){
  const payment={id:"pay_"+crypto.randomUUID().replaceAll("-",""),order_id:order.data.gatewayOrderId,
    amount:order.data.amount,currency:"INR",status:"captured",captured:true,amount_refunded:0,refund_status:null};
  gatewayPayments.set(payment.id,payment);
  const signature=await hmacHex(env.RAZORPAY_KEY_SECRET,payment.order_id+"|"+payment.id);
  return {razorpay_order_id:payment.order_id,razorpay_payment_id:payment.id,razorpay_signature:signature};
}
async function webhook(payment,eventId){
  const event={event:"payment.captured",payload:{payment:{entity:gatewayPayments.get(payment.razorpay_payment_id)}}};
  return request("webhook",event,{
    "x-razorpay-signature":await hmacHex(env.RAZORPAY_WEBHOOK_SECRET,body(event)),
    "x-razorpay-event-id":eventId
  });
}
async function stock(){
  const variants=await expectOK(rest("/rest/v1/product_variants?select=stock_quantity&id=eq."+QA_PAYMENT_VARIANT_ID));
  const rows=await expectOK(rest("/rest/v1/erp_stock_balances?select=on_hand,reserved,erp_locations!inner(kind,active)"+
    "&erp_locations.kind=eq.branch&erp_locations.active=eq.true&variant_id=eq."+QA_PAYMENT_VARIANT_ID));
  assert.equal(variants.length,1,"Synthetic product variant must already exist");
  const onHand=rows.reduce((total,row)=>total+row.on_hand,0);
  const reserved=rows.reduce((total,row)=>total+row.reserved,0);
  assert.equal(variants[0].stock_quantity,onHand-reserved,"Physical stock and legacy storefront availability diverged");
  return {onHand,reserved};
}
async function orderState(orderNumber){
  const orders=await expectOK(rest("/rest/v1/orders?select=status,payment_status,payments(status),invoices(id)&order_number=eq."+orderNumber));
  assert.equal(orders.length,1);
  const order=orders[0];
  const invoices=Array.isArray(order.invoices)?order.invoices:order.invoices?[order.invoices]:[];
  return {...order,invoices};
}
async function setDeadline(id,time){
  await expectOK(rest("/rest/v1/razorpay_checkouts?checkout_id=eq."+id,{
    method:"PATCH",payload:{expires_at:new Date(Date.now()-time).toISOString()}
  }));
}

before(async()=>{
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input);
    if(url.origin===db.origin)return originalFetch(url,{...options,redirect:"error"});
    assert.equal(url.origin,"https://api.razorpay.com","Unexpected Worker outbound request");
    if(url.pathname==="/v1/orders"&&options?.method==="POST"){
      const order={...JSON.parse(options.body),id:"order_"+crypto.randomUUID().replaceAll("-",""),status:"created"};
      gatewayOrders.set(order.id,order);
      return json(order);
    }
    if(url.pathname==="/v1/orders"){
      const receipt=url.searchParams.get("receipt");
      return json({items:[...gatewayOrders.values()].filter(order=>!receipt||order.receipt===receipt)});
    }
    if(url.pathname.startsWith("/v1/payments/")){
      const payment=gatewayPayments.get(url.pathname.split("/").at(-1));
      return payment?json(payment):json({},404);
    }
    throw new Error("Unrecognized synthetic payment operation");
  };
  for(const [role,email,password] of [
    ["admin",QA_ADMIN_EMAIL,QA_ADMIN_PASSWORD],
    ["cashier",QA_CASHIER_EMAIL,QA_CASHIER_PASSWORD],
    ["customer",QA_CUSTOMER_EMAIL,QA_CUSTOMER_PASSWORD]
  ]){
    if(!email||!password)continue;
    const session=await expectOK(rest("/auth/v1/token?grant_type=password",{
      role:"anon",method:"POST",payload:{email,password}
    }));
    sessions.set(role,session.access_token);
  }
  assert.equal((await expectOK(rpc("erp_shared_inventory_mode",{},"admin"))).shared_stock,true);
  assert.ok((await stock()).onHand>=2,"Need two synthetic physical units before testing");
});
after(()=>{globalThis.fetch=originalFetch;});

test("simultaneous callback and duplicate signed webhooks consume one physical item",async()=>{
  const before=await stock();
  const order=await create();
  assert.equal(order.status,200);
  assert.equal((await create(order.id)).data.gatewayOrderId,order.data.gatewayOrderId);
  assert.deepEqual(await stock(),{onHand:before.onHand,reserved:before.reserved+1});

  const callback=await pay(order);
  const suspended={...env,PAYMENTS_SUSPENDED:"true"};
  assert.equal((await request("create",{checkout_id:order.id,items,customer},{},suspended)).status,503);
  const results=await Promise.all([
    request("verify",{checkout_id:order.id,...callback},{},suspended),
    webhook(callback,"qa-duplicate-capture"),
    webhook(callback,"qa-duplicate-capture")
  ]);
  for(const result of results){
    assert.equal(result.status,200);
    assert.equal(result.data.paid,true);
  }
  const stored=await orderState(order.data.orderNumber);
  assert.equal(stored.status,"confirmed");
  assert.deepEqual(stored.payments,[{status:"paid"}]);
  assert.equal(stored.invoices.length,1);
  assert.deepEqual(await stock(),{onHand:before.onHand-1,reserved:before.reserved});
});

test("late capture before the cleanup job cancels and releases once for refund review",async()=>{
  const before=await stock();
  const order=await create();
  assert.equal(order.status,200);
  await setDeadline(order.id,60000);
  const stale=await create(order.id);
  assert.equal(stale.status,409);
  assert.equal(stale.data.gatewayOrderId,undefined);
  const callback=await pay(order);
  const first=await webhook(callback,"qa-late-capture");
  assert.deepEqual(first,{status:200,data:{success:true,paid:false,status:"refund_required"}});
  assert.deepEqual(await webhook(callback,"qa-late-capture"),first);
  const stored=await orderState(order.data.orderNumber);
  assert.equal(stored.status,"cancelled");
  assert.equal(stored.payment_status,"paid");
  assert.equal(stored.invoices.length,0);
  assert.deepEqual(await stock(),before);
});

test("refund observations release an unsettled hold and never add stock to a settled sale",async()=>{
  const before=await stock();
  for(const settleFirst of [false,true]){
    const order=await create();
    assert.equal(order.status,200);
    const callback=await pay(order);
    const payment=gatewayPayments.get(callback.razorpay_payment_id);
    if(settleFirst)assert.equal((await webhook(callback,"qa-paid-before-refund")).data.paid,true);
    const refundId="rfnd_"+crypto.randomUUID().replaceAll("-","");
    const event={event:"refund.processed",payload:{refund:{entity:{id:refundId,payment_id:payment.id}}}};
    const headers={"x-razorpay-signature":await hmacHex(env.RAZORPAY_WEBHOOK_SECRET,body(event)),
      "x-razorpay-event-id":"qa-refund-"+refundId};
    payment.amount_refunded=Math.floor(payment.amount/2);
    payment.refund_status="partial";
    const partial=await request("webhook",event,headers);
    assert.equal(partial.status,200);
    assert.equal(partial.data.status,"refund_required");
    payment.amount_refunded=payment.amount;
    payment.refund_status="full";
    payment.status="refunded";
    const full=await request("webhook",event,headers);
    assert.equal(full.status,200);
    assert.equal(full.data.status,"refunded");
    assert.deepEqual(await request("webhook",event,headers),full);
    assert.equal((await orderState(order.data.orderNumber)).payment_status,"refunded");
    assert.deepEqual(await stock(),{onHand:before.onHand-(settleFirst?1:0),reserved:before.reserved});
  }
});

test("scheduled expiry releases an unpaid hold once and prevents reuse of the expired token",async()=>{
  const before=await stock();
  const order=await create();
  assert.equal(order.status,200);
  await setDeadline(order.id,3600000);
  await worker.scheduled({},env);
  const state=await orderState(order.data.orderNumber);
  assert.equal(state.status,"cancelled");
  assert.equal(state.payment_status,"failed");
  assert.deepEqual(await stock(),before);
  await worker.scheduled({},env);
  assert.deepEqual(await stock(),before);
  const expired=await create(order.id);
  assert.equal(expired.status,410);
  assert.equal(expired.data.code,"CHECKOUT_EXPIRED");
});

test("manual UPI is idempotent and only an admin can verify or cancel it",async()=>{
  const before=await stock();
  const newManual=()=>({p_items:items,p_customer:{...customer,payment_method:"upi",
    payment_reference:"QA"+crypto.randomUUID().replaceAll("-",""),checkout_id:crypto.randomUUID()}});
  const pending=newManual();
  assert.equal((await rpc("create_online_order",pending,"anon")).status,401);
  const order=await expectOK(rpc("create_online_order",pending,"service"));
  const repeated=await expectOK(rpc("create_online_order",pending,"service"));
  assert.equal(repeated.order_id,order.order_id);
  assert.deepEqual(await stock(),{onHand:before.onHand,reserved:before.reserved+1});
  const orderArg={p_order_id:order.order_id};
  assert.equal((await rpc("verify_online_order_payment",orderArg,"anon")).status,401);
  assert.equal((await rpc("cancel_unpaid_manual_upi_order",orderArg,"anon")).status,401);
  if(sessions.has("cashier")){
    assert.equal((await rpc("verify_online_order_payment",orderArg,"cashier")).status,403);
    assert.equal((await rpc("cancel_unpaid_manual_upi_order",orderArg,"cashier")).status,403);
  }
  const cancelled=await expectOK(rpc("cancel_unpaid_manual_upi_order",orderArg,"admin"));
  assert.equal(cancelled.already_cancelled,false);
  assert.equal((await expectOK(rpc("cancel_unpaid_manual_upi_order",orderArg,"admin"))).already_cancelled,true);
  assert.deepEqual(await stock(),before);

  const paidOrder=await expectOK(rpc("create_online_order",newManual(),"service"));
  const paidArg={p_order_id:paidOrder.order_id};
  const paid=await expectOK(rpc("verify_online_order_payment",paidArg,"admin"));
  assert.equal(paid.already_paid,false);
  assert.equal((await expectOK(rpc("verify_online_order_payment",paidArg,"admin"))).already_paid,true);
  assert.equal((await orderState(paidOrder.order_number)).invoices.length,1);
  assert.ok((await rpc("cancel_unpaid_manual_upi_order",paidArg,"admin")).status>=400);
  assert.deepEqual(await stock(),{onHand:before.onHand-1,reserved:before.reserved});
});

test("authenticated customers see published availability without access to private stock or payment operations",{
  skip:!QA_CUSTOMER_EMAIL||!QA_CUSTOMER_PASSWORD
},async()=>{
  const query="?select=id,stock_quantity&id=eq."+QA_PAYMENT_VARIANT_ID;
  const catalog=await expectOK(rest("/rest/v1/product_variants"+query,{role:"customer"}));
  const balance=await stock();
  assert.deepEqual(catalog,[{id:QA_PAYMENT_VARIANT_ID,stock_quantity:balance.onHand-balance.reserved}]);
  assert.deepEqual(await expectOK(rest("/rest/v1/erp_stock_balances?select=variant_id&variant_id=eq."+QA_PAYMENT_VARIANT_ID,{role:"customer"})),[]);
  assert.deepEqual(await expectOK(rpc("erp_shared_inventory_mode",{},"customer")),{shared_stock:true});
  assert.equal((await rpc("expire_razorpay_checkouts",{p_limit:1},"customer")).status,403);
});

test("browser checkout reaches the real Worker and Supabase, then reduces the same physical stock",{
  skip:process.env.QA_PAYMENT_BROWSER!=="true"
},async()=>{
  const before=await stock();
  const storefront="http://127.0.0.1:4174";
  const workerOrigin="http://127.0.0.1:4175";
  const settings={...env,ALLOWED_ORIGINS:storefront};
  const api=createServer(async(req,res)=>{
    try{
      const chunks=[];
      for await(const chunk of req)chunks.push(chunk);
      const raw=Buffer.concat(chunks);
      const url=new URL(req.url,workerOrigin);
      if(url.pathname==="/__qa/capture"&&req.method==="POST"&&req.headers.origin===storefront){
        const providerOrder=gatewayOrders.get(JSON.parse(raw).order_id);
        assert.ok(providerOrder);
        const callback=await pay({data:{gatewayOrderId:providerOrder.id,amount:providerOrder.amount}});
        res.writeHead(200,{"Content-Type":"application/json","Access-Control-Allow-Origin":storefront});
        res.end(body(callback));
        return;
      }
      const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,
        ...(raw.length?{body:raw}:{})}),settings);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    }catch{
      res.writeHead(500);
      res.end("Isolated checkout fixture failed");
    }
  });
  api.listen(4175,"127.0.0.1");
  await once(api,"listening");
  const site=spawn(process.execPath,["scripts/static-server.mjs"],{stdio:"ignore",env:{...process.env,
    PORT:"4174",SUPABASE_TEST_URL:db.origin,SUPABASE_TEST_PUBLISHABLE_KEY:QA_SUPABASE_ANON_KEY,
    PAYMENT_TEST_API_URL:workerOrigin}});
  let driver;
  try{
    for(let attempt=0;attempt<40;attempt++){
      if(site.exitCode!==null)throw new Error("Isolated storefront failed to start");
      try{if((await originalFetch(storefront+"/order.html")).ok)break;}catch{ /* Wait for the server. */ }
      await delay(100);
    }
    const variants=await expectOK(rest("/rest/v1/product_variants?select=products(product_code)&id=eq."+QA_PAYMENT_VARIANT_ID));
    const sku=variants[0].products.product_code;
    assert.match(sku,/^(QA|E2E)/);
    const options=new chrome.Options().addArguments("--headless=new","--no-sandbox","--window-size=1440,1000");
    driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
    await driver.get(storefront+"/product.html?sku="+encodeURIComponent(sku));
    const add=await driver.findElement(By.id("detailAdd"));
    await driver.wait(()=>add.isEnabled(),10000);
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});",add);
    await add.sendKeys(Key.ENTER);
    await driver.get(storefront+"/order.html");
    await driver.executeScript(`
      window.Razorpay=class{
        constructor(options){this.options=options;}
        on(){}
        open(){
          fetch("http://127.0.0.1:4175/__qa/capture",{method:"POST",
            body:JSON.stringify({order_id:this.options.order_id})})
          .then(response=>response.json()).then(callback=>this.options.handler(callback));
        }
      };
    `);
    const field=id=>driver.findElement(By.id(id));
    for(const [id,value] of Object.entries({name:"Synthetic Browser QA",phone:"9000000001",pin:"629175",
      city:"QA Town",address:"Synthetic staging browser checkout"})){
      await (await field(id)).sendKeys(value);
    }
    await driver.findElement(By.xpath("//select[@id='state']/option[normalize-space(.)='Tamil Nadu']")).click();
    const submit=await field("placeOrder");
    await driver.wait(()=>submit.isEnabled(),15000,"Browser could not enable test checkout");
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});",submit);
    await submit.sendKeys(Key.ENTER);
    try{
      await driver.wait(async()=>/TEST payment verified/i.test(await (await field("orderSuccess")).getText()),15000);
    }catch(error){
      assert.fail("Browser did not display a verified checkout result: "+await (await field("orderMsg")).getAttribute("textContent")+" ("+error.name+")");
    }
    assert.deepEqual(await stock(),{onHand:before.onHand-1,reserved:before.reserved});
  }finally{
    if(driver)await driver.quit();
    if(site.exitCode===null)site.kill("SIGTERM");
    api.closeAllConnections();
    await new Promise(resolve=>api.close(resolve));
  }
});
