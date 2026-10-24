// PROPOSED ONLY — /proposed-backend/ is excluded from Cloudflare Pages.
// Not wired into the live Worker. Requires isolated SQL + tests before review.
// Usage after approval: import manualUpiRoute in the Worker routing table.
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
const uuid=s=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const allowedStates=new Set([
  "andaman and nicobar islands","andhra pradesh","arunachal pradesh","assam","bihar",
  "chandigarh","chhattisgarh","dadra and nagar haveli and daman and diu","delhi",
  "goa","gujarat","haryana","himachal pradesh","jammu and kashmir","jharkhand",
  "karnataka","kerala","ladakh","lakshadweep","madhya pradesh","maharashtra",
  "manipur","meghalaya","mizoram","nagaland","odisha","puducherry","punjab",
  "rajasthan","sikkim","tamil nadu","telangana","tripura","uttar pradesh",
  "uttarakhand","west bengal"
]);
function validCustomer(c){
  if(!c||typeof c!=="object"||Array.isArray(c))return false;
  const name=String(c.name||"").trim(),address=String(c.address||"").trim();
  let mobile=String(c.whatsapp_number||"").replace(/[\s-]/g,"").replace(/^\+91/,"");
  mobile=mobile.replace(/^91(?=[6-9]\d{9}$)/,"").replace(/^0(?=[6-9]\d{9}$)/,"");
  const email=String(c.email||"").trim(),pin=String(c.pin_code||"").trim();
  return name.length>=2&&name.length<=120&&address.length>=10&&address.length<=500&&
    /^[6-9]\d{9}$/.test(mobile)&&allowedStates.has(String(c.state||"").trim().toLowerCase())&&
    (!email||(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254))&&
    (!pin||/^\d{6}$/.test(pin));
}
const itemsValid=items=>Array.isArray(items)&&items.length>0&&items.length<=50&&
  items.every(item=>item&&uuid(item.variant_id)&&Number.isInteger(item.quantity)&&
    item.quantity>=1&&item.quantity<=100)&&
  new Set(items.map(item=>item.variant_id)).size===items.length;
async function dbRpc(env,name,args){
  // Privileged DB credentials must exist only as a Worker secret.
  const res=await fetch(new URL("/rest/v1/rpc/"+name,String(env.SUPABASE_URL)),{
    method:"POST",
    headers:{"apikey":String(env.SUPABASE_SERVICE_ROLE_KEY),
      "authorization":"Bearer "+String(env.SUPABASE_SERVICE_ROLE_KEY),
      "content-type":"application/json"},
    body:JSON.stringify(args)
  });
  if(!res.ok)throw new Error("isolated_database_rpc_failed");
  return res.json();
}
export async function manualUpiRoute(request,env){
  const route=new URL(request.url).pathname;
  if(route!=="/api/upi/prepare"&&route!=="/api/upi/submit")
    return json({error:"Not found"},404);
  const origin=request.headers.get("Origin");
  const allowed=String(env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
  if(!origin||!allowed.includes(origin))return json({error:"Forbidden"},403);
  const headers={"access-control-allow-origin":origin,"vary":"Origin",
    "access-control-allow-methods":"POST, OPTIONS",
    "access-control-allow-headers":"Content-Type"};
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  const reply=(body,status)=>{const r=json(body,status);for(const [key,value]of Object.entries(headers))r.headers.set(key,value);return r;};
  if(request.method!=="POST")return reply({error:"Method not allowed"},405);
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||
    !env.CHECKOUT_RATE_LIMITER||typeof env.CHECKOUT_RATE_LIMITER.limit!=="function")
    return reply({error:"Pending payment checkout unavailable"},503);
  const length=Number(request.headers.get("Content-Length")||"0");
  if(length>14000)return reply({error:"Request too large"},413);
  const text=await request.text();
  if(text.length>14000)return reply({error:"Request too large"},413);
  let data;try{data=JSON.parse(text);}catch{return reply({error:"Invalid JSON"},400);}
  if(!data||Array.isArray(data)||typeof data!=="object"||!uuid(data.checkout_id))
    return reply({error:"Invalid checkout ID"},400);
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const limit=await env.CHECKOUT_RATE_LIMITER.limit({key:ip+":"+route});
  if(!limit.success)return reply({error:"Try again later"},429);
  try{
    if(route==="/api/upi/prepare"){
      if(!itemsValid(data.items)||!validCustomer(data.customer))
        return reply({error:"Invalid customer or items"},400);
      // This RPC must lock inventory, recompute amounts and prevent duplicate orders.
      const result=await dbRpc(env,"prepare_manual_upi_checkout",{
        p_checkout_id:data.checkout_id,p_items:data.items,p_customer:data.customer
      });
      const cols=["subtotal","discount_amount","cgst_amount","sgst_amount","delivery_fee","total_amount"];
      if(!result||result.checkout_id!==data.checkout_id||result.state!=="awaiting_payment"||
        !result.order_number||!cols.every(col=>Number.isFinite(Number(result[col]))))
        throw new Error("invalid_authoritative_quote");
      return reply(Object.fromEntries([
        ["checkout_id",result.checkout_id],["state","awaiting_payment"],
        ["order_number",result.order_number],["expires_at",result.expires_at],
        ...cols.map(col=>[col,Number(result[col])])
      ]),200);
    }
    const reference=String(data.transaction_reference||"").trim();
    if(!uuid(data.request_id)||!/^[A-Za-z0-9-]{8,64}$/.test(reference))
      return reply({error:"Invalid transaction reference"},400);
    const result=await dbRpc(env,"submit_manual_upi_reference",{
      p_checkout_id:data.checkout_id,p_request_id:data.request_id,
      p_transaction_reference:reference
    });
    if(!result||result.payment_status!=="pending"||!result.order_number)
      throw new Error("invalid_pending_receipt");
    return reply({order_number:result.order_number,payment_status:"pending"},200);
  }catch{
    // No customer/UTR/secret logging or accepting client-provided paid status.
    return reply({error:"Could not complete pending checkout. Try again safely."},503);
  }
}