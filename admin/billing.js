const $b=id=>document.getElementById(id);
let catalog=[];
const cart=new Map();
const TAX_RATE=.015;
const DISCOUNT_RATE=.03;
const ERP_BILLING=window.RAINBOW_MULTI_SHOP_ENABLED===true;
let billingLocationId="";
let currentPosRequest=null;
let saleInProgress=false;
let catalogRevision=0;
let catalogLoading=false;
let cartNotice=false;


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
  let itemCount=0;
  for(const line of cart.values()){
    subtotal+=Number(line.price)*line.quantity;
    itemCount+=line.quantity;
  }
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
  $b("billItemCount").textContent="("+itemCount+")";
  $b("clearCart").disabled=saleInProgress||cart.size===0;
  $b("completeSale").disabled=saleInProgress||cart.size===0;
  return{subtotal,discount,cgst,sgst,total};
}
function renderCatalog(){
  if(catalogLoading){
    $b("catalog").innerHTML='<div class="empty">Loading shop products…</div>';
    return;
  }
  if(ERP_BILLING&&!billingLocationId){
    $b("catalog").innerHTML='<div class="empty">Select a billing shop to see its products.</div>';
    return;
  }
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
      '<div class="variant-actions"><button type="button" data-add-variant="'+escB(v.id)+'" aria-label="Add '+escB(p.product_name)+'">Add</button></div></article>';
  }).join("")||'<div class="empty">No available products found.</div>';
  document.querySelectorAll("[data-add-variant]").forEach(btn=>{
    btn.disabled=saleInProgress;
    btn.addEventListener("click",()=>addToCart(btn.dataset.addVariant));
  });
}
function addToCart(variantId){
  if(saleInProgress)return false;
  const record=findVariant(variantId);
  if(!record)return false;
  const existing=cart.get(variantId);
  const current=existing?.quantity||0;
  const stock=Number(record.v.stock_quantity||0);
  if(current>=stock){setMsg("Only "+stock+" unit(s) available for "+record.p.product_code,"error",true);return false;}
  cart.set(variantId,{variantId,p:record.p,v:record.v,quantity:current+1,price:Number(record.p.selling_price)});
  clearCartNotice();
  renderCart();
  return true;
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
    const name=escB(line.p.product_name);
    const id=escB(line.variantId);
    return '<div class="cart-row"><div class="cart-top"><b>'+escB(line.p.product_name)+'</b><span>'+moneyB(line.price*line.quantity)+'</span></div>'+
      '<div class="cart-meta">'+escB(line.p.product_code)+' • '+escB(variantLabel(line.v))+'</div>'+
      '<div class="qty-row"><div class="qty-control"><button type="button" aria-label="Decrease quantity of '+name+'" data-dec="'+id+'">−</button><span>'+line.quantity+'</span><button type="button" aria-label="Increase quantity of '+name+'" data-inc="'+id+'">＋</button></div><button type="button" aria-label="Remove '+name+'" data-remove="'+id+'">Remove</button></div></div>';
  }).join("")||'<div class="empty">No items added.</div>';
  document.querySelectorAll("[data-inc]").forEach(btn=>btn.addEventListener("click",()=>changeQty(btn.dataset.inc,1)));
  document.querySelectorAll("[data-dec]").forEach(btn=>btn.addEventListener("click",()=>changeQty(btn.dataset.dec,-1)));
  document.querySelectorAll("[data-remove]").forEach(btn=>btn.addEventListener("click",()=>{
    if(saleInProgress)return;
    cart.delete(btn.dataset.remove);clearCartNotice();renderCart();
  }));
  refreshTotals();
}
function changeQty(id,delta){
  if(saleInProgress)return;
  const line=cart.get(id);if(!line)return;
  const next=line.quantity+delta;
  if(next>Number(line.v.stock_quantity||0)){
    setMsg("Quantity cannot exceed current stock.","error",true);
    return;
  }
  if(next<=0){cart.delete(id);}
  else{line.quantity=next;}
  clearCartNotice();
  renderCart();
  [...$b("cart").querySelectorAll(delta>0?"[data-inc]":"[data-dec]")]
    .find(button=>button.dataset[delta>0?"inc":"dec"]===id)?.focus();
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
      body:JSON.stringify({invoice_token:data.public_token,pdf_base64:pdfBase64,filename:"RAINBOW-GOLD-COVERING-"+data.invoice_number+".pdf"})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"WhatsApp bill could not be sent.");
    setMsg("WhatsApp PDF sent for "+data.invoice_number,"success");
  }catch(e){
    console.error(e);
    setMsg(e.message||"Could not send WhatsApp PDF.","error");
  }
}

function setMsg(message,tone="",fromCart=false){
  const el=$b("billingMsg");el.textContent=message;el.className="billing-msg "+tone;
  cartNotice=fromCart;
}
function clearCartNotice(){
  if(cartNotice)setMsg("");
}
function setSaleInProgress(active){
  saleInProgress=active;
  document.querySelectorAll("#erpBillingLocation,#cart button,#catalog button,.customer-form :is(input,select,textarea),input[name=payment]")
    .forEach(control=>{control.disabled=active;});
  refreshTotals();
}
async function loadCatalog(){
  const revision=++catalogRevision;
  const locationId=billingLocationId;
  catalog=[];
  catalogLoading=!ERP_BILLING||Boolean(locationId);
  renderCatalog();
  if(!catalogLoading)return true;
  try{
    const nextCatalog=await sb("products?select=id,product_code,product_name,type,description,selling_price,product_images(public_url,is_primary),product_variants(id,color,size,stock_quantity,barcode,active)&active=eq.true&order=created_at.desc&limit=1000");
    if(revision!==catalogRevision)return false;
    if(ERP_BILLING){
      const balances=new Map();
      const client=bootSupabase();
      for(let page=0;page<100;page++){
        const {data,error}=await client.from("erp_stock_balances")
          .select("variant_id,on_hand,reserved").eq("location_id",locationId)
          .range(page*500,page*500+499);
        if(revision!==catalogRevision)return false;
        if(error)throw error;
        for(const row of data||[])balances.set(row.variant_id,Math.max(0,row.on_hand-row.reserved));
        if((data||[]).length<500)break;
        if(page===99)throw new Error("Inventory result too large; contact administrator.");
      }
      for(const product of nextCatalog)for(const variant of product.product_variants||[]){
        variant.stock_quantity=balances.get(variant.id)||0;
      }
    }
    catalog=nextCatalog;
    return true;
  }catch(error){
    if(revision!==catalogRevision)return false;
    throw error;
  }finally{
    if(revision===catalogRevision){
      catalogLoading=false;
      renderCatalog();
    }
  }
}
async function loadBillingShops(){
  if(!ERP_BILLING)return;
  const select=$b("erpBillingLocation"),box=$b("erpBillingLocationBox");
  box.hidden=false;
  const {data,error}=await bootSupabase().from("erp_locations")
    .select("id,name,kind").eq("kind","branch").eq("active",true).order("name");
  if(error)throw error;
  select.replaceChildren(new Option("Select your shop",""));
  for(const shop of data||[])select.add(new Option(shop.name,shop.id));
  if(data?.length===1){select.value=data[0].id;billingLocationId=data[0].id;}
  select.addEventListener("change",async()=>{
    if(cart.size>0&&!confirm("Switch shop? Your current billing cart will be cleared.")){
      select.value=billingLocationId;return;
    }
    cart.clear();currentPosRequest=null;billingLocationId=select.value;
    renderCart();
    setMsg("");
    try{await loadCatalog();}
    catch(e){setMsg(e.message||"Could not load shop stock.","error");}
  });
  if(!data?.length)setMsg("No billing shop assigned. Ask admin to assign your location.","error");
}

async function completeSale(){
  if(saleInProgress||cart.size===0)return;
  if(ERP_BILLING&&!billingLocationId){setMsg("Select a billing shop before creating an invoice.","error");return;}
  const payment=document.querySelector("input[name=payment]:checked")?.value||"cash";
  const items=[...cart.values()].map(x=>({variant_id:x.variantId,quantity:x.quantity}));
  const customerPhone=$b("customerPhone").value.trim();
  const customerName=$b("customerName").value.trim();
  const customer={
    name:customerName,
    whatsapp_number:customerPhone,
    email:$b("customerEmail").value.trim(),
    pin_code:$b("customerPin").value.trim(),
    city:$b("customerCity").value.trim(),
    state:$b("customerState").value.trim(),
    address:$b("customerAddress").value.trim()
  };
  const snapshot=[...cart.values()].map(x=>({...x}));
  if(!$b("customerEmail").validity.valid){
    $b("billingCustomer").open=true;
    $b("customerEmail").reportValidity();
    return;
  }
  if(!customerName&&!customerPhone&&Object.values(customer).some(Boolean))customer.name="Walk-in Customer";
  setMsg("Saving sale…");
  setSaleInProgress(true);
  try{
    if(ERP_BILLING&&!currentPosRequest)currentPosRequest=crypto.randomUUID();
    const {data,error}=ERP_BILLING
      ? await bootSupabase().rpc("erp_create_local_sale",{
          p_items:items,p_customer:customer,p_payment_method:payment,
          p_location:billingLocationId,p_request:currentPosRequest
        })
      : await bootSupabase().rpc("create_local_sale",{
          p_items:items,p_customer:customer,p_payment_method:payment
        });
    if(error){
      // A PostgreSQL rejection rolls the sale back. Preserve the ID on an
      // uncertain network result so retrying the same draft stays idempotent.
      if(/^[0-9A-Z]{5}$/.test(error.code||"")&&!error.message?.includes("Sale request ID reused"))currentPosRequest=null;
      throw error;
    }
    cart.clear();
    currentPosRequest=null;
    renderCart();
    clearCustomer();
    $b("billingCustomer").open=false;
    let savedItems;
    try{
      savedItems=await sb("order_items?select=product_code,product_name,product_type,variant_color,variant_size,length_cm,thickness,gold_amount_g,quantity,unit_price,discount_amount,line_total&order_id=eq."+encodeURIComponent(data.order_id));
    }catch(error){console.warn("Receipt items could not be refreshed",error);}
    showReceipt(data,savedItems?.length?savedItems:snapshot.map(x=>({product_code:x.p.product_code,product_name:x.p.product_name,quantity:x.quantity,unit_price:x.price,discount_amount:0,line_total:x.price*x.quantity})),customerPhone,customerName);
    const completed="Sale completed: "+data.invoice_number;
    setMsg(completed,"success");
    try{await loadCatalog();}
    catch(error){
      console.warn("Shop stock could not be refreshed",error);
      setMsg(completed+". Reload Billing to refresh shop stock.","success");
    }
  }catch(e){
    console.error(e);
    setMsg(e.message||"Could not complete sale.","error");
  }finally{
    setSaleInProgress(false);
  }
}
function showReceipt(data,items,customerPhone="",customerName=""){
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
  // Clear the optional postal lookup hint and locality choices after a sale.
  $b("customerPin").dispatchEvent(new Event("input",{bubbles:true}));
}
$b("productSearch").addEventListener("input",renderCatalog);
// A USB/Bluetooth scanner usually types the code then sends Enter. Match
// barcode/QR/SKU against the loaded shop stock before adding anything.
window.RainbowBillingPos={
 products:()=>catalog,
 addVariant:addToCart,
 search:code=>{$b("productSearch").value=code;renderCatalog();},
 shop:()=>({id:billingLocationId,name:$b("erpBillingLocation")?.selectedOptions?.[0]?.textContent||""})
};
$b("productSearch").addEventListener("keydown",e=>{
 if(e.key!=="Enter")return;
 e.preventDefault();
 window.RainbowBillingScanner?.processCode(e.currentTarget.value);
});
$b("clearSearch").addEventListener("click",()=>{
  $b("productSearch").value="";
  if($b("scannerPanel").hidden)$b("scannerMessage").textContent="";
  renderCatalog();
  $b("productSearch").focus();
});
$b("clearCart").addEventListener("click",()=>{
  if(saleInProgress)return;
  cart.clear();clearCartNotice();renderCart();
  if($b("scannerPanel").hidden)$b("scannerMessage").textContent="";
  $b("productSearch").focus();
});
$b("completeSale").addEventListener("click",completeSale);
$b("newSale").addEventListener("click",()=>{$b("receiptScreen").style.display="none";$b("productSearch").focus();});
renderCart();
requireSession().then(async()=>{await loadBillingShops();await loadCatalog();})
 .catch(e=>setMsg(e.message||"Could not load billing.","error"));
