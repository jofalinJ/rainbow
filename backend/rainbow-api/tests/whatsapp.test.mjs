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
  customer_name:"Test Customer",
  whatsapp_opt_in:true,payment_verified:true
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


const mockLive={
  ...base,PAYMENTS_MODE:"live",LIVE_PAYMENTS_RELEASED:"true",
  RAZORPAY_LIVE_KEY_ID:"rzp_live_mock123",
  WHATSAPP_PRODUCTION_APPROVED:"true",WHATSAPP_EXPECTED_SENDER_E164:"919999999998"
};
test("live WhatsApp remains default-OFF even with valid Razorpay live keys",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw Error("Should not call Meta or Supabase");};
  const state=await sendPaidInvoiceWhatsApp({...mockLive,WHATSAPP_PRODUCTION_APPROVED:"false"},{fetchImpl});
  assert.deepEqual(state,{state:"production_not_approved"});
  assert.equal(calls,0);
});
test("live messaging refuses an unverified or unexpected Meta sender number",async()=>{
  let calls=[];
  const fetchImpl=async url=>{
    calls.push(new URL(url).pathname);
    return ok({display_phone_number:"+91 99999 99999"});
  };
  const state=await sendPaidInvoiceWhatsApp(mockLive,{fetchImpl});
  assert.deepEqual(state,{state:"sender_mismatch"});
  assert.equal(calls.length,1);
  assert.ok(calls[0].endsWith("/"+mockLive.WHATSAPP_PHONE_NUMBER_ID));
});
test("live sends only claimed opted-in paid invoice after verifying sender",async()=>{
  const paths=[];
  const fetchImpl=async(url,opts={})=>{
    const path=new URL(url).pathname;paths.push(path);
    if(path.endsWith("/"+mockLive.WHATSAPP_PHONE_NUMBER_ID)){
      assert.equal(new URL(url).searchParams.get("fields"),"display_phone_number");
      return ok({display_phone_number:"+91 99999 99998"});
    }
    if(path.endsWith("/claim_paid_invoice_whatsapp_production")){
      assert.deepEqual(JSON.parse(opts.body),{p_limit:5});
      return ok([sample]);
    }
    if(path.endsWith("/messages")){
      assert.equal(JSON.parse(opts.body).to,sample.recipient);
      return ok({messages:[{id:"wamid.live-mocked"}]});
    }
    if(path.endsWith("/finish_paid_invoice_whatsapp")){
      assert.equal(JSON.parse(opts.body).p_provider_id,"wamid.live-mocked");
      return ok(true);
    }
    throw Error("Unexpected path "+path);
  };
  const state=await sendPaidInvoiceWhatsApp(mockLive,{fetchImpl});
  assert.deepEqual(state,{state:"processed",count:1});
  assert.equal(paths.filter(p=>p.endsWith("/messages")).length,1);
  assert.equal(paths.filter(p=>p.endsWith("/claim_paid_invoice_whatsapp")).length,0);
});
test("live refuses rows without explicit opt-in or paid-verification markers",async()=>{
  const paths=[];
  const fetchImpl=async(url,opts={})=>{
    const path=new URL(url).pathname;paths.push(path);
    if(path.endsWith("/"+mockLive.WHATSAPP_PHONE_NUMBER_ID))
      return ok({display_phone_number:"+91 99999 99998"});
    if(path.endsWith("/claim_paid_invoice_whatsapp_production"))
      return ok([{...sample,whatsapp_opt_in:false}]);
    if(path.endsWith("/finish_paid_invoice_whatsapp")){
      assert.equal(JSON.parse(opts.body).p_error,"recipient_not_allowlisted_or_bad_invoice_link");
      return ok(true);
    }
    throw Error("Unexpected WhatsApp API call "+path);
  };
  await sendPaidInvoiceWhatsApp(mockLive,{fetchImpl});
  assert.equal(paths.some(p=>p.endsWith("/messages")),false);
});

