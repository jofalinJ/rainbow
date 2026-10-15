export const COURIER_NAME="The Professional Couriers";
export const TRACKING_URL="https://www.tpcindia.com/default.aspx";
export const SHIPMENT_STATES=["packed","shipped","in_transit","out_for_delivery","delivered","exception"];
export function normalizeIndianPhone(input){
  const source=String(input??"").trim();
  if(!source||/[^+\d\s().-]/.test(source)||((source.match(/\+/g)||[]).length>1)||(/\+/.test(source)&&!source.startsWith("+")))return null;
  const digits=source.replace(/\D/g,"");
  const local=digits.length===10?digits:digits.length===11&&digits[0]==="0"?digits.slice(1):digits.length===12&&digits.startsWith("91")?digits.slice(2):null;
  return local&&/^[6-9]\d{9}$/.test(local)?"91"+local:null;
}
export function dateForMessage(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value??"")))return "";
  const [y,m,d]=value.split("-").map(Number);
  const date=new Date(Date.UTC(y,m-1,d,12));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d
    ?new Intl.DateTimeFormat("en-IN",{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}).format(date)
    :"";
}
export function trackingStatus(value){
  const states={packed:"Packed",shipped:"Shipped",in_transit:"In transit",out_for_delivery:"Out for delivery",delivered:"Delivered",exception:"Delivery issue"};
  return states[String(value||"")]||"Not dispatched";
}
export function formatShipmentMessage(order,shipment){
  const name=String(order?.customers?.name||order?.customer_name||"Customer").trim();
  const id=String(order?.order_number||"").trim();
  const awb=String(shipment?.consignment_number||"").trim();
  const date=dateForMessage(shipment?.dispatch_date);
  if(!id||!awb||!date||!name)throw new Error("Order number, customer, AWB and shipment date are required.");
  return [
    "Hello "+name+" 👋","",
    "Thank you for shopping with Rainbow Gold Covering! ✨","",
    "Your order has been shipped successfully.","",
    "📦 Order ID: "+id,"",
    "🚚 Courier: "+COURIER_NAME,"",
    "🔢 Consignment Number: "+awb,"",
    "📅 Shipped On: "+date,"",
    "Track your shipment here:",TRACKING_URL,"",
    "Enter your consignment number on the courier website to check the latest delivery status.","",
    "Thank you for choosing Rainbow Gold Covering! ❤️"
  ].join("\n");
}
export function whatsappTrackingUrl(number,message){
  const normalized=normalizeIndianPhone(number);
  if(!normalized||!String(message??"").trim())return null;
  return "https://wa.me/"+normalized+"?text="+encodeURIComponent(message);
}
export function canNotifyShipment(shipment,phone,alreadyConfirmed=false){
  return !alreadyConfirmed&&!!normalizeIndianPhone(phone)&&!!shipment?.consignment_number&&
    !!dateForMessage(shipment.dispatch_date)&&
    ["shipped","in_transit","out_for_delivery","delivered"].includes(shipment.status);
}
export function shipmentTimeline(orderStatus,shipmentStatus){
  const order=String(orderStatus||"").toLowerCase(),shipment=String(shipmentStatus||"").toLowerCase();
  const steps=["Order Placed","Confirmed","Packed","Shipped","Delivered"];
  if(["cancelled","refunded"].includes(order))return {steps:steps.map((label,i)=>({label,state:i===0?"done":"pending"})),notice:"Order "+order};
  let level=0;
  if(["confirmed","processing","shipped","delivered"].includes(order))level=1;
  if(order==="processing")level=2;
  if(order==="shipped")level=3;
  if(order==="delivered")level=4;
  if(shipment==="packed")level=Math.max(level,2);
  if(["shipped","in_transit","out_for_delivery","exception"].includes(shipment))level=Math.max(level,3);
  if(shipment==="delivered")level=4;
  return {steps:steps.map((label,i)=>({label,state:i<level?"done":i===level?"current":"pending"})),notice:shipment==="exception"?"Courier issue reported by store":""};
}
