window.RainbowInvoice=(()=>{
  const esc=x=>String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  const money=v=>"₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  const itemDetails=x=>{
    const d=[];
    if(x.product_type)d.push(x.product_type);
    if(x.variant_color)d.push("Color: "+x.variant_color);
    if(x.variant_size)d.push("Size: "+x.variant_size);
    if(x.length_cm!=null)d.push("Length: "+x.length_cm+" cm");
    if(x.thickness)d.push("Thickness: "+x.thickness);
    if(x.gold_amount_g!=null)d.push("Gold: "+x.gold_amount_g+" g");
    return d.join(" • ");
  };
  const render=(data,target)=>{
    const items=data.items||[];
    const rows=items.map(x=>{
      const details=itemDetails(x);
      return "<tr><td><b>"+esc(x.product_code)+"</b><div>"+esc(x.product_name)+"</div>"+(details?"<span class='detail'>"+esc(details)+"</span>":"")+"</td><td class='right'>"+Number(x.quantity)+"</td><td class='right'>"+money(x.unit_price)+"</td><td class='right'>"+money(x.line_total)+"</td></tr>";
    }).join("");
    target.innerHTML=
      "<div class='top'><div><div class='brand'>JJ GOLD COVERING</div><div class='subtitle'>GOLD COVERING JEWELLERY</div></div>"+
      "<div class='meta'><div><span class='label'>Invoice</span><br><b>"+esc(data.invoice_number)+"</b></div><div><span class='label'>Order</span><br>"+esc(data.order_number)+"</div><div>"+new Date(data.issued_at).toLocaleString("en-IN")+"</div></div></div>"+
      "<div class='customer'><span class='label'>Customer</span><br><b>"+esc(data.customer_name||"Walk-in Customer")+"</b>"+(data.customer_phone?"<div>"+esc(data.customer_phone)+"</div>":"")+"</div>"+
      "<div class='items'><table><thead><tr><th>Product</th><th class='right'>Qty</th><th class='right'>Rate</th><th class='right'>Amount</th></tr></thead><tbody>"+rows+"</tbody></table></div>"+
      "<div class='totals'>"+
      "<div class='line'><span>Subtotal</span><b>"+money(data.subtotal)+"</b></div>"+
      "<div class='line'><span>Discount</span><b>"+money(data.discount_amount)+"</b></div>"+
      "<div class='line'><span>CGST</span><b>"+money(data.cgst_amount)+"</b></div>"+
      "<div class='line'><span>SGST</span><b>"+money(data.sgst_amount)+"</b></div>"+
      (Number(data.delivery_fee||0)>0?"<div class='line'><span>Delivery</span><b>"+money(data.delivery_fee)+"</b></div>":"")+
      "<div class='line grand'><span>Total</span><b>"+money(data.total_amount)+"</b></div></div>"+
      "<div style='margin-top:12px;font-size:11px'><b>Payment:</b> "+esc(String(data.payment_method||"").replaceAll("_"," "))+"</div>"+
      "<div class='footer'>Thank you for shopping with JJ GOLD COVERING.</div>";
    return target;
  };
  return {render,esc,money,itemDetails};
})();