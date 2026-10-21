// Test-mode only until the audited server-side checkout is deliberately enabled.
const getBase=()=>{
  const value=String(window.RAINBOW_PAYMENT_CONFIG?.apiBaseUrl||"").replace(/\\/$/,"");
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
  if(!res.ok || data.success===false)throw new Error(data.error||"Payment service is unavailable");
  return data;
}
async function checkoutFingerprint(items,customer){
  const encoded=new TextEncoder().encode(JSON.stringify({items,customer}));
  const hash=await crypto.subtle.digest("SHA-256",encoded);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function getCheckoutToken(items,customer){
  const fingerprint=await checkoutFingerprint(items,customer);
  const key="rainbow_razorpay_pending_v1";
  try{
    const previous=JSON.parse(sessionStorage.getItem(key)||"null");
    if(previous?.fingerprint===fingerprint && /^[0-9a-f-]{36}$/i.test(previous.id))
      return previous.id;
  }catch{ /* stale session */ }
  const id=crypto.randomUUID();
  sessionStorage.setItem(key,JSON.stringify({fingerprint,id}));
  return id;
}
export async function razorpayTestAvailable(){
  const base=getBase();
  if(!base)return false;
  try{
    const res=await fetch(base+"/api/razorpay/config",{cache:"no-store"});
    if(!res.ok)return false;
    const data=await res.json();
    return data.enabled===true && data.mode==="test" && /^rzp_test_/.test(data.keyId||"");
  }catch{return false;}
}
export async function beginRazorpayTestPayment({items,customer,displayTotal}){
  const checkout_id=await getCheckoutToken(items,customer);
  const gateway=await api("/api/razorpay/create",{checkout_id,items,customer});
  if(!gateway.success || !/^rzp_test_/.test(gateway.keyId||"") ||
    !Number.isSafeInteger(gateway.amount) || gateway.amount<=0 ||
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
        name:"Rainbow Gold Covering",description:"Test payment – no real money deducted",
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
              sessionStorage.removeItem("rainbow_razorpay_pending_v1");
              resolve({status:"paid",orderNumber:result.orderNumber});
            }else{
              resolve({status:"pending",orderNumber:result.orderNumber});
            }
          }catch(error){reject(error);}
        },
        modal:{ondismiss:()=>{if(!handled){handled=true;resolve({status:"dismissed"});}}}
      });
      checkout.open();
    }catch(error){reject(error);}
  });
}
