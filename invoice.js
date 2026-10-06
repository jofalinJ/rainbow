const $inv=id=>document.getElementById(id);
function escInv(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));}
function moneyInv(v){return "₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
function digitsInv(x){return String(x??"").replace(/\D/g,"");}
function waNumberInv(phone){const d=digitsInv(phone);if(d.length===10)return "91"+d;if(d.length===12&&d.startsWith("91"))return d;return d;}
function getToken(){return new URLSearchParams(location.search).get("token");}
function itemDetails(x){
  const d=[];
  if(x.product_type)d.push(x.product_type);
  if(x.variant_color)d.push("Color: "+x.variant_color);
  if(x.variant_size)d.push("Size: "+x.variant_size);
  if(x.length_cm!=null)d.push("Length: "+x.length_cm+" cm");
  if(x.thickness)d.push("Thickness: "+x.thickness);
  if(x.gold_amount_g!=null)d.push("Gold: "+x.gold_amount_g+" g");
  return d.join(" • ");
}
function renderInvoice(data){
  const items=data.items||[];
  const rows=items.map(x=>"<tr><td><b>"+escInv(x.product_code)+"</b><div>"+escInv(x.product_name)+"</div>"+(itemDetails(x)?"<span class='detail'>"+escInv(itemDetails(x))+"</span>":"")+"</td><td class='right'>"+Number(x.quantity)+"</td><td class='right'>"+moneyInv(x.unit_price)+"</td><td class='right'>"+moneyInv(x.line_total)+"</td></tr>").join("");
  $inv("invoice").innerHTML=
    "<div class='top'><div><div class='brand'>JJ GOLD COVERING</div><div class='subtitle'>GOLD COVERING JEWELLERY</div></div>"+
    "<div class='meta'><div><span class='label'>Invoice</span><br><b>"+escInv(data.invoice_number)+"</b></div><div><span class='label'>Order</span><br>"+escInv(data.order_number)+"</div><div>"+new Date(data.issued_at).toLocaleString("en-IN")+"</div></div></div>"+
    "<div class='customer'><span class='label'>Customer</span><br><b>"+escInv(data.customer_name||"Walk-in Customer")+"</b></div>"+
    "<div class='items'><table><thead><tr><th>Product</th><th class='right'>Qty</th><th class='right'>Rate</th><th class='right'>Amount</th></tr></thead><tbody>"+rows+"</tbody></table></div>"+
    "<div class='totals'>"+
      "<div class='line'><span>Subtotal</span><b>"+moneyInv(data.subtotal)+"</b></div>"+
      "<div class='line'><span>Discount</span><b>"+moneyInv(data.discount_amount)+"</b></div>"+
      "<div class='line'><span>CGST</span><b>"+moneyInv(data.cgst_amount)+"</b></div>"+
      "<div class='line'><span>SGST</span><b>"+moneyInv(data.sgst_amount)+"</b></div>"+
      (Number(data.delivery_fee||0)>0?"<div class='line'><span>Delivery</span><b>"+moneyInv(data.delivery_fee)+"</b></div>":"")+
      "<div class='line grand'><span>Total</span><b>"+moneyInv(data.total_amount)+"</b></div>"+
    "</div>"+
    "<div style='margin-top:12px;font-size:11px'><b>Payment:</b> "+escInv(String(data.payment_method||"").replaceAll("_"," "))+"</div>"+
    "<div class='footer'>Thank you for shopping with JJ GOLD COVERING.</div>";
}
async function loadInvoice(){
  const token=getToken();
  if(!token){$inv("invoice").innerHTML="<div class='error'>Missing bill link.</div>";return;}
  try{
    const cfg=window.RAINBOW_CONFIG||{};
    const sbp=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
    const {data,error}=await sbp.rpc("get_public_invoice",{p_token:token});
    if(error)throw error;
    if(!data){$inv("invoice").innerHTML="<div class='error'>Bill not found or no longer available.</div>";return;}
    renderInvoice(data);
    $inv("printBtn").onclick=()=>window.print();
    const phone=data.customer_phone||"";
    if(phone){
      $inv("waBtn").style.display="inline-block";
      $inv("waBtn").onclick=()=>window.open("https://wa.me/"+waNumberInv(phone)+"?text="+encodeURIComponent("JJ GOLD COVERING bill "+data.invoice_number+" — "+moneyInv(data.total_amount)),"_blank","noopener,noreferrer");
    }
    if(new URLSearchParams(location.search).get("print")==="1")setTimeout(()=>window.print(),350);
  }catch(e){
    console.error(e);
    $inv("invoice").innerHTML="<div class='error'>Could not load bill. Please use the billing system again.</div>";
  }
}
loadInvoice();
