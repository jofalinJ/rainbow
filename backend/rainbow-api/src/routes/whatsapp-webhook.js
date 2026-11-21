import {json,methodNotAllowed} from "../http.js";
import {verifyHmac} from "../payment-crypto.js";

// Dedicated, signature-verified Meta callback; never accepts browser-supplied
// customer details or writes a payment/invoice/stock record.
const validMessageId=id=>typeof id==="string"&&
  /^wamid\.[A-Za-z0-9_.:=-]{6,240}$/.test(id);
const validStatus=new Set(["sent","delivered","read","failed"]);

export async function whatsappDeliveryWebhook(request,env={}){
  const url=new URL(request.url);
  if(request.method==="GET"){
    const challenge=url.searchParams.get("hub.challenge");
    const mode=url.searchParams.get("hub.mode");
    const token=url.searchParams.get("hub.verify_token");
    const expected=String(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN||"");
    if(!expected||mode!=="subscribe"||token!==expected ||
       !/^[0-9]{1,100}$/.test(challenge||""))
      return new Response("Webhook verification failed",{status:403});
    return new Response(challenge,{status:200,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  }
  if(request.method!=="POST")return methodNotAllowed("GET, POST");
  const secret=String(env.WHATSAPP_APP_SECRET||"");
  if(!secret||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)
    return json({success:false,error:"Webhook not configured"},503);
  const raw=await request.text();
  if(raw.length>200000)return json({success:false,error:"Webhook too large"},413);
  const signature=request.headers.get("X-Hub-Signature-256")||"";
  if(!signature.startsWith("sha256=")||
     !await verifyHmac(secret,raw,signature.slice(7)))
    return json({success:false,error:"Invalid webhook signature"},401);

  let payload;
  try{payload=JSON.parse(raw);}
  catch{return json({success:false,error:"Invalid event"},400);}
  if(!payload||payload.object!=="whatsapp_business_account"||
     !Array.isArray(payload.entry))return json({success:true,ignored:true});

  const updates=[];
  for(const entry of payload.entry){
    if(!Array.isArray(entry.changes))continue;
    for(const change of entry.changes){
      if(change.field!=="messages")continue;
      const value=change.value||{};
      if(env.WHATSAPP_PHONE_NUMBER_ID &&
         String(value.metadata?.phone_number_id||"")!==String(env.WHATSAPP_PHONE_NUMBER_ID))
        continue;
      for(const item of Array.isArray(value.statuses)?value.statuses:[]){
        if(!validMessageId(item?.id)||!validStatus.has(item?.status))continue;
        const timestamp=Number(item.timestamp);
        if(!Number.isSafeInteger(timestamp) || timestamp<1577836800 ||
           timestamp>4102444800)continue;
        updates.push({p_provider_message_id:item.id,p_status:item.status,
          p_status_at:new Date(timestamp*1000).toISOString()});
        if(updates.length>50)return json({success:false,error:"Too many delivery events"},413);
      }
    }
  }
  if(!updates.length)return json({success:true,ignored:true});

  // Keep unknown message IDs in the SQL inbox so fast callbacks are not lost.
  // SQL merges duplicate/out-of-order events. No recipient or invoice data is stored.
  try{
    for(const update of updates){
      const response=await fetch(new URL("/rest/v1/rpc/record_whatsapp_delivery_status",env.SUPABASE_URL),{
        method:"POST",
        headers:{"Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
          "apikey":env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},
        body:JSON.stringify(update)
      });
      if(!response.ok)throw Error("Delivery status storage failed");
    }
  }catch{
    // Meta should retry: never acknowledge an unrecorded delivery event.
    return json({success:false,error:"Webhook temporarily unavailable"},503);
  }
  return json({success:true,recorded:updates.length});
}
