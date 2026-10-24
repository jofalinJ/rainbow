import test from "node:test";
import assert from "node:assert/strict";
import {sendPaidInvoiceWhatsApp} from "../src/whatsapp.js";

const base={
  WHATSAPP_SEND_ENABLED:"true",
  WHATSAPP_TEMPLATE_APPROVED:"true",
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

test("template approval is required even when sender credentials and allowlist exist",async()=>{
  let calls=0;
  const result=await sendPaidInvoiceWhatsApp({...base,WHATSAPP_TEMPLATE_APPROVED:undefined}, {
    fetchImpl:async()=>{calls++;throw new Error("Must not claim or send");}
  });
  assert.deepEqual(result,{state:"approved_template_required"});
  assert.equal(calls,0);
});

test("live Razorpay keys and invalid provider configuration never claim notifications",async()=>{
  let calls=0;
  for(const patch of [{RAZORPAY_KEY_ID:"rzp_live_fake"},{WHATSAPP_TEMPLATE_LANGUAGE:"en/../../"},
    {WHATSAPP_PHONE_NUMBER_ID:"../123"},{SUPABASE_SERVICE_ROLE_KEY:""}]){
    await sendPaidInvoiceWhatsApp({...base,...patch}, {
      fetchImpl:async()=>{calls++;throw new Error("Must not claim or send");}
    });
  }
  assert.equal(calls,0);
});

test("no Meta request occurs without independently returned consent and verified payment",async()=>{
  for(const patch of [{whatsapp_opt_in:false},{whatsapp_opt_in:undefined},
    {payment_verified:false},{payment_verified:undefined},{recipient:"918888888888"}]){
    let messages=0;
    await sendPaidInvoiceWhatsApp(base,{fetchImpl:async(url,opts)=>{
      const path=new URL(url).pathname;
      if(path.endsWith("/claim_paid_invoice_whatsapp"))return ok([{...sample,...patch}]);
      if(path.endsWith("/finish_paid_invoice_whatsapp")){
        assert.equal(JSON.parse(opts.body).p_provider_id,null);
        return ok(true);
      }
      messages++;throw new Error("Must not send");
    }});
    assert.equal(messages,0);
  }
});

test("invoice links reject extra tokens, credentials, fragments and malformed UUIDs",async()=>{
  const urls=[sample.invoice_url+"&token=00000000-0000-4000-8000-000000000002",
    sample.invoice_url+"&recipient=private",sample.invoice_url+"#private",
    sample.invoice_url.replace("https://","https://user@"),
    "https://rainbowgoldcovering.com/invoice.html?token=------------------------------------"];
  for(const invoice_url of urls){
    let messages=0;
    await sendPaidInvoiceWhatsApp(base,{fetchImpl:async(url)=>{
      const path=new URL(url).pathname;
      if(path.endsWith("/claim_paid_invoice_whatsapp"))return ok([{...sample,invoice_url}]);
      if(path.endsWith("/finish_paid_invoice_whatsapp"))return ok(true);
      messages++;throw new Error("Must not send");
    }});
    assert.equal(messages,0);
  }
});

test("a Meta HTTP success without message acknowledgement is recorded as unconfirmed",async()=>{
  const result=await sendPaidInvoiceWhatsApp(base,{fetchImpl:async(url,opts)=>{
    const path=new URL(url).pathname;
    if(path.endsWith("/claim_paid_invoice_whatsapp"))return ok([sample]);
    if(path.endsWith("/messages"))return ok({success:true});
    if(path.endsWith("/finish_paid_invoice_whatsapp")){
      const payload=JSON.parse(opts.body);
      assert.equal(payload.p_provider_id,null);
      assert.equal(payload.p_error,"provider_not_confirmed");
      return ok(true);
    }
    throw new Error("Unexpected request");
  }});
  assert.deepEqual(result,{state:"processed",count:1});
});
