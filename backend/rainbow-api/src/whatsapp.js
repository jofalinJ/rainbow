// Official Meta WhatsApp Cloud API sender. Runs only from the Worker cron.
// Production messaging requires a separate default-OFF owner approval, verified
// business sender and SQL-enforced paid customer opt-in. No browser can invoke it.
const digits=v=>String(v||"").replace(/\D/g,"");
const validNumber=v=>/^[1-9]\d{9,14}$/.test(v);

export async function sendPaidInvoiceWhatsApp(env, {fetchImpl=fetch}={}){
  if(env.WHATSAPP_SEND_ENABLED!=="true")return {state:"disabled"};
  const allowlist=String(env.WHATSAPP_TEST_RECIPIENT_ALLOWLIST||"")
    .split(",").map(digits).filter(validNumber);
  const wantsProduction=env.PAYMENTS_MODE==="live";
  if(wantsProduction && env.WHATSAPP_PRODUCTION_APPROVED!=="true")
    return {state:"production_not_approved"};
  const live=wantsProduction && env.WHATSAPP_PRODUCTION_APPROVED==="true" &&
    env.LIVE_PAYMENTS_RELEASED==="true" &&
    /^rzp_live_[A-Za-z0-9]+$/.test(String(env.RAZORPAY_LIVE_KEY_ID||""));
  const test=!wantsProduction && /^rzp_test_[A-Za-z0-9]+$/.test(String(env.RAZORPAY_KEY_ID||"")) &&
    allowlist.length>0;
  if(!live && !test)return {state:"test_recipient_allowlist_required"};
  const token=String(env.WHATSAPP_ACCESS_TOKEN||"");
  const phoneId=String(env.WHATSAPP_PHONE_NUMBER_ID||"");
  const template=String(env.WHATSAPP_TEMPLATE_NAME||"");
  const version=String(env.WHATSAPP_GRAPH_VERSION||"v24.0");
  if(!token || !/^\d{5,30}$/.test(phoneId) ||
     !/^[a-z][a-z0-9_]{2,120}$/.test(template) ||
     !/^v\d{1,3}\.\d{1,2}$/.test(version))
    return {state:"provider_not_configured"};

  const rpc=async(name,args)=>{
    const response=await fetchImpl(new URL("/rest/v1/rpc/"+name,env.SUPABASE_URL),{
      method:"POST",
      headers:{"Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
        "apikey":env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},
      body:JSON.stringify(args)
    });
    if(!response.ok)throw new Error("WhatsApp outbox RPC failed: "+name+" "+response.status);
    return response.json();
  };

  if(live){
    // Meta Phone Number ID is opaque: verify the actual outbound number to
    // avoid sending paid invoices from the wrong WhatsApp Business identity.
    const expectedSender=digits(env.WHATSAPP_EXPECTED_SENDER_E164);
    if(!validNumber(expectedSender))return {state:"expected_sender_required"};
    let displayed;
    try{
      const senderResponse=await fetchImpl(
        "https://graph.facebook.com/"+version+"/"+phoneId+"?fields=display_phone_number",{
          headers:{"Authorization":"Bearer "+token}
        });
      if(!senderResponse.ok)return {state:"sender_not_verified"};
      displayed=await senderResponse.json();
    }catch{return {state:"sender_not_verified"};}
    if(digits(displayed.display_phone_number)!==expectedSender)
      return {state:"sender_mismatch"};
  }
  const pending=live
    ?await rpc("claim_paid_invoice_whatsapp_production",{p_limit:5})
    :await rpc("claim_paid_invoice_whatsapp",{p_limit:5,p_allowed_numbers:allowlist});
  if(!Array.isArray(pending))throw new Error("Invalid WhatsApp outbox batch");
  const graphUrl="https://graph.facebook.com/"+version+"/"+phoneId+"/messages";
  for(const item of pending){
    // The recipient and URL were pulled from the database AFTER paid capture.
    // Strictly validate every destination; never send a WhatsApp from arbitrary input.
    const recipient=digits(item.recipient);
    let invoice;
    try{invoice=new URL(item.invoice_url);}catch{invoice=null;}
    const approved=(live||allowlist.includes(recipient))&&validNumber(recipient)&&
      item.whatsapp_opt_in===true&&item.payment_verified===true&&
      invoice?.origin==="https://rainbowgoldcovering.com"&&
      invoice.pathname==="/invoice.html"&&
      /^[0-9a-f-]{36}$/i.test(invoice.searchParams.get("token")||"");
    let providerId=null,errorLabel="delivery_not_confirmed";
    if(approved){
      try {
        const response=await fetchImpl(graphUrl,{
          method:"POST",
          headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
          body:JSON.stringify({
            messaging_product:"whatsapp",to:recipient,type:"template",
            template:{name:template,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE||"en"},
              components:[{type:"body",parameters:[
                {type:"text",text:String(item.customer_name||"Customer").slice(0,80)},
                {type:"text",text:String(item.order_number||"Order").slice(0,60)},
                {type:"text",text:invoice.href}
              ]}]}
          })
        });
        if(!response.ok)throw new Error("HTTP "+response.status);
        const result=await response.json();
        if(typeof result.messages?.[0]?.id!=="string" ||
           !result.messages[0].id.startsWith("wamid."))
          throw new Error("Missing provider acknowledgement");
        providerId=result.messages[0].id;
      }catch(error){
        // Don't print recipient, message body, token, auth key or invoice URL to logs.
        console.error("WhatsApp paid-invoice delivery failed",error.message);
        errorLabel="provider_not_confirmed";
      }
    }else errorLabel="recipient_not_allowlisted_or_bad_invoice_link";
    await rpc("finish_paid_invoice_whatsapp",{
      p_notification_id:item.id,p_provider_id:providerId,p_error:providerId?null:errorLabel
    });
  }
  return {state:"processed",count:pending.length};
}
