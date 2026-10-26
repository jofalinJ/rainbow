// Server-gated Razorpay integration: tests and real payments use separate backend credentials.
const getBase=()=>{
  const value=String(window.RAINBOW_PAYMENT_CONFIG?.apiBaseUrl||"").trim();
  try{const url=new URL(value); return url.protocol==="https:" ? url.origin : "";}catch{return "";}
};
let gatewayScriptPromise;
function loadGatewayScript(){
  if(window.Razorpay)return Promise.resolve();
  if(gatewayScriptPromise)return gatewayScriptPromise;
  gatewayScriptPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://checkout.razorpay.com/v1/checkout.js";
    script.async=true;
    script.onload=()=>window.Razorpay?resolve():reject(new Error("Gateway failed to load"));
    script.onerror=()=>reject(new Error("Gateway failed to load"));
    document.head.append(script);
  });
  return gatewayScriptPromise;
}
async function api(path,body){
  const base=getBase();
  if(!base)throw new Error("Secure checkout is not configured yet.");
  const res=await fetch(base+path,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body),cache:"no-store"
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || data.success===false){
    const error=new Error(data.error||"Payment service is unavailable");
    if(res.status===410 && data.code==="CHECKOUT_EXPIRED")error.code="CHECKOUT_EXPIRED";
    throw error;
  }
  return data;
}
async function checkoutFingerprint(items,customer){
  const encoded=new TextEncoder().encode(JSON.stringify({items,customer}));
  const hash=await crypto.subtle.digest("SHA-256",encoded);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function getCheckoutToken(items,customer,mode){
  const fingerprint=await checkoutFingerprint(items,customer);
  const key=mode==="live"?"rainbow_razorpay_live_pending_v1":"rainbow_razorpay_pending_v1";
  try{
    const previous=JSON.parse(sessionStorage.getItem(key)||"null");
    if(previous?.fingerprint===fingerprint && /^[0-9a-f-]{36}$/i.test(previous.id))
      return previous.id;
  }catch{ /* stale session */ }
  const id=crypto.randomUUID();
  sessionStorage.setItem(key,JSON.stringify({fingerprint,id}));
  return id;
}
// Report a useful readiness reason; do not silently leave a payment option disabled.
export async function razorpayAvailability(){
  const base=getBase();
  if(!base)return {available:false,message:"Payment configuration did not load. Please refresh checkout."};
  try{
    const res=await fetch(base+"/api/razorpay/config?check="+Date.now(),{
      method:"GET",mode:"cors",cache:"no-store",
      headers:{"Accept":"application/json"}
    });
    if(!res.ok){
      return {available:false,message:"Secure checkout service is temporarily unavailable (HTTP "+res.status+"). Try again."};
    }
    const data=await res.json();
    const validMode=data.mode==="test" || data.mode==="live";
    const keyMatches=validMode && new RegExp("^rzp_"+data.mode+"_[A-Za-z0-9]+$").test(data.keyId||"");
    if(data.enabled===true && keyMatches){
      // The public Key ID format is not proof that Razorpay will accept the
      // matching server-side secret. Probe a read-only provider operation first.
      const probe=await fetch(base+"/api/razorpay/provider-check?check="+Date.now(),{
        method:"GET",mode:"cors",cache:"no-store",headers:{"Accept":"application/json"}
      });
      if(!probe.ok)return {available:false,message:"Payment provider verification is temporarily unavailable. Retry shortly."};
      const result=await probe.json();
      if(result.provider==="connected")
        return {available:true,mode:data.mode,message:data.mode==="live"
          ?"Secure Razorpay payments are ready. Your bank or UPI app will make a real charge."
          :"Razorpay test checkout is connected. No real money is deducted through Razorpay Test Mode."};
      if(result.provider==="credentials_rejected")
        return {available:false,mode:data.mode,message:"Razorpay rejected the configured payment credentials. Online checkout is paused until the shop resolves this."};
      return {available:false,mode:data.mode,message:"Razorpay could not be verified right now. Please retry later."};
    }
    return {available:false,mode:validMode?data.mode:"test",message:"Razorpay online payment is not enabled on the payment server. Manual UPI remains available."};
  }catch(error){
    console.warn("Razorpay availability request failed",error);
    return {available:false,message:"Could not connect to the secure payment service from this browser. Check your connection or retry."};
  }
}
export async function razorpayAvailable(){
  return (await razorpayAvailability()).available;
}
export async function beginRazorpayPayment({items,customer,displayTotal,expectedMode,onPaymentFailed}){
  // Refresh provider readiness at purchase time; never silently switch to real money.
  const status=await razorpayAvailability();
  if(!status.available)throw new Error(status.message);
  const mode=status.mode;
  if(mode!==expectedMode)throw new Error("Payment mode has changed. Refresh checkout and review the payment method before paying.");
  const key=mode==="live"?"rainbow_razorpay_live_pending_v1":"rainbow_razorpay_pending_v1";
  let checkout_id=await getCheckoutToken(items,customer,mode);
  let gateway;
  try{
    gateway=await api("/api/razorpay/create",{checkout_id,items,customer});
  }catch(error){
    if(error.code!=="CHECKOUT_EXPIRED")throw error;
    // Retry ONLY after the server confirms the old reservation was expired
    // and its inventory was restored. Never bypass a 'creating' reservation.
    sessionStorage.removeItem(key);
    checkout_id=await getCheckoutToken(items,customer,mode);
    gateway=await api("/api/razorpay/create",{checkout_id,items,customer});
  }
  if(!gateway.success || gateway.mode!==mode ||
    !new RegExp("^rzp_"+mode+"_[A-Za-z0-9]+$").test(gateway.keyId||"") ||
    !Number.isSafeInteger(gateway.amount) || gateway.amount<100 ||
    gateway.currency!=="INR" || !gateway.gatewayOrderId)
    throw new Error("Invalid payment provider response");
  // Never silently charge a different amount from the visible review summary.
  if(Math.abs(gateway.amount/100-displayTotal)>0.01)
    throw new Error("The verified price changed. Please reload and review your cart before paying.");
  if(new Date(gateway.expiresAt).getTime()<=Date.now())
    throw new Error("This checkout has expired. Contact the shop if payment was attempted.");
  await loadGatewayScript();
  return new Promise((resolve,reject)=>{
    let handled=false;
    try{
      const checkout=new window.Razorpay({
        key:gateway.keyId,amount:gateway.amount,currency:"INR",
        order_id:gateway.gatewayOrderId,
        name:"Rainbow Gold Covering",description:mode==="live"?"Secure jewellery purchase":"Test payment – no real money deducted",
        prefill:{name:customer.name,email:customer.email||"",contact:customer.whatsapp_number},
        theme:{color:"#8f1520"},
        handler:async response=>{
          if(handled)return;
          handled=true;
          try{
            const result=await api("/api/razorpay/verify",{
              checkout_id,razorpay_order_id:response.razorpay_order_id,
              razorpay_payment_id:response.razorpay_payment_id,
              razorpay_signature:response.razorpay_signature
            });
            if(result.paid===true){
              sessionStorage.removeItem(key);
              resolve({status:"paid",mode,orderNumber:result.orderNumber,
                invoiceUrl:result.invoiceUrl||null,invoiceNumber:result.invoiceNumber||null});
            }else{
              resolve({status:"pending",mode,orderNumber:result.orderNumber||gateway.orderNumber});
            }
          }catch(error){reject(error);}
        },
        modal:{ondismiss:()=>{if(!handled){handled=true;resolve({status:"dismissed",mode});}}}
      });
      // Failed attempts may be retried within Razorpay's own modal. Do not
      // settle, clear the cart, or create a second provider order here.
      checkout.on("payment.failed", event=>{
        if(handled)return;
        const raw=event?.error?.description;
        const note=typeof raw==="string" && raw.trim() && raw.length<=200
          ? raw.trim() : "Payment failed. Try another method or close checkout.";
        if(typeof onPaymentFailed==="function")onPaymentFailed(note);
      });
      checkout.open();
    }catch(error){reject(error);}
  });
}
