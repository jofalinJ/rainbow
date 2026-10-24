import {INDIAN_STATES,deliveryFeeForState} from "./order-pricing.mjs";
import {razorpayAvailability,beginRazorpayPayment} from "./order-razorpay.mjs?v=20261021-paid-confirmation-v4";
(() => {
  const CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
  const SUPABASE_URL=String(CONFIG.supabaseUrl||"").trim();
  const KEY=String(CONFIG.supabasePublishableKey||"").trim();
  const CART_KEY="rainbow_cart_v1";
  const $=id=>document.getElementById(id);
  const sb=window.supabase?.createClient&&SUPABASE_URL&&KEY
    ?window.supabase.createClient(SUPABASE_URL,KEY):null;
  const esc=x=>String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  const money=x=>"₹"+Number(x||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  let cart=[];
  let cartVerified=false;
  let cartVerificationFailed=false;
  let submitting=false;
  let razorpayReady=false;
  let razorpayMode="test";
  let paymentChoiceTouched=false;
  let readinessAttempt=0;
  const selectedPaymentMethod=()=>document.querySelector('input[name="paymentMethod"]:checked')?.value||"upi";

  function read(){
    try{
      const saved=JSON.parse(localStorage.getItem(CART_KEY)||"[]");
      cart=Array.isArray(saved)?saved.filter(x=>x&&x.variant_id&&x.product&&Number.isInteger(Number(x.quantity))&&Number(x.quantity)>0).slice(0,50):[];
    }catch{cart=[];}
    updateCount();
  }
  function save(){
    try{localStorage.setItem(CART_KEY,JSON.stringify(cart));}
    catch{msg("Your browser could not save the cart. Check available storage and try again.","error");}
    updateCount();
  }
  function updateCount(){
    const el=$("cartCount");
    const count=cart.reduce((n,x)=>n+Number(x.quantity||0),0);
    if(el)el.textContent=count;
    const badge=$("bagItemCount");
    if(badge)badge.textContent=count===0?"Your bag is empty":count+" "+(count===1?"item":"items")+" in your bag";
  }
  function msg(text,kind=""){
    const el=$("orderMsg");
    if(el){el.textContent=text;el.className="order-msg "+kind;}
  }
  function phoneLooksValid(phone){
    const digits=String(phone||"").replace(/\D/g,"");
    return digits.length>=10&&digits.length<=13;
  }
    function totals(){
    const subtotal=roundMoney(cart.reduce((sum,item)=>sum+Number(item.product.selling_price||0)*Number(item.quantity||0),0));
    const discount=roundMoney(subtotal*.03);
    const taxable=roundMoney(subtotal-discount);
    const cgst=roundMoney(taxable*.015);
    const sgst=roundMoney(taxable*.015);
    const shipping=cart.length?deliveryFeeForState($("state").value):null;
    const total=shipping===null?null:roundMoney(taxable+cgst+sgst+shipping);
    $("subtotal").textContent=money(subtotal);
    $("discount").textContent=money(discount);
    $("cgst").textContent=money(cgst);
    $("sgst").textContent=money(sgst);
    $("delivery").textContent=shipping===null?"Choose state":money(shipping);
    $("total").textContent=total===null?"—":money(total);
    $("totalLabel").textContent="Total";
    const payTotal=$("paymentDueTotal");if(payTotal)payTotal.textContent=total===null?"—":money(total);
    return {subtotal,discount,cgst,sgst,shipping,total};
  }
    function roundMoney(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
  function cartItemHasStock(item){
    return item.unavailable!==true&&Number.isFinite(Number(item.current_stock))&&
      Number(item.current_stock)>=Number(item.quantity);
  }
  function render(){
    if(!cart.length){
      $("orderItems").innerHTML='<div class="empty">Your cart is empty. <a href="index.html#products">Browse products →</a></div>';
      totals();
      updatePlaceOrderState();
      return;
    }
    $("orderItems").innerHTML=cart.map((item,index)=>{
      const stockKnown=Number.isFinite(Number(item.current_stock));
      const out=item.unavailable===true||(stockKnown&&Number(item.current_stock)<=0);
      const exceeds=stockKnown&&Number(item.quantity)>Number(item.current_stock);
      const stockMessage=item.unavailable===true?"This option is unavailable. Remove it to continue."
        :out?"Out of stock. Remove this item to continue."
        :exceeds?"Only "+Number(item.current_stock)+" available. Reduce the quantity to continue.":"";
      const variant=item.variant_label?" • "+esc(item.variant_label):"";
      return '<div class="order-item">'+
        (item.product.image?'<img src="'+esc(item.product.image)+'" alt="" loading="lazy" width="72" height="72">':'<div class="order-item-placeholder"></div>')+
        '<div><h3>'+esc(item.product.product_name)+'</h3><small>'+variant.replace(/^ • /,"")+(variant?" • ":"")+money(item.product.selling_price)+'</small>'+
        '<div class="order-qty"><button type="button" data-dec="'+index+'" aria-label="Decrease quantity" '+(Number(item.quantity)<=1?'disabled':'')+'>−</button><span>'+Number(item.quantity)+'</span><button type="button" data-inc="'+index+'" aria-label="Increase quantity" '+(!stockKnown||Number(item.quantity)>=Number(item.current_stock)?'disabled':'')+'>＋</button><button type="button" data-remove="'+index+'" aria-label="Remove '+esc(item.product.product_name)+'">Remove</button></div>'+
        (stockMessage?'<small class="cart-warning">'+esc(stockMessage)+'</small>':'')+
        '</div><div class="order-price">'+money(Number(item.product.selling_price)*Number(item.quantity))+'</div></div>';
    }).join("");
    document.querySelectorAll("[data-inc]").forEach(button=>button.onclick=()=>change(Number(button.dataset.inc),1));
    document.querySelectorAll("[data-dec]").forEach(button=>button.onclick=()=>change(Number(button.dataset.dec),-1));
    document.querySelectorAll("[data-remove]").forEach(button=>button.onclick=()=>removeItem(Number(button.dataset.remove)));
    totals();
    updatePlaceOrderState();
  }
  function change(index,delta){
    const item=cart[index];
    if(!item)return;
    const stock=Number(item.current_stock);
    if(delta>0&&Number.isFinite(stock)&&Number(item.quantity)>=stock)return;
    item.quantity=Math.max(1,Math.min(Number.isFinite(stock)?stock:100,Number(item.quantity)+delta));
    save();
    render();
  }
  function removeItem(index){
    cart.splice(index,1);
    save();
    render();
    if(!cart.length)msg("");
  }
  function updatePlaceOrderState(){
    const button=$("placeOrder");
    if(!button)return;
    const reference=String($("paymentReference")?.value||"").trim();
    const shipping=deliveryFeeForState($("state").value);
    const payReady=cart.length>0&&cartVerified&&!cartVerificationFailed&&
      cart.every(cartItemHasStock)&&shipping!==null;
    const gatewaySelected=selectedPaymentMethod()==="razorpay";
    const manualSelected=!gatewaySelected;
    const gatewayDetails=$("razorpayDetails");
    const manualDetails=$("manualPaymentDetails");
    if(gatewayDetails)gatewayDetails.hidden=!gatewaySelected;
    if(manualDetails)manualDetails.hidden=!manualSelected;
    const qr=$("checkoutQR");
    const qrMessage=$("qrUnavailable");
    const referenceGroup=$("paymentReferenceGroup");
    if(qr)qr.hidden=gatewaySelected||!payReady;
    if(qrMessage){
      qrMessage.hidden=gatewaySelected||payReady;
      qrMessage.textContent=!cart.length?"Add jewellery to your bag before making a payment."
         :shipping===null?"Select your delivery state to see the total."
        :"Checking price and stock before showing the UPI QR…";
    }
    if(referenceGroup)referenceGroup.hidden=gatewaySelected;
    button.textContent=submitting?"Processing…":gatewaySelected?
      (razorpayMode==="live"?"Pay securely →":"Pay securely · TEST →"):"Submit UPI reference →";
    button.disabled=submitting||!payReady||
      (gatewaySelected?!razorpayReady:!/^[A-Za-z0-9-]{8,64}$/.test(reference));
  }
    async function verifyCart(){
    if(!cart.length){cartVerified=true;render();return;}
    if(!sb){
      cartVerificationFailed=true;
      msg("Checkout is temporarily unavailable. Please try again later.","error");
      render();
      return;
    }
    msg("Checking price and stock…");
    try{
      const variantIds=[...new Set(cart.map(item=>String(item.variant_id)))];
      const {data:variants,error:variantError}=await sb.from("product_variants")
        .select("id,product_id,stock_quantity,active,color,size").in("id",variantIds);
      if(variantError)throw variantError;
      const foundVariants=variants||[];
      const productIds=[...new Set(foundVariants.map(item=>item.product_id).filter(Boolean))];
      let products=[];
      if(productIds.length){
        const {data,error}=await sb.from("products")
          .select("id,product_code,product_name,type,selling_price,description,active,product_images(public_url,is_primary)")
          .in("id",productIds);
        if(error)throw error;
        products=data||[];
      }
      const variantById=new Map(foundVariants.map(item=>[String(item.id),item]));
      const productById=new Map(products.map(item=>[String(item.id),item]));
      cart=cart.map(item=>{
        const variant=variantById.get(String(item.variant_id));
        const product=variant?productById.get(String(variant.product_id)):null;
        if(!variant||!product||variant.active===false||product.active===false){
          return {...item,unavailable:true,current_stock:0};
        }
        const images=Array.isArray(product.product_images)?product.product_images:[];
        const image=(images.find(entry=>entry.is_primary)||images[0]||{}).public_url||item.product.image||"";
        const opts=[];
        if(variant.color!=null&&String(variant.color)!=="0"&&String(variant.color).trim())opts.push("Color: "+variant.color);
        if(variant.size!=null&&String(variant.size)!=="0"&&String(variant.size).trim())opts.push("Size: "+variant.size);
        return {
          ...item,
          unavailable:false,
          current_stock:Math.max(0,Number(variant.stock_quantity||0)),
          variant_label:opts.join(" · ")||item.variant_label||"Standard option",
          product:{
            ...item.product,
            id:product.id,
            product_code:product.product_code,
            product_name:product.product_name,
            type:product.type,
            selling_price:Number(product.selling_price),
            description:product.description,
            image,
          }
        };
      });
      cartVerified=true;
      cartVerificationFailed=false;
      save();
      render();
      if(cart.some(item=>item.unavailable||Number(item.quantity)>Number(item.current_stock))){
        msg("Some cart items need attention. Remove unavailable items or adjust quantities before ordering.","error");
      }else msg("");
    }catch(error){
      console.error("Cart verification failed.",error);
      cartVerificationFailed=true;
      msg("We could not verify current prices and stock. Check your connection and reload checkout before ordering.","error");
      render();
    }
  }
    async function placeOrder(){
    if(submitting||!cart.length)return;
    if(!sb){msg("Checkout is temporarily unavailable. Please try again later.","error");return;}
    if(!cartVerified||cartVerificationFailed){msg("Current prices and stock have not been verified. Reload checkout and try again.","error");return;}
    if(cart.some(item=>!cartItemHasStock(item))){msg("Please remove unavailable items or reduce quantities to the available stock.","error");render();return;}
    const name=$("name").value.trim();
    const phone=$("phone").value.trim();
    const email=$("email").value.trim();
    const pin=$("pin").value.trim();
    const address=$("address").value.trim();
    const paymentMethod=selectedPaymentMethod();
    const paymentReference=$("paymentReference").value.trim();
    const shipping=deliveryFeeForState($("state").value);
    const customer={
      name,
      whatsapp_number:phone,
      email,
      pin_code:pin,
      city:$("city").value.trim(),
      state:$("state").value.trim(),
      address,
      whatsapp_opt_in:paymentMethod==="razorpay" && $("whatsappReceiptConsent")?.checked===true,
      payment_method:paymentMethod,
      payment_reference:paymentReference
    };
    if(!name||!phone||!address){msg("Name, WhatsApp number and delivery address are required.","error");return;}
    if(!phoneLooksValid(phone)){msg("Enter a valid WhatsApp number, including country code if needed.","error");return;}
    if(pin&&!/^\d{6}$/.test(pin)){msg("Enter a valid 6-digit PIN code.","error");return;}
    if(shipping===null){msg("Choose a valid Indian state or union territory for delivery.","error");return;}
    if(paymentMethod!=="upi" && (paymentMethod!=="razorpay" || !razorpayReady)){
      msg("This payment method is not available. Choose manual UPI instead.","error");return;
    }
    if(paymentMethod==="upi"&&!/^[A-Za-z0-9-]{8,64}$/.test(paymentReference)){
      msg("Pay with the QR code and enter the UPI transaction reference (8–64 letters or digits).","error");return;
    }
    submitting=true;
    updatePlaceOrderState();
    msg(paymentMethod==="razorpay"?"Starting secure checkout…":"Submitting your payment reference for verification…");
    try{
      if(paymentMethod==="razorpay"){
        const result=await beginRazorpayPayment({
          items:cart.map(item=>({variant_id:item.variant_id,quantity:Number(item.quantity)})),
          customer,
          displayTotal:totals().total
        });
        if(result.status==="paid"){
          cart=[];save();
          $("orderLayout").hidden=true;
          $("orderSuccess").hidden=false;
          const safeBill=(()=>{
            try{
              const url=new URL(result.invoiceUrl||"");
              return url.origin==="https://rainbowgoldcovering.com" &&
                url.pathname==="/invoice.html" &&
                /^[0-9a-f-]{36}$/i.test(url.searchParams.get("token")||"") ? url.href : null;
            }catch{return null;}
          })();
          $("orderSuccess").innerHTML=(result.mode==="live"?"<h2>Payment verified</h2>":"<h2>TEST payment verified</h2>")+
            "<p>"+(result.mode==="live"?"Order ":"Test order ")+"<strong>"+esc(result.orderNumber||"—")+
            "</strong> is confirmed.</p>"+
            (result.mode==="live"?"<p>Your payment has been securely verified.</p>":"<p>No real money was deducted.</p>")+
            (safeBill?"<p><a class='btn btn-dark' target='_blank' rel='noopener noreferrer' href='"+esc(safeBill)+
              "'>View / Print Invoice →</a></p>":"<p>Your invoice is being prepared. Contact the shop with the order number if it does not appear.</p>")+
            "<p>WhatsApp updates are sent only if you opted in and messaging is available.</p>"+
            "<a class='btn btn-light' href='index.html#products'>Continue shopping</a>";
          msg("");
        }else if(result.status==="pending"){
          msg("Payment is awaiting confirmation. Do not pay again; contact the shop with your order number if it remains pending.","error");
        }else{
          msg("Payment window closed. Your order was not confirmed. Check your Razorpay payment status before retrying.");
        }
        return;
      }
      const {data,error}=await sb.rpc("create_online_order",{
        p_items:cart.map(item=>({variant_id:item.variant_id,quantity:Number(item.quantity)})),
        p_customer:customer
      });
      if(error)throw error;
      const paymentStep=document.getElementById("paymentStep");
      const addressStep=document.getElementById("addressStep");
      if(paymentStep)paymentStep.classList.add("is-active");
      if(addressStep)addressStep.classList.add("is-complete");
      cart=[];
      save();
      $("orderLayout").hidden=true;
      $("orderSuccess").hidden=false;
      $("orderSuccess").innerHTML="<h2>UPI reference submitted</h2><p>Order <strong>"+esc(data.order_number)+"</strong> is pending shop verification. It is not confirmed yet.</p><p>Total: <strong>"+money(data.total_amount)+"</strong>. Keep your UPI receipt until payment is verified.</p><a class='btn btn-dark' href='index.html#products'>Continue shopping</a>";
      msg("");
    }catch(error){
      console.error("Order creation failed.",error);
      msg(error.message||"We could not submit the payment details. Please check the information and try again.","error");
    }finally{
      submitting=false;
      updatePlaceOrderState();
    }
  }

  $("clearCart").onclick=()=>{cart=[];cartVerified=true;cartVerificationFailed=false;save();render();msg("");};
  $("placeOrder").onclick=placeOrder;
  $("paymentReference").addEventListener("input",updatePlaceOrderState);
  document.querySelectorAll('input[name="paymentMethod"]').forEach(input=>input.addEventListener("change",()=>{paymentChoiceTouched=true;updatePlaceOrderState();}));
  const stateField=$("state");
  for(const state of INDIAN_STATES)stateField.add(new Option(state,state));
  stateField.addEventListener("change",()=>{totals();updatePlaceOrderState();});
  read();
  render();
  verifyCart();
  async function checkGateway(){
    const attempt=++readinessAttempt;
    const connection=$("gatewayConnection");
    const retry=$("retryGateway");
    const message=$("gatewayStatus");
    const indicator=$("gatewayIndicator");
    connection?.classList.remove("is-online","is-offline");
    if(message)message.textContent="Checking online payment…";
    if(retry){retry.hidden=true;retry.disabled=true;}
    const status=await razorpayAvailability();
    if(attempt!==readinessAttempt)return;
    razorpayReady=status.available;
    razorpayMode=status.mode==="live"?"live":"test";
    const badge=document.querySelector("#razorpayChoice .checkout-mode");
    const choiceNote=document.querySelector("#razorpayChoice .payment-choice-note");
    const detailsNote=document.querySelector("#razorpayDetails .payment-safety");
    const footerNote=document.querySelector(".checkout-test-notice");
    if(badge)badge.textContent=razorpayMode==="live"?"LIVE":"TEST MODE";
    if(choiceNote)choiceNote.textContent=razorpayMode==="live"?"Real payment · Protected by Razorpay.":"Test only — no real charge.";
    if(detailsNote)detailsNote.textContent=razorpayMode==="live"?"Your payment is verified securely before the order is confirmed.":"Razorpay TEST: no money is deducted. Payment is verified by our server.";
    if(footerNote)footerNote.textContent=razorpayMode==="live"
      ?"Razorpay charges real money. Manual UPI transfers real money and requires shop verification."
      :"Razorpay TEST does not charge real money. Manual UPI transfers real money and requires shop verification.";
    connection?.classList.add(status.available?"is-online":"is-offline");
    if(message)message.textContent=status.message;
    if(indicator)indicator.title=status.available?"Connected":"Not connected";
    if(retry){retry.hidden=status.available;retry.disabled=false;}
    const gateway=$("payRazorpay");
    const manual=$("payUpi");
    if(gateway){
      gateway.disabled=!status.available;
      if(status.available && !paymentChoiceTouched && manual?.checked){
        gateway.checked=true;
      }else if(!status.available && gateway.checked && manual){
        manual.checked=true;
      }
    }
    updatePlaceOrderState();
  }
  $("retryGateway").addEventListener("click",checkGateway);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && !razorpayReady)checkGateway();
  });
  window.addEventListener("pageshow",event=>{
    if(event.persisted)checkGateway();
  });
  checkGateway();
})();