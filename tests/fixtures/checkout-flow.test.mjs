/* Run explicitly: node --test tests/fixtures/checkout-flow.test.mjs.
 * Actual Worker and PostgreSQL migrations; only the payment provider is simulated.
 * A separate loopback-only process owns disposable in-memory test data.
 */
import {test,before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../../",import.meta.url));
const base="http://127.0.0.1:8845";
let server;
let output="";
const variant="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const customer={name:"Local QA Customer",whatsapp_number:"9999999999",email:"qa@example.invalid",
 address:"Synthetic local QA address",city:"QA City",state:"Tamil Nadu",pin_code:"629175"};
async function request(path,body){
 const response=await fetch(base+path,body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
async function create(id=crypto.randomUUID(),extra={}){
 return {...await request("/__fixture/api/razorpay/create",{checkout_id:id,items:[{variant_id:variant,quantity:1}],customer,...extra}),id};
}
async function pay(order,status="captured"){
 return (await request("/__fixture/pay",{order_id:order.data.gatewayOrderId,status})).data;
}
async function verify(order,payment){return request("/__fixture/api/razorpay/verify",{checkout_id:order.id,...payment});}
async function state(){return (await request("/__fixture/state")).data;}

before(async()=>{
 server=spawn(process.execPath,["scripts/checkout-fixture-server.mjs"],{cwd:root,
  env:{...process.env,CHECKOUT_FIXTURE_PORT:"8845"},stdio:["ignore","pipe","pipe"]});
 server.stdout.on("data",chunk=>{output+=String(chunk);});
 server.stderr.on("data",chunk=>{output+=String(chunk);});
 for(let i=0;i<100;i++){
  if(server.exitCode!==null)throw new Error("Fixture server exited: "+output);
  try{if((await state()).fixture)return;}catch{ /* Wait for the in-memory database. */ }
  await delay(100);
 }
 throw new Error("Fixture did not become ready: "+output);
});
after(async()=>{
 if(server&&server.exitCode===null){server.kill("SIGTERM");await once(server,"exit");}
});
beforeEach(async()=>{assert.equal((await request("/__fixture/reset",{})).status,200);});

test("captured payment confirms one order, one payment, one invoice and one stock ledger entry",async()=>{
 const order=await create();
 assert.equal(order.status,200);assert.equal(order.data.amount,14992);
 let stored=await state();
 assert.equal(stored.variants[0].stock_quantity,4);
 assert.equal(stored.orders[0].status,"pending");
 assert.equal(stored.invoices.length,0);assert.equal(stored.inventory.length,0);
 const result=await verify(order,await pay(order));
 assert.equal(result.status,200);assert.equal(result.data.paid,true);
 assert.match(result.data.orderNumber,/^RG-/);
 assert.match(result.data.invoiceUrl,/^https:\/\/rainbowgoldcovering\.com\/invoice\.html\?token=[0-9a-f-]{36}$/);
 stored=await state();
 assert.equal(stored.orders.length,1);assert.equal(stored.orders[0].status,"confirmed");
 assert.equal(stored.orders[0].payment_status,"paid");assert.equal(stored.payments.length,1);
 assert.equal(stored.payments[0].status,"paid");assert.equal(stored.invoices.length,1);
 assert.equal(stored.inventory.length,1);assert.equal(stored.inventory[0].quantity_delta,-1);
 assert.equal(stored.variants[0].stock_quantity,4);
 const invoice=await request("/__fixture/db/rpc",{name:"get_public_invoice",payload:{p_token:stored.invoices[0].public_token}});
 assert.equal(invoice.data.data.order_number,result.data.orderNumber);
 assert.equal(invoice.data.data.total_amount,149.92);
 assert.equal(invoice.data.data.items[0].product_code,"TEST001");
});

test("repeated create and payment callbacks reuse the reservation and never duplicate paid effects",async()=>{
 const order=await create();const repeated=await create(order.id);
 assert.equal(repeated.data.gatewayOrderId,order.data.gatewayOrderId);
 const callback=await pay(order);
 const first=await verify(order,callback);const second=await verify(order,callback);
 assert.equal(first.data.paid,true);assert.equal(second.data.paid,true);
 assert.equal(first.data.invoiceUrl,second.data.invoiceUrl);
 const stored=await state();
 assert.equal(stored.simulatedProviderOrders,1);assert.equal(stored.orders.length,1);
 assert.equal(stored.payments.length,1);assert.equal(stored.invoices.length,1);
 assert.equal(stored.inventory.length,1);assert.equal(stored.variants[0].stock_quantity,4);
});

test("an authorized payment stays unconfirmed until capture, then the same callback can settle",async()=>{
 const order=await create();const callback=await pay(order,"authorized");
 const pending=await verify(order,callback);
 assert.equal(pending.data.paid,false);assert.equal(pending.data.status,"awaiting_capture");
 let stored=await state();
 assert.equal(stored.orders[0].status,"pending");assert.equal(stored.invoices.length,0);
 const captured=await request("/__fixture/capture",{payment_id:callback.razorpay_payment_id});
 assert.equal(captured.status,200);
 const settled=await verify(order,captured.data);assert.equal(settled.data.paid,true);
 stored=await state();assert.equal(stored.orders[0].status,"confirmed");assert.equal(stored.invoices.length,1);
});

test("temporary verification failure preserves the paid attempt and a retry settles once",async()=>{
 const order=await create();const callback=await pay(order);
 await request("/__fixture/verify-failure",{});
 const failed=await verify(order,callback);assert.equal(failed.status,503);
 let stored=await state();assert.equal(stored.orders[0].status,"pending");assert.equal(stored.invoices.length,0);
 const retried=await verify(order,callback);assert.equal(retried.data.paid,true);
 stored=await state();assert.equal(stored.orders.length,1);assert.equal(stored.invoices.length,1);
});

test("a bad payment signature cannot confirm an order or issue an invoice",async()=>{
 const order=await create();const callback=await pay(order);
 const result=await verify(order,{...callback,razorpay_signature:"0".repeat(64)});
 assert.equal(result.status,401);
 const stored=await state();assert.equal(stored.orders[0].status,"pending");
 assert.equal(stored.orders[0].payment_status,"pending");assert.equal(stored.invoices.length,0);
 assert.equal(stored.inventory.length,0);
});

test("cancelled or abandoned unpaid checkout can be resumed, then expires and returns stock once",async()=>{
 const order=await create();const retry=await create(order.id);
 assert.equal(retry.data.gatewayOrderId,order.data.gatewayOrderId);
 let stored=await state();assert.equal(stored.orders[0].status,"pending");assert.equal(stored.invoices.length,0);
 assert.equal((await request("/__fixture/expire",{checkout_id:order.id})).status,200);
 stored=await state();assert.equal(stored.variants[0].stock_quantity,5);
 assert.equal(stored.orders[0].status,"cancelled");assert.equal(stored.checkouts[0].status,"expired");
 await request("/__fixture/expire",{checkout_id:order.id});
 assert.equal((await state()).variants[0].stock_quantity,5);
 const expired=await create(order.id);assert.equal(expired.status,410);assert.equal(expired.data.code,"CHECKOUT_EXPIRED");
});

test("out-of-stock reservations and browser price overrides cannot create extra payable orders",async()=>{
 const order=await create(undefined,{amount:1});assert.equal(order.data.amount,14992);
 const result=await create(undefined,{items:[{variant_id:variant,quantity:5}]});
 assert.equal(result.status,503);
 const stored=await state();assert.equal(stored.orders.length,1);assert.equal(stored.variants[0].stock_quantity,4);
 assert.equal(stored.simulatedProviderOrders,1);
});

test("only explicit WhatsApp opt-in queues one local receipt after verified capture",async()=>{
 const order=await create(undefined,{customer:{...customer,whatsapp_opt_in:true}});
 assert.equal((await state()).notifications.length,0);
 const callback=await pay(order);await verify(order,callback);await verify(order,callback);
 const stored=await state();assert.equal(stored.notifications.length,1);
 assert.deepEqual(stored.notifications[0],{notification_type:"payment_receipt",status:"pending"});
 assert.equal(stored.externalNetworkAllowed,false);assert.equal(stored.realProvider,false);
});

test("captured-payment webhook settles when the browser callback is lost and retries are harmless",async()=>{
 const order=await create();const payment=await pay(order);
 const event={payment_id:payment.razorpay_payment_id,event_id:"fixture-captured-event-1"};
 const webhook=await request("/__fixture/webhook",event);assert.equal(webhook.data.paid,true);
 const repeated=await request("/__fixture/webhook",event);assert.equal(repeated.data.paid,true);
 const stored=await state();assert.equal(stored.orders[0].status,"confirmed");
 assert.equal(stored.payments.length,1);assert.equal(stored.invoices.length,1);
 assert.equal(stored.inventory.length,1);assert.equal(stored.variants[0].stock_quantity,4);
 const recovered=await verify(order,payment);assert.equal(recovered.data.paid,true);
 assert.match(recovered.data.invoiceUrl,/\/invoice\.html\?token=/);
});

test("manual UPI reference stays pending without an invoice and identical retries reuse one order",async()=>{
 const payload={name:"create_online_order",payload:{p_items:[{variant_id:variant,quantity:1}],
  p_customer:{...customer,payment_method:"upi",payment_reference:"LOCAL-QA-UTR-12345",checkout_id:crypto.randomUUID()}}};
 const first=await request("/__fixture/db/rpc",payload);assert.equal(first.status,200);assert.equal(first.data.error,null);
 const repeated=await request("/__fixture/db/rpc",payload);
 assert.equal(first.data.data.order_number,repeated.data.data.order_number);
 const stored=await state();assert.equal(stored.orders.length,1);assert.equal(stored.orders[0].status,"pending");
 assert.equal(stored.orders[0].payment_status,"pending");assert.equal(stored.payments.length,1);
 assert.equal(stored.payments[0].method,"upi");assert.equal(stored.invoices.length,0);
 assert.equal(stored.inventory.length,0);assert.equal(stored.variants[0].stock_quantity,4);
 assert.equal(stored.simulatedProviderOrders,0);
});
