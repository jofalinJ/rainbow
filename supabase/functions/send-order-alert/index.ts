import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});

function normalize(input:string){const d=String(input||"").replace(/\D/g,"");if(d.length===10)return "91"+d;if(d.length>=8&&d.length<=15)return d;return "";}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const auth=req.headers.get("Authorization");
    if(!auth)return json({error:"Unauthorized"},401);
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!serviceKey)return json({error:"Server configuration missing."},500);
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,serviceKey);
    const token=auth.replace(/^Bearer\s+/i,"");
    const {data:{user},error:ae}=await admin.auth.getUser(token);
    if(ae||!user)return json({error:"Unauthorized"},401);
    const {data:profile,error:pe}=await admin.from("staff_profiles").select("role,active").eq("user_id",user.id).maybeSingle();
    if(pe)return json({error:"Could not verify staff access."},500);
    if(!profile?.active||!["admin","cashier"].includes(profile.role))return json({error:"Orders access required."},403);

    const body=await req.json().catch(()=>({}));
    const orderId=String(body.order_id||"").trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId))return json({error:"Invalid order id."},400);

    const {data:order,error:oe}=await admin.from("orders").select("id,order_number,status,payment_status,subtotal,discount_amount,cgst_amount,sgst_amount,delivery_fee,total_amount,shipping_address,created_at,customers(name,whatsapp_number,email,city,state,pin_code)").eq("id",orderId).maybeSingle();
    if(oe)return json({error:"Could not load order."},500);
    if(!order)return json({error:"Order not found."},404);
    if(order.payment_status!=="paid")return json({error:"Payment has not been verified. Verify it in admin before sending order details."},409);

    const {data:previousAlerts,error:alertError}=await admin.from("whatsapp_notifications").select("id").eq("order_id",orderId).eq("status","sent").limit(1);
    if(alertError)return json({error:"Could not check previous order alerts."},500);
    const shop=normalize("9952436899");
    if(previousAlerts?.length)return json({success:true,already_sent:true,recipient_number:shop,order_number:order.order_number});

    const {data:items,error:ie}=await admin.from("order_items").select("product_code,product_name,quantity,unit_price,line_total,variant_color,variant_size").eq("order_id",orderId).order("created_at");
    if(ie)return json({error:"Could not load order items."},500);

    const customer=Array.isArray(order.customers)?order.customers[0]:order.customers;
    const access=Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneId=Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const version=Deno.env.get("WHATSAPP_GRAPH_VERSION")||"v23.0";
    if(!access||!phoneId)return json({error:"WhatsApp Business API is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to Supabase secrets."},503);

    const address=[order.shipping_address,customer?.city,customer?.state,customer?.pin_code].filter(Boolean).join(", ");
    const map="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(address);
    const itemText=(items||[]).map((x:any)=>`• ${x.product_code} — ${x.product_name} × ${x.quantity} = ₹${Number(x.line_total||0).toLocaleString("en-IN")}`).join("\n");
    const message=`🛍️ NEW ONLINE ORDER — RAINBOW KOLLAM GOLD COVERING

Order: ${order.order_number}
Customer: ${customer?.name||"—"}
WhatsApp: ${customer?.whatsapp_number||"—"}
Order amount (delivery fee to confirm): ₹${Number(order.total_amount||0).toLocaleString("en-IN")}
Delivery fee: To confirm separately
Payment: Verified

ITEMS
${itemText||"—"}

DELIVERY
${address||"—"}
Map: ${map}`;

    const graph="https://graph.facebook.com/"+version;
    const response=await fetch(graph+"/"+encodeURIComponent(phoneId)+"/messages",{method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:shop,type:"text",text:{preview_url:true,body:message}})});
    const result=await response.json().catch(()=>({}));
    const status=response.ok?"sent":"failed";
    await admin.from("whatsapp_notifications").insert({order_id:orderId,recipient_number:shop,notification_type:"new_order_alert",message_template:message,status,provider_message_id:result?.messages?.[0]?.id||null,error_message:response.ok?null:JSON.stringify(result).slice(0,1000)});
    if(!response.ok)return json({error:"WhatsApp message could not be sent."},502);
    return json({success:true,recipient_number:shop,order_number:order.order_number});
  }catch(e){return json({error:e instanceof Error?e.message:"Could not send order alert."},500);}
});