import {json, methodNotAllowed} from "../http.js";
import {hmacHex,verifyHmac,isTestConfigured,isTestSecretsConfigured} from "../payment-crypto.js";

const METHODS="GET, POST, OPTIONS";
const MAX_BODY=14000;
const GATEWAY="https://api.razorpay.com/v1";
const validUUID=x=>typeof x==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const validId=(x,prefix)=>typeof x==="string" && x.startsWith(prefix) && /^[A-Za-z0-9_]{8,80}$/.test(x);
const isRecord=x=>Boolean(x && typeof x==="object" && !Array.isArray(x));
const validItems=items=>Array.isArray(items) && items.length>=1 && items.length<=50 &&
  items.every(i=>isRecord(i) && validUUID(i.variant_id) && Number.isInteger(i.quantity) && i.quantity>=1 && i.quantity<=100) &&
  new Set(items.map(i=>i.variant_id.toLowerCase())).size===items.length;
const apiError=(message,status=400)=>json({success:false,error:message},status);
class RequestError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
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
async function readText(request,maxBytes) {
  if(Number(request.headers.get("Content-Length"))>maxBytes)
    throw new RequestError("Request is too large",413);
  if(!request.body)return "";
  const reader=request.body.getReader(),parts=[];
  let size=0;
  try {
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new RequestError("Request is too large",413);}
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  return new TextDecoder().decode(bytes);
}
async function readBody(request) {
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("Content-Type")||""))
    throw new RequestError("Content-Type must be application/json",415);
  const raw=await readText(request,MAX_BODY);
  let parsed;
  try{parsed=JSON.parse(raw);}catch{throw new RequestError("Invalid JSON request");}
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new RequestError("Invalid request");
  return parsed;
}
async function paymentProtection(request,env,keySuffix){
  if(!env.CHECKOUT_RATE_LIMITER || typeof env.CHECKOUT_RATE_LIMITER.limit!=="function")
    return apiError("Payment protection is not configured",503);
  try {
    const caller=request.headers.get("CF-Connecting-IP")||"unknown";
    const result=await env.CHECKOUT_RATE_LIMITER.limit({key:caller+":"+keySuffix});
    if(result?.success===true)return null;
    if(result?.success===false)return json({success:false,error:"Too many payment requests. Try again shortly."},429,{"Retry-After":"60"});
  }catch{console.error("Payment rate limiter is unavailable");}
  // Never fall back to process-local counters or allow traffic when a shared binding fails.
  return apiError("Payment protection is temporarily unavailable",503);
}
async function callDb(env,fn,payload) {
  const res=await fetch(new URL("/rest/v1/rpc/"+fn, String(env.SUPABASE_URL)),{
    method:"POST",
    headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type":"application/json","Cache-Control":"no-store"},
    body:JSON.stringify(payload),redirect:"error",signal:AbortSignal.timeout(10000)
  });
  if(!res.ok) {
    // Never echo database errors, customer details, request bodies or credentials.
    throw new Error("Database operation failed ("+res.status+")");
  }
  return res.json();
}
function isDatabaseConfigured(env){
  if(typeof env.SUPABASE_SERVICE_ROLE_KEY!=="string" || !env.SUPABASE_SERVICE_ROLE_KEY.trim() ||
    typeof env.SUPABASE_URL!=="string")return false;
  try{
    const url=new URL(env.SUPABASE_URL);
    return url.protocol==="https:" && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname==="/";
  }catch{return false;}
}
async function callRazorpay(env,path,body) {
  const headers={"Authorization":"Basic "+btoa(env.RAZORPAY_KEY_ID+":"+env.RAZORPAY_KEY_SECRET)};
  if(body!==undefined) headers["Content-Type"]="application/json";
  const response=await fetch(GATEWAY+path,{
    method:body===undefined?"GET":"POST",headers,
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    redirect:"error",signal:AbortSignal.timeout(15000)
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
      enabled:isTestConfigured(env),mode:"test",release:"paid-invoice-20261021-v4",
      ...(isTestConfigured(env)?{keyId:env.RAZORPAY_KEY_ID}: {})
    }));
  }
  // Explicit, rate-limited non-mutating provider credential probe for TEST onboarding.
  // Never return Razorpay order/customer records or any key material.
  if(path==="/api/razorpay/provider-check"){
    if(request.method!=="GET") return reply(request,env,methodNotAllowed("GET"));
    if(!requireOrigin(request,env)) return apiError("Origin is not allowed",403);
    if(!isTestConfigured(env)) return reply(request,env,json({provider:"disabled"}));
    const protection=await paymentProtection(request,env,"provider-check");
    if(protection)return reply(request,env,protection);
    try {
      const provider=await fetch(GATEWAY+"/orders?count=1",{
        headers:{"Authorization":"Basic "+btoa(env.RAZORPAY_KEY_ID+":"+env.RAZORPAY_KEY_SECRET)},
        redirect:"error",signal:AbortSignal.timeout(15000)
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
  const databaseOnly=path==="/api/razorpay/manual-upi" || path==="/api/razorpay/track";
  const reconciliation=path==="/api/razorpay/status" || path==="/api/razorpay/verify";
  if(databaseOnly && !isDatabaseConfigured(env))
    return reply(request,env,apiError("Checkout service is not configured",503));
  if(!databaseOnly && !(reconciliation?isTestSecretsConfigured(env):isTestConfigured(env)))
    return reply(request,env,apiError("Razorpay checkout is not enabled",503));
  // Origins are not authentication. Require Cloudflare rate limiting before any public checkout call.
  const protection=await paymentProtection(request,env,path);
  if(protection)return reply(request,env,protection);
  try {
    if(path==="/api/razorpay/manual-upi") return reply(request,env,await manualUpi(request,env));
    if(path==="/api/razorpay/track") return reply(request,env,await trackGuestOrder(request,env));
    if(path==="/api/razorpay/create") return reply(request,env,await prepare(request,env));
    if(path==="/api/razorpay/verify") return reply(request,env,await verify(request,env));
    if(path==="/api/razorpay/status") return reply(request,env,await checkoutStatus(request,env));
    return reply(request,env,apiError("Endpoint not found",404));
  }catch(error){
    if(error instanceof RequestError)return reply(request,env,apiError(error.message,error.status));
    console.error("Razorpay route error",error.message);
    return reply(request,env,apiError("Checkout could not be completed. Please retry or contact the shop.",503));
  }
}
const recoveryContext=(checkoutId,gatewayOrderId)=>"checkout-recovery:v1|"+checkoutId+"|"+gatewayOrderId;
async function preparedResponse(env,checkoutId,gatewayOrderId,orderNumber,amount,expiresAt){
  return json({success:true,keyId:env.RAZORPAY_KEY_ID,gatewayOrderId,orderNumber,
    amount,currency:"INR",expiresAt,
    recoveryToken:await hmacHex(env.RAZORPAY_KEY_SECRET,recoveryContext(checkoutId,gatewayOrderId))});
}
async function manualUpi(request,env){
  const body=await readBody(request),customer=body.customer;
  if(!validItems(body.items) || !isRecord(customer) || !validUUID(customer.checkout_id))
    return apiError("Invalid manual UPI checkout details");
  const boundedText=(value,max,required=false)=>typeof value==="string" &&
    value.trim().length<=max && (!required || value.trim().length>0);
  if(!boundedText(customer.name,160,true) || !boundedText(customer.address,2000,true) ||
    !boundedText(customer.state,100,true) || !boundedText(customer.whatsapp_number,32,true) ||
    !/^\d{10,15}$/.test(customer.whatsapp_number.replace(/[^0-9]/g,"")) ||
    customer.payment_method!=="upi" ||
    typeof customer.payment_reference!=="string" || !/^[A-Za-z0-9-]{8,64}$/.test(customer.payment_reference) ||
    (customer.email!==undefined && !boundedText(customer.email,254)) ||
    (customer.city!==undefined && !boundedText(customer.city,120)) ||
    (customer.pin_code!==undefined && customer.pin_code!=="" &&
      (typeof customer.pin_code!=="string" || !/^\d{6}$/.test(customer.pin_code))) ||
    (customer.whatsapp_opt_in!==undefined && typeof customer.whatsapp_opt_in!=="boolean"))
    return apiError("Invalid manual UPI checkout details");
  // Explicit fields only: the caller cannot supply prices, payment status, staff
  // verification, another RPC name, or an Authorization header for the database.
  const safeCustomer={};
  for(const key of ["checkout_id","name","whatsapp_number","email","address","city","state","pin_code",
    "payment_method","payment_reference","whatsapp_opt_in"])
    if(customer[key]!==undefined)safeCustomer[key]=customer[key];
  const result=await callDb(env,"create_online_order",{
    p_items:body.items.map(({variant_id,quantity})=>({variant_id,quantity})),p_customer:safeCustomer
  });
  if(!isRecord(result))throw new Error("Invalid manual checkout response");
  // This is a pending staff-verification submission, never proof of payment.
  return json({success:true,...result});
}
async function trackGuestOrder(request,env){
  const body=await readBody(request);
  if(typeof body.product_code!=="string" || body.product_code.trim().length<1 ||
    body.product_code.trim().length>64 || typeof body.phone!=="string" || body.phone.length>32)
    return apiError("Enter a valid product code and phone number");
  const phone=body.phone.replace(/[^0-9]/g,"");
  if(!/^(?:\d{10}|91\d{10})$/.test(phone))
    return apiError("Enter a 10-digit Indian phone number, optionally prefixed with 91");
  const orders=await callDb(env,"track_guest_order_shipments",{
    p_product_code:body.product_code.trim(),p_phone:phone
  });
  if(!Array.isArray(orders) || orders.some(order=>!isRecord(order)))
    throw new Error("Invalid tracking response");
  const publicFields=["order_number","product_name","product_names","order_status","payment_status",
    "created_at","courier_provider","consignment_number","dispatch_date","shipment_status","shipment_updated_at"];
  return json({success:true,orders:orders.slice(0,10).map(order=>
    Object.fromEntries(publicFields.filter(key=>Object.hasOwn(order,key)).map(key=>[key,order[key]])))});
}
async function prepare(request,env){
  const body=await readBody(request);
  if(!validUUID(body.checkout_id) || !validItems(body.items) || !isRecord(body.customer))
    return apiError("Invalid checkout details");
  // Idempotency is enforced by a UNIQUE client checkout UUID and a row lock in the database.
  const held=await callDb(env,"create_razorpay_checkout",{
    p_checkout_id:body.checkout_id,p_items:body.items,p_customer:body.customer
  });
  // Customer consent is voluntary and attached to the same reserved checkout.
  // Only the server can update it; never send a message before verified capture.
  if(typeof body.customer.whatsapp_opt_in==="boolean")
    await callDb(env,"set_razorpay_whatsapp_opt_in",{
      p_checkout_id:body.checkout_id,p_opt_in:body.customer.whatsapp_opt_in
    });
  if(["new","ready","creating"].includes(held.state) &&
    (!Number.isSafeInteger(held.amount_paise)||held.amount_paise<=0||
      !Number.isFinite(Date.parse(held.expires_at))))
    throw new Error("Invalid authoritative checkout");
  if(held.state==="ready" && Date.parse(held.expires_at)<=Date.now())
    return apiError("This checkout reservation has expired. Wait for stock to be released before retrying.",409);
  if(held.state==="ready" && validId(held.gateway_order_id,"order_"))
    return preparedResponse(env,body.checkout_id,held.gateway_order_id,held.order_number,held.amount_paise,held.expires_at);
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
    return preparedResponse(env,body.checkout_id,gateway.id,held.order_number,held.amount_paise,held.expires_at);
  }
  if(held.state==="expired") return json({success:false,code:"CHECKOUT_EXPIRED",
    error:"Your previous test reservation expired. Please review the cart and retry."},410);
  if(held.state!=="new") return apiError("This checkout has already been processed. Contact the shop before retrying.",409);
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
  return preparedResponse(env,body.checkout_id,gateway.id,held.order_number,gateway.amount,held.expires_at);
}
function validPayment(payment){
  return payment && validId(payment.id,"pay_") && validId(payment.order_id,"order_") &&
    payment.currency==="INR" && Number.isSafeInteger(payment.amount) && payment.amount>0;
}
function hasVerifiedRefund(payment){
  return payment.captured===true && ["captured","refunded"].includes(payment.status) &&
    Number.isSafeInteger(payment.amount_refunded) && payment.amount_refunded>0 &&
    payment.amount_refunded<=payment.amount &&
    ((payment.refund_status==="full" && payment.amount_refunded===payment.amount) ||
      (payment.refund_status==="partial" && payment.amount_refunded<payment.amount));
}
function isCapturedWithoutRefund(payment){
  return payment.status==="captured" && payment.captured===true &&
    payment.amount_refunded===0 && payment.refund_status===null;
}
function isUncapturedAttempt(payment){
  return ["created","authorized","failed"].includes(payment.status) && payment.captured===false &&
    payment.amount_refunded===0 && payment.refund_status===null;
}
async function recordRefund(env,payment,eventId=null,refundId=null){
  return callDb(env,"record_razorpay_refund",{
    p_gateway_order_id:payment.order_id,p_payment_id:payment.id,
    p_amount_paise:payment.amount,p_amount_refunded_paise:payment.amount_refunded,
    p_event_id:eventId,p_refund_id:refundId
  });
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
  return reconcilePayment(env,body.checkout_id,checkout,payment,body.razorpay_payment_id);
}
async function checkoutStatus(request,env){
  const body=await readBody(request);
  if(!validUUID(body.checkout_id) || !validId(body.gateway_order_id,"order_") ||
    typeof body.recovery_token!=="string" || !/^[a-f0-9]{64}$/i.test(body.recovery_token))
    return apiError("Invalid checkout recovery details");
  // A checkout UUID or provider order ID alone never permits a payment/invoice
  // lookup. Only a capability issued before opening this checkout can recover it.
  if(!await verifyHmac(env.RAZORPAY_KEY_SECRET,
    recoveryContext(body.checkout_id,body.gateway_order_id),body.recovery_token))
    return apiError("Invalid checkout recovery token",401);
  const checkout=await callDb(env,"get_razorpay_checkout",{p_checkout_id:body.checkout_id});
  if(!checkout || checkout.gateway_order_id!==body.gateway_order_id)
    return apiError("Unknown payment order",404);
  if(!Number.isSafeInteger(checkout.amount_paise) || checkout.amount_paise<=0)
    throw new Error("Invalid authoritative checkout amount");
  if(checkout.gateway_payment_id!==undefined && checkout.gateway_payment_id!==null){
    if(!validId(checkout.gateway_payment_id,"pay_"))throw new Error("Invalid recorded payment identifier");
    const payment=await callRazorpay(env,"/payments/"+encodeURIComponent(checkout.gateway_payment_id));
    return reconcilePayment(env,body.checkout_id,checkout,payment,checkout.gateway_payment_id);
  }
  // Razorpay's Orders API returns the payment attempts even when the browser
  // closed before its signed callback or before a webhook reached this Worker.
  const collection=await callRazorpay(env,"/orders/"+encodeURIComponent(checkout.gateway_order_id)+"/payments");
  if(collection?.entity!=="collection" || !Array.isArray(collection.items) ||
    !Number.isSafeInteger(collection.count) || collection.count!==collection.items.length ||
    !collection.items.every(payment=>validPayment(payment) &&
      payment.order_id===checkout.gateway_order_id && payment.amount===checkout.amount_paise &&
      (isCapturedWithoutRefund(payment) || hasVerifiedRefund(payment) || isUncapturedAttempt(payment))))
    throw new Error("Invalid provider payment collection");
  const payments=collection.items;
  const captured=payments.filter(payment=>payment.status==="captured" || payment.status==="refunded");
  if(captured.length>1)return apiError("Multiple payment captures need shop review. Do not pay again.",409);
  if(captured.length===1)return reconcilePayment(env,body.checkout_id,checkout,captured[0],captured[0].id);
  if(payments.some(payment=>payment.status==="authorized" || payment.status==="created"))
    return json({success:true,paid:false,status:"awaiting_capture"});
  // A browser timeout cannot release a reservation. Only the database cleanup
  // job can declare expiry, and current provider attempts must be non-payable.
  if(checkout.state==="expired" && Number.isFinite(Date.parse(checkout.reservation_released_at)))
    return json({success:true,paid:false,status:"checkout_expired"});
  return json({success:true,paid:false,status:payments.length?"payment_failed":"pending"});
}
async function reconcilePayment(env,checkoutId,checkout,payment,expectedPaymentId){
  if(!validPayment(payment) || payment.id!==expectedPaymentId ||
    payment.order_id!==checkout.gateway_order_id || payment.amount!==checkout.amount_paise)
    return apiError("Payment does not match the verified order",409);
  if(hasVerifiedRefund(payment)){
    const refunded=await recordRefund(env,payment);
    return json({success:true,paid:false,status:refunded.state,orderNumber:refunded.order_number});
  }
  if(payment.status==="failed")return json({success:true,paid:false,status:"payment_failed"});
  if(payment.status==="created"||payment.status==="authorized")
    return json({success:true,paid:false,status:"awaiting_capture"});
  if(!isCapturedWithoutRefund(payment))return apiError("Payment capture is not verified",409);
  const settled=await callDb(env,"complete_razorpay_checkout",{
    p_gateway_order_id:checkout.gateway_order_id,p_payment_id:payment.id,
    p_amount_paise:payment.amount,p_event_id:null
  });
  let receipt=null;
  if(settled.paid===true){
    try{
      receipt=await callDb(env,"get_paid_razorpay_receipt",{
        p_checkout_id:checkoutId,p_gateway_order_id:checkout.gateway_order_id
      });
    }catch(error){
      console.error("Paid order receipt lookup failed",error.message);
      // Do not turn a CAPTURED, settled payment into a misleading checkout failure.
    }
  }
  return json({success:true,paid:settled.paid===true,
    status:settled.state,orderNumber:settled.order_number,
    ...(receipt?.invoice_url?{invoiceUrl:receipt.invoice_url,invoiceNumber:receipt.invoice_number}:{})});
}
async function webhook(request,env){
  if(request.method!=="POST") return methodNotAllowed("POST");
  if(!isTestSecretsConfigured(env)) return apiError("Webhook is unavailable",503);
  let raw;
  try{raw=await readText(request,200000);}catch(error){
    if(error instanceof RequestError)return apiError(error.message,error.status);
    return apiError("Webhook could not be read",400);
  }
  const signature=request.headers.get("x-razorpay-signature");
  if(!await verifyHmac(env.RAZORPAY_WEBHOOK_SECRET,raw,signature)) return apiError("Invalid webhook signature",401);
  const eventId=request.headers.get("x-razorpay-event-id");
  if(!eventId || !/^[A-Za-z0-9_:-]{1,128}$/.test(eventId)) return apiError("Invalid event identifier");
  try{
    let event;
    try{event=JSON.parse(raw);}catch{return apiError("Invalid webhook JSON");}
    if(!event || typeof event!=="object" || Array.isArray(event))return apiError("Invalid webhook event");
    const refundEvent=event.event==="payment.refunded" || event.event==="refund.processed";
    if(event.event!=="payment.captured" && !refundEvent) return json({success:true,ignored:true});
    const eventPayment=event.payload?.payment?.entity;
    const eventRefund=event.payload?.refund?.entity;
    const paymentId=eventPayment?.id || eventRefund?.payment_id;
    if((!refundEvent && !eventPayment) || !validId(paymentId,"pay_") ||
      (eventPayment && !validId(eventPayment.order_id,"order_")) ||
      (eventRefund && (!validId(eventRefund.id,"rfnd_") || eventRefund.payment_id!==paymentId)))
      return apiError("Invalid payment event");
    // Fetch the current payment from Razorpay; never trust an unverified browser or stale event amount.
    const payment=await callRazorpay(env,"/payments/"+encodeURIComponent(paymentId));
    if(!validPayment(payment) || payment.id!==paymentId ||
      (eventPayment && payment.order_id!==eventPayment.order_id))
      return apiError("Payment does not match the verified event",409);
    // A delayed capture event can arrive after a refund. Current provider state wins.
    if(hasVerifiedRefund(payment)){
      const refunded=await recordRefund(env,payment,eventId,eventRefund?.id||null);
      return json({success:true,paid:false,status:refunded.state});
    }
    if(refundEvent)return apiError("Provider refund is not yet verified",409);
    if(!isCapturedWithoutRefund(payment))
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
  try{await callDb(env,"expire_manual_upi_checkouts",{p_limit:100});}
  catch(error){console.error("Manual UPI reservation expiry failed",error.message);}
}
