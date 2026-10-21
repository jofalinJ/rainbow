import {json, methodNotAllowed} from "../http.js";
import {verifyHmac,isTestConfigured,isTestSecretsConfigured} from "../payment-crypto.js";

const METHODS="GET, POST, OPTIONS";
const MAX_BODY=14000;
const GATEWAY="https://api.razorpay.com/v1";
const validUUID=x=>typeof x==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const validId=(x,prefix)=>typeof x==="string" && x.startsWith(prefix) && /^[A-Za-z0-9_]{8,80}$/.test(x);
const apiError=(message,status=400)=>json({success:false,error:message},status);
function origins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "https://rainbowgoldcovering.com,https://www.rainbowgoldcovering.com,https://jofalinj.github.io").split(",").map(x=>x.trim()).filter(Boolean));
}
function withCors(request,env,response){
  const origin=request.headers.get("Origin");
  if(!origin || !origins(env).has(origin)) return response;
  const headers=new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin",origin);
  headers.set("Vary","Origin");
  headers.set("Access-Control-Allow-Methods",METHODS);
  headers.set("Access-Control-Allow-Headers","Content-Type");
  headers.set("Access-Control-Max-Age","300");
  return new Response(response.body,{status:response.status,headers});
}
function requireOrigin(request,env) {
  const origin=request.headers.get("Origin");
  return Boolean(origin && origins(env).has(origin));
}
async function readBody(request) {
  const raw=await request.text();
  if(raw.length>MAX_BODY) throw new Error("Request is too large");
  const parsed=JSON.parse(raw);
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("Invalid request");
  return parsed;
}
async function callDb(env,fn,payload) {
  const res=await fetch(new URL("/rest/v1/rpc/"+fn, String(env.SUPABASE_URL)),{
    method:"POST",
    headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type":"application/json","Cache-Control":"no-store"},
    body:JSON.stringify(payload)
  });
  if(!res.ok) {
    // Never echo database errors, customer details, request bodies or credentials.
    throw new Error("Database operation failed ("+res.status+")");
  }
  return res.json();
}
async function callRazorpay(env,path,body) {
  const headers={"Authorization":"Basic "+btoa(env.RAZORPAY_KEY_ID+":"+env.RAZORPAY_KEY_SECRET)};
  if(body!==undefined) headers["Content-Type"]="application/json";
  const response=await fetch(GATEWAY+path,{
    method:body===undefined?"GET":"POST",headers,
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!response.ok) throw new Error("Payment provider request failed ("+response.status+")");
  return response.json();
}
function reply(request,env,response){return withCors(request,env,response);}
export async function razorpayRoute(request,env) {
  const path=new URL(request.url).pathname;
  if(path==="/api/razorpay/webhook") return webhook(request,env);
  if(path==="/api/razorpay/config"){
    if(request.method==="OPTIONS") return reply(request,env,new Response(null,{status:204}));
    if(request.method!=="GET") return methodNotAllowed("GET, OPTIONS");
    return reply(request,env,json({
      enabled:isTestConfigured(env),mode:"test",release:"testgate-20261021-v3",
      ...(isTestConfigured(env)?{keyId:env.RAZORPAY_KEY_ID}: {})
    }));
  }
  // Explicit, rate-limited non-mutating provider credential probe for TEST onboarding.
  // Never return Razorpay order/customer records or any key material.
  if(path==="/api/razorpay/provider-check"){
    if(request.method!=="GET") return reply(request,env,methodNotAllowed("GET"));
    if(!requireOrigin(request,env)) return apiError("Origin is not allowed",403);
    if(!isTestConfigured(env)) return reply(request,env,json({provider:"disabled"}));
    if(!env.CHECKOUT_RATE_LIMITER || typeof env.CHECKOUT_RATE_LIMITER.limit!=="function")
      return reply(request,env,apiError("Payment protection is not configured",503));
    const caller=request.headers.get("CF-Connecting-IP")||"unknown";
    const result=await env.CHECKOUT_RATE_LIMITER.limit({key:caller+":provider-check"});
    if(!result.success) return reply(request,env,apiError("Too many requests",429));
    try {
      const provider=await fetch(GATEWAY+"/orders?count=1",{
        headers:{"Authorization":"Basic "+btoa(env.RAZORPAY_KEY_ID+":"+env.RAZORPAY_KEY_SECRET)}
      });
      return reply(request,env,json({provider:provider.ok?"connected":
        (provider.status===401||provider.status===403||provider.status===400)?"credentials_rejected":"unavailable"}));
    } catch {
      return reply(request,env,json({provider:"unavailable"}));
    }
  }
  if(request.method==="OPTIONS") return reply(request,env,new Response(null,{status:204}));
  if(request.method!=="POST") return reply(request,env,methodNotAllowed("POST, OPTIONS"));
  if(!requireOrigin(request,env)) return apiError("Origin is not allowed",403);
  if(!isTestConfigured(env)) return reply(request,env,apiError("Razorpay checkout is not enabled",503));
  // Origins are not authentication. Require Cloudflare rate limiting before any public checkout call.
  if(!env.CHECKOUT_RATE_LIMITER || typeof env.CHECKOUT_RATE_LIMITER.limit!=="function")
    return reply(request,env,apiError("Payment protection is not configured",503));
  const caller=request.headers.get("CF-Connecting-IP")||"unknown";
  const limit=await env.CHECKOUT_RATE_LIMITER.limit({key:caller+":"+path});
  if(!limit.success) return reply(request,env,apiError("Too many payment requests. Try again shortly.",429));
  try {
    if(path==="/api/razorpay/create") return reply(request,env,await prepare(request,env));
    if(path==="/api/razorpay/verify") return reply(request,env,await verify(request,env));
    return reply(request,env,apiError("Endpoint not found",404));
  }catch(error){
    console.error("Razorpay route error",error.message);
    return reply(request,env,apiError("Checkout could not be completed. Please retry or contact the shop.",503));
  }
}
async function prepare(request,env){
  const body=await readBody(request);
  if(!validUUID(body.checkout_id) || !Array.isArray(body.items) || body.items.length<1 || body.items.length>50 ||
    !body.customer || typeof body.customer!=="object" || Array.isArray(body.customer) ||
    !body.items.every(i=>validUUID(i.variant_id)&&Number.isInteger(i.quantity)&&i.quantity>=1&&i.quantity<=100))
    return apiError("Invalid checkout details");
  // Idempotency is enforced by a UNIQUE client checkout UUID and a row lock in the database.
  const held=await callDb(env,"create_razorpay_checkout",{
    p_checkout_id:body.checkout_id,p_items:body.items,p_customer:body.customer
  });
  if(held.state==="ready" && validId(held.gateway_order_id,"order_"))
    return json({success:true,keyId:env.RAZORPAY_KEY_ID,
      gatewayOrderId:held.gateway_order_id,orderNumber:held.order_number,
      amount:held.amount_paise,currency:"INR",expiresAt:held.expires_at});
  if(held.state==="creating"){
    // Recover an order created at Razorpay when the initial response or DB attach
    // was lost. NEVER create another provider order for the same receipt.
    if(new Date(held.expires_at).getTime()<=Date.now())
      return apiError("This checkout reservation has expired. Refresh your cart and try after stock is released.",409);
    const receipt=body.checkout_id.replace(/-/g,"");
    const result=await callRazorpay(env,"/orders?receipt="+encodeURIComponent(receipt)+"&count=10");
    const matches=(Array.isArray(result.items)?result.items:[]).filter(order=>
      order.receipt===receipt && order.amount===held.amount_paise &&
      order.currency==="INR" && validId(order.id,"order_"));
    if(matches.length!==1 || matches[0].status!=="created")
      return apiError("Your payment is still being prepared. Please wait; your order is reserved. Contact the shop if this persists.",409);
    const gateway=matches[0];
    const saved=await callDb(env,"attach_razorpay_order",{
      p_checkout_id:body.checkout_id,p_gateway_order_id:gateway.id,p_amount_paise:gateway.amount
    });
    if(saved.state!=="ready" || saved.gateway_order_id!==gateway.id)
      throw new Error("Recovered provider order could not be attached");
    return json({success:true,keyId:env.RAZORPAY_KEY_ID,
      gatewayOrderId:gateway.id,orderNumber:held.order_number,
      amount:held.amount_paise,currency:"INR",expiresAt:held.expires_at});
  }
  if(held.state==="expired") return json({success:false,code:"CHECKOUT_EXPIRED",
    error:"Your previous test reservation expired. Please review the cart and retry."},410);
  if(held.state!=="new") return apiError("This checkout has already been processed. Contact the shop before retrying.",409);
  if(!Number.isSafeInteger(held.amount_paise)||held.amount_paise<=0)
    throw new Error("Invalid authoritative amount");
  // A failed/uncertain provider call leaves the reservation held for timeout cleanup;
  // never create a second provider order using the same checkout UUID.
  const gateway=await callRazorpay(env,"/orders",{
    amount:held.amount_paise,currency:"INR",receipt:body.checkout_id.replace(/-/g,""),
    notes:{shop_order:held.order_number},partial_payment:false
  });
  if(!validId(gateway.id,"order_") || gateway.amount!==held.amount_paise || gateway.currency!=="INR")
    throw new Error("Provider amount mismatch");
  const saved=await callDb(env,"attach_razorpay_order",{
    p_checkout_id:body.checkout_id,p_gateway_order_id:gateway.id,p_amount_paise:gateway.amount
  });
  if(saved.state!=="ready" || saved.gateway_order_id!==gateway.id) throw new Error("Could not attach provider order");
  return json({success:true,keyId:env.RAZORPAY_KEY_ID,
    gatewayOrderId:gateway.id,orderNumber:held.order_number,
    amount:gateway.amount,currency:"INR",expiresAt:held.expires_at});
}
async function verify(request,env) {
  const body=await readBody(request);
  if(!validUUID(body.checkout_id) || !validId(body.razorpay_order_id,"order_") ||
    !validId(body.razorpay_payment_id,"pay_") || typeof body.razorpay_signature!=="string")
    return apiError("Invalid payment verification details");
  const checkout=await callDb(env,"get_razorpay_checkout",{p_checkout_id:body.checkout_id});
  if(!checkout || checkout.gateway_order_id!==body.razorpay_order_id) return apiError("Unknown payment order",404);
  const valid=await verifyHmac(env.RAZORPAY_KEY_SECRET,
    checkout.gateway_order_id+"|"+body.razorpay_payment_id,body.razorpay_signature);
  if(!valid) return apiError("Invalid payment signature",401);
  const payment=await callRazorpay(env,"/payments/"+encodeURIComponent(body.razorpay_payment_id));
  if(payment.id!==body.razorpay_payment_id || payment.order_id!==checkout.gateway_order_id ||
    payment.currency!=="INR" || payment.amount!==checkout.amount_paise)
    return apiError("Payment does not match the verified order",409);
  if(payment.status!=="captured") return json({success:true,paid:false,status:"awaiting_capture"});
  const settled=await callDb(env,"complete_razorpay_checkout",{
    p_gateway_order_id:checkout.gateway_order_id,p_payment_id:payment.id,
    p_amount_paise:payment.amount,p_event_id:null
  });
  return json({success:true,paid:settled.paid===true,
    status:settled.state,orderNumber:settled.order_number});
}
async function webhook(request,env){
  if(request.method!=="POST") return methodNotAllowed("POST");
  if(!isTestSecretsConfigured(env)) return apiError("Webhook is unavailable",503);
  const raw=await request.text();
  if(raw.length>200000) return apiError("Webhook too large",413);
  const signature=request.headers.get("x-razorpay-signature");
  if(!await verifyHmac(env.RAZORPAY_WEBHOOK_SECRET,raw,signature)) return apiError("Invalid webhook signature",401);
  const eventId=request.headers.get("x-razorpay-event-id");
  if(!eventId || eventId.length>128) return apiError("Invalid event identifier");
  try{
    const event=JSON.parse(raw);
    if(event.event!=="payment.captured") return json({success:true,ignored:true});
    const eventPayment=event.payload?.payment?.entity;
    if(!validId(eventPayment?.id,"pay_") || !validId(eventPayment?.order_id,"order_"))
      return apiError("Invalid payment event");
    // Fetch the current payment from Razorpay; never trust an unverified browser or stale event amount.
    const payment=await callRazorpay(env,"/payments/"+encodeURIComponent(eventPayment.id));
    if(payment.status!=="captured" || payment.id!==eventPayment.id ||
      payment.order_id!==eventPayment.order_id || payment.currency!=="INR")
      return apiError("Payment status is not captured",409);
    const settled=await callDb(env,"complete_razorpay_checkout",{
      p_gateway_order_id:payment.order_id,p_payment_id:payment.id,
      p_amount_paise:payment.amount,p_event_id:eventId
    });
    return json({success:true,paid:settled.paid===true});
  }catch(error){
    console.error("Payment webhook failed",error.message);
    return apiError("Webhook processing failed",503); // retry; never acknowledge failed settlement.
  }
}
export async function expireRazorpayReservations(env){
  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try{await callDb(env,"expire_razorpay_checkouts",{p_limit:100});}
  catch(error){console.error("Reservation expiry failed",error.message);}
}
