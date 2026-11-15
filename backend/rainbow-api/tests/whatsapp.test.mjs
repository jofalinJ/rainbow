import test from "node:test";
import assert from "node:assert/strict";
import {sendPaidInvoiceWhatsApp} from "../src/whatsapp.js";

const base={
  WHATSAPP_SEND_ENABLED:"true",
  WHATSAPP_TEST_RECIPIENT_ALLOWLIST:"919999999999",
  WHATSAPP_ACCESS_TOKEN:"mock_not_real",
  WHATSAPP_PHONE_NUMBER_ID:"123456789012",
  WHATSAPP_TEMPLATE_NAME:"rainbow_paid_order_invoice",
  SUPABASE_URL:"https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:"not_real",
  RAZORPAY_KEY_ID:"rzp_test_fake"
};
const sample={
  id:"f4e9c808-f470-450d-8054-f3614aeecb3f",
  recipient:"919999999999",
  invoice_url:"https://rainbowgoldcovering.com/invoice.html?token=00000000-0000-4000-8000-000000000001",
  order_number:"RG-TEST-PAID",
  customer_name:"Test Customer"
};
const ok=(body)=>new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});

test("WhatsApp API remains disabled without opt-in provider configuration",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Error("unexpected message");};
  assert.deepEqual(await sendPaidInvoiceWhatsApp({}, {fetchImpl}),{state:"disabled"});
  assert.deepEqual(await sendPaidInvoiceWhatsApp({...base,WHATSAPP_TEST_RECIPIENT_ALLOWLIST:""},{fetchImpl}),
    {state:"test_recipient_allowlist_required"});
  assert.equal(calls,0);
});
test("sends only allowlisted invoice templates through Meta after checkout has paid",async()=>{
  const paths=[];
  const fetchImpl=async(url,opts)=>{
    const path=new URL(url).pathname;
    paths.push(path);
    if(path.endsWith("/claim_paid_invoice_whatsapp")){
      const payload=JSON.parse(opts.body);
      assert.deepEqual(payload.p_allowed_numbers,["919999999999"]);
      return ok([sample]);
    }
    if(path.endsWith("/messages")){
      const data=JSON.parse(opts.body);
      assert.equal(data.to,"919999999999");
      assert.equal(data.type,"template");
      assert.equal(data.template.components[0].parameters[2].text,sample.invoice_url);
      assert.equal(opts.headers.Authorization,"Bearer mock_not_real");
      return ok({messages:[{id:"wamid.test-response-id"}]});
    }
    if(path.endsWith("/finish_paid_invoice_whatsapp")){
      assert.equal(JSON.parse(opts.body).p_provider_id,"wamid.test-response-id");
      return ok(true);
    }
    throw new Error("Unexpected request "+path);
  };
  const result=await sendPaidInvoiceWhatsApp(base,{fetchImpl});
  assert.deepEqual(result,{state:"processed",count:1});
  assert.equal(paths.filter(p=>p.endsWith("/messages")).length,1);
});
test("refuses tampered invoice URL without contacting WhatsApp",async()=>{
  const paths=[];
  const fetchImpl=async(url,opts)=>{
    const path=new URL(url).pathname;paths.push(path);
    if(path.endsWith("/claim_paid_invoice_whatsapp"))
      return ok([{...sample,invoice_url:"https://bad.example/invoice.html?token=stolen"}]);
    if(path.endsWith("/finish_paid_invoice_whatsapp")){
      assert.equal(JSON.parse(opts.body).p_error,"recipient_not_allowlisted_or_bad_invoice_link");
      return ok(true);
    }
    throw new Error("Unexpected send to "+path);
  };
  await sendPaidInvoiceWhatsApp(base,{fetchImpl});
  assert.equal(paths.some(p=>p.endsWith("/messages")),false);
});


const liveBase={
  ...base,
  PAYMENTS_MODE:"live",
  PAYMENTS_ENABLED:"true",
  LIVE_PAYMENTS_RELEASED:"true",
  RAZORPAY_LIVE_KEY_ID:"rzp_live_fake",
  RAZORPAY_LIVE_KEY_SECRET:"mock_not_real",
  RAZORPAY_LIVE_WEBHOOK_SECRET:"mock_not_real"
};

test("live mode cannot send without an independent WhatsApp release",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Error("unexpected provider call");};
  assert.deepEqual(await sendPaidInvoiceWhatsApp(liveBase,{fetchImpl}),
    {state:"live_notifications_disabled"});
  assert.deepEqual(await sendPaidInvoiceWhatsApp({...liveBase,WHATSAPP_LIVE_SEND_ENABLED:"true",
    WHATSAPP_TEST_RECIPIENT_ALLOWLIST:""},{fetchImpl}),
    {state:"test_recipient_allowlist_required"});
  assert.deepEqual(await sendPaidInvoiceWhatsApp({...liveBase,WHATSAPP_LIVE_SEND_ENABLED:"true",
    LIVE_PAYMENTS_RELEASED:"false"},{fetchImpl}),
    {state:"live_payment_not_ready"});
  assert.equal(calls,0);
});

test("live release defaults to an allowlisted recipient and does not send to everyone",async()=>{
  const seen=[];
  const fetchImpl=async(url,opts)=>{
    const path=new URL(url).pathname;
    seen.push(path);
    if(path.endsWith("/claim_paid_invoice_whatsapp")){
      assert.deepEqual(JSON.parse(opts.body).p_allowed_numbers,["919999999999"]);
      return ok([sample]);
    }
    if(path.endsWith("/messages")){
      assert.equal(JSON.parse(opts.body).to,sample.recipient);
      return ok({messages:[{id:"wamid.live-allowlisted-test"}]});
    }
    if(path.endsWith("/finish_paid_invoice_whatsapp"))return ok(true);
    throw Error("Unexpected request "+path);
  };
  assert.deepEqual(await sendPaidInvoiceWhatsApp({...liveBase,
    WHATSAPP_LIVE_SEND_ENABLED:"true"},{fetchImpl}),{state:"processed",count:1});
  assert.equal(seen.filter(x=>x.endsWith("/messages")).length,1);
});

test("live customer-wide sending needs an additional explicit send-all switch",async()=>{
  const paths=[];
  const fetchImpl=async(url,opts)=>{
    const path=new URL(url).pathname;
    paths.push(path);
    if(path.endsWith("/claim_paid_invoice_whatsapp")){
      assert.equal(JSON.parse(opts.body).p_allowed_numbers,null);
      return ok([sample]);
    }
    if(path.endsWith("/messages")){
      assert.equal(JSON.parse(opts.body).template.name,"rainbow_paid_order_invoice");
      return ok({messages:[{id:"wamid.live-production-test"}]});
    }
    if(path.endsWith("/finish_paid_invoice_whatsapp")){
      assert.equal(JSON.parse(opts.body).p_provider_id,"wamid.live-production-test");
      return ok(true);
    }
    throw Error("Unexpected request "+path);
  };
  const result=await sendPaidInvoiceWhatsApp({...liveBase,
    WHATSAPP_LIVE_SEND_ENABLED:"true",WHATSAPP_LIVE_SEND_ALL:"true",
    WHATSAPP_TEST_RECIPIENT_ALLOWLIST:""},{fetchImpl});
  assert.deepEqual(result,{state:"processed",count:1});
  assert.equal(paths.filter(x=>x.endsWith("/messages")).length,1);
});
