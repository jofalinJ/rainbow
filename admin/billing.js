const $b=id=>document.getElementById(id);
let catalog=[];
const cart=new Map();
const TAX_RATE=.015;
const DISCOUNT_RATE=.03;
let lastReceipt=null;

function escB(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;" ,'"':"&quot;"}[m]));}
function moneyB(v){return "₹"+Number(v||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});}
function variantLabel(v){
  const parts=[];
  if(v.color&&v.color!=="0")parts.push("Color: "+v.color);
  if(v.size&&v.size!=="0")parts.push("Size: "+v.size);
  return parts.length?parts.join(" • "):"Standard";
}
function productImage(p){
  const images=p.product_images||[];
  const primary=images.find(x=>x.is_primary)||images[0];
  return primary?.public_url||"";
}
function refreshTotals(){
  let subtotal=0;
  for(const line of cart.values())subtotal+=Number(line.price)*line.quantity;
  subtotal=Math.round(subtotal*100)/100;
  const discount=Math.round(subtotal*DISCOUNT_RATE*100)/100;
  const taxable=Math.round((subtotal-discount)*100)/100;
  const cgst=Math.round(taxable*TAX_RATE*100)/100;
  const sgst=Math.round(taxable*TAX_RATE*100)/100;
  const total=Math.round((taxable+cgst+sgst)*100)/100;
  $b("subtotal").textContent=moneyB(subtotal);
  $b("discount").textContent=moneyB(discount);
  $b("cgst").textContent=moneyB(cgst);
  $b("sgst").textContent=moneyB(sgst);
  $b("total").textContent=moneyB(total);
  $b("completeSale").disabled=cart.size===0;
  return{subtotal,discount,cgst,sgst,total};
}
function renderCatalog(){
  const q=($b("productSearch").value||"").trim().toLowerCase();
  const rows=[];
  for(const p of catalog){
    const variants=p.product_variants||[];
    for(const v of variants){
      const hay=[p.product_name,p.product_code,p.type,p.description,v.barcode,v.color,v.size].map(x=>String(x??"").toLowerCase());
      if(q&&!hay.some(x=>x.includes(q)))continue;
      if(!v.active||Number(v.stock_quantity||0)<=0)continue;
      rows.push({p,v});
    }
  }
  $b("catalog").innerHTML=rows.slice(0,120).map(({p,v})=>{
    const img=productImage(p);
    return '<article class="product-card">'+
      (img?'<img class="product-thumb" src="'+escB(img)+'" alt="">':'<div class="product-thumb" aria-hidden="true"></div>')+
      '<div class="product-main"><b>'+escB(p.product_name)+'</b><small>'+escB(p.product_code)+' • '+escB(p.type||"")+' • '+moneyB(p.selling_price)+'</small>'+
      '<div class="variant-line"><span class="variant-chip">'+escB(variantLabel(v))+'</span><span class="variant-chip">'+Number(v.stock_quantity||0)+' in stock</span><span class="variant-chip">'+escB(v.barcode)+'</span></div></div>'+
      '<div class="variant-actions"><button type="button" data-add-variant="'+v.id+'">Add</button></div></article>';
  }).join("")||'<div class="empty">No available products found.</div>';
  document.querySelectorAll("[data-add-variant]").forEach(btn=>btn.addEventListener("click",()=>addToCart(btn.dataset.addVariant)));
}
function addToCart(variantId){
  const record=findVariant(variantId);
  if(!record)return;
  const existing=cart.get(variantId);
  const current=existing?.quantity||0;
  const stock=Number(record.v.stock_quantity||0);
  if(current>=stock){setMsg("Only "+stock+" unit(s) available for "+record.p.product_code,"error");return;}
  cart.set(variantId,{variantId,p:record.p,v:record.v,quantity:current+1,price:Number(record.p.selling_price)});
  renderCart();
}
function findVariant(variantId){
  for(const p of catalog){
    const v=(p.product_variants||[]).find(x=>x.id===variantId);
    if(v)return{p,v};
  }
  return null;
}
function renderCart(){
  $b("cart").innerHTML=[...cart.values()].map(line=>{
    const max=Number(line.v.stock_quantity||0);
    return '<div class="cart-row"><div class="cart-top"><b>'+escB(line.p.product_name)+'</b><span>'+moneyB(line.price*line.quantity)+'</span></div>'+
      '<div class="cart-meta">'+escB(line.p.product_code)+' • '+escB(variantLabel(line.v))+'</div>'+
      '<div class="qty-row"><div class="qty-control"><button type="button" data-dec="'+line.variantId+'">−</button><span>'+line.quantity+'</span><button type="button" data-inc="'+line.variantId+'">＋</button></div><button type="button" data-remove="'+line.variantId+'">Remove</button></div></div>';
  }).join("")||'<div class="empty">No items added.</div>';
  document.querySelectorAll("[data-inc]").forEach(btn=>btn.addEventListener("click",()=>changeQty(btn.dataset.inc,1)));
  document.querySelectorAll("[data-dec]").forEach(btn=>btn.addEventListener("click",()=>changeQty(btn.dataset.dec,-1)));
  document.querySelectorAll("[data-remove]").forEach(btn=>btn.addEventListener("click",()=>{cart.delete(btn.dataset.remove);renderCart();}));
  refreshTotals();
}
function changeQty(id,delta){
  const line=cart.get(id);if(!line)return;
  const next=line.quantity+delta;
  if(next<=0){cart.delete(id);}
  else if(next<=Number(line.v.stock_quantity||0)){line.quantity=next;}
  else{setMsg("Quantity cannot exceed current stock.","error");}
  renderCart();
}
function publicInvoiceUrl(token,print=false){
  return new URL("../invoice.html?token="+encodeURIComponent(token)+(print?"&print=1":""),location.href).href;
}
function whatsappNumberB(phone){
  const d=String(phone??"").replace(/\D/g,"");
  if(d.length===10)return "91"+d;
  if(d.length===12&&d.startsWith("91"))return d;
  return d;
}
function openBill(token,print=false){
  if(!token)return;
  window.open(publicInvoiceUrl(token,print),"_blank","noopener,noreferrer");
}
async function sendBillWhatsAppPdf(data,items,phone,customerName){
  const number=String(phone??"").replace(/\D/g,"");
  if(!number){setMsg("Add a customer WhatsApp number before sending the bill.","error");return;}
  try{
    setMsg("Generating bill PDF…");
    const payload={...data,customer_name:customerName||data.customer_name,customer_phone:phone,items:items||[]};
    const pdf=await RainbowBillPdf.fromData(payload,$b("receiptPdfStage"));
    const pdfBase64=RainbowBillPdf.bufferToBase64(pdf.output("arraybuffer"));
    const session=await requireSession();
    const response=await fetch(SUPABASE_URL+"/functions/v1/send-whatsapp-bill",{
      method:"POST",
      headers:{apikey:SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
      body:JSON.stringify({invoice_token:data.public_token,pdf_base64:pdfBase64,filename:"JJ-GOLD-COVERING-"+data.invoice_number+".pdf"})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"WhatsApp bill could not be sent.");
    setMsg("WhatsApp PDF sent for "+data.invoice_number,"success");
  }catch(e){
    console.error(e);
    setMsg(e.message||"Could not send WhatsApp PDF.","error");
  }
}

function setMsg(message,tone=""){
  const el=$b("billingMsg");el.textContent=message;el.className="billing-msg "+tone;
}
async function loadCatalog(){
  catalog=await sb("products?select=id,product_code,product_name,type,description,selling_price,product_images(public_url,is_primary),product_variants(id,color,size,stock_quantity,barcode,active)&active=eq.true&order=created_at.desc&limit=1000");
  renderCatalog();
}
async function completeSale(){
  if(cart.size===0)return;
  const payment=document.querySelector("input[name=payment]:checked")?.value||"cash";
  const items=[...cart.values()].map(x=>({variant_id:x.variantId,quantity:x.quantity}));
  const customerPhone=$b("customerPhone").value.trim();
  const customerName=$b("customerName").value.trim();
  const customer={
    name:$b("customerName").value.trim(),
    whatsapp_number:$b("customerPhone").value.trim(),
    email:$b("customerEmail").value.trim(),
    pin_code:$b("customerPin").value.trim(),
    city:$b("customerCity").value.trim(),
    state:$b("customerState").value.trim(),
    address:$b("customerAddress").value.trim()
  };
  const snapshot=[...cart.values()].map(x=>({...x}));
  setMsg("Processing secure sale…");
  $b("completeSale").disabled=true;
  try{
    const {data,error}=await bootSupabase().rpc("create_local_sale",{p_items:items,p_customer:customer,p_payment_method:payment});
    if(error)throw error;
    const savedItems=await sb("order_items?select=product_code,product_name,product_type,variant_color,variant_size,length_cm,thickness,gold_amount_g,quantity,unit_price,discount_amount,line_total&order_id=eq."+encodeURIComponent(data.order_id));
    showReceipt(data,savedItems||snapshot.map(x=>({product_code:x.p.product_code,product_name:x.p.product_name,quantity:x.quantity,unit_price:x.price,discount_amount:0,line_total:x.price*x.quantity})),customerPhone,customerName);
    cart.clear();
    renderCart();
    clearCustomer();
    await loadCatalog();
    setMsg("Sale completed: "+data.invoice_number,"success");
  }catch(e){
    console.error(e);
    setMsg(e.message||"Could not complete sale.","error");
  }finally{
    $b("completeSale").disabled=cart.size===0;
  }
}
function showReceipt(data,items,customerPhone="",customerName=""){
  lastReceipt={data,customerPhone,customerName};
  $b("receiptScreen").style.display="block";
  $b("receiptMeta").textContent=data.invoice_number+" • Order "+data.order_number+" • "+new Date().toLocaleString("en-IN");
  $b("receiptItems").innerHTML=(items||[]).map(x=>'<div class="receipt-item"><span>'+escB(x.product_code)+' • '+escB(x.product_name)+' × '+Number(x.quantity)+'</span><strong>'+moneyB(x.line_total)+'</strong></div>').join("");
  $b("receiptSubtotal").textContent=moneyB(data.subtotal);
  $b("receiptDiscount").textContent=moneyB(data.discount_amount);
  $b("receiptCgst").textContent=moneyB(data.cgst_amount);
  $b("receiptSgst").textContent=moneyB(data.sgst_amount);
  $b("receiptTotal").textContent=moneyB(data.total_amount);
  $b("receiptPayment").textContent=String(data.payment_method||"").replace("_"," ");
  $b("viewReceipt").onclick=()=>openBill(data.public_token,false);
  $b("printReceipt").onclick=()=>openBill(data.public_token,true);
  const wa=$b("receiptWhatsApp");
  if(whatsappNumberB(customerPhone)){
    wa.style.display="inline-block";
    wa.onclick=()=>sendBillWhatsAppPdf(data,items,customerPhone,customerName);
  }else{
    wa.style.display="none";
    wa.onclick=null;
  }
  $b("receiptScreen").scrollIntoView({behavior:"smooth",block:"start"});
}
function clearCustomer(){
  ["customerName","customerPhone","customerEmail","customerPin","customerCity","customerState","customerAddress"].forEach(id=>$b(id).value="");
}
$b("productSearch").addEventListener("input",renderCatalog);
$b("productSearch").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const exact=catalog.flatMap(p=>(p.product_variants||[]).map(v=>({p,v}))).find(x=>x.v.active&&x.v.barcode&&x.v.barcode.toLowerCase()===e.currentTarget.value.trim().toLowerCase());if(exact)addToCart(exact.v.id);}});
$b("clearSearch").addEventListener("click",()=>{$b("productSearch").value="";renderCatalog();$b("productSearch").focus();});
$b("clearCart").addEventListener("click",()=>{cart.clear();renderCart();});
$b("completeSale").addEventListener("click",completeSale);
$b("newSale").addEventListener("click",()=>{$b("receiptScreen").style.display="none";$b("productSearch").focus();});
renderCart();
requireSession().then(loadCatalog).catch(e=>setMsg(e.message||"Could not load billing.","error"));
