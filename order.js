import {INDIAN_STATES,deliveryFeeForState} from "./order-pricing.mjs";
import {razorpayTestAvailability,beginRazorpayTestPayment} from "./order-razorpay.mjs?v=20261021-paid-confirmation-v4";
(() => {
  const CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
  const SUPABASE_URL=String(CONFIG.supabaseUrl||"").trim();
  const KEY=String(CONFIG.supabasePublishableKey||"").trim();
  const CART_KEY="rainbow_cart_v1";
  // UX-09: minimal, expiring local receipt. No address or full phone number.
  const PENDING_KEY="rainbow_pending_upi_v1";
  const PENDING_TTL=24*60*60*1000;
  let pendingRecord=null;
  function readPendingRecord(){
    try{
      const data=JSON.parse(localStorage.getItem(PENDING_KEY)||"null");
      if(!data||!data.checkout_id||!data.order_number||!Number.isFinite(data.created_at)||
        !Array.isArray(data.items))return null;
      if(Date.now()-data.created_at>PENDING_TTL){
        localStorage.removeItem(PENDING_KEY);return null;
      }
      return data;
    }catch{return null;}
  }
  function writePendingRecord(value){
    try{localStorage.setItem(PENDING_KEY,JSON.stringify(value));pendingRecord=value;return true;}
    catch{msg("Could not save your pending order on this device.","error");return false;}
  }
  function removePendingRecord(){
    try{localStorage.removeItem(PENDING_KEY);}catch{}
    pendingRecord=null;
  }
  function minimalCartSnapshot(){
    return cart.map(item=>({
      variant_id:String(item.variant_id),quantity:Number(item.quantity),
      variant_label:String(item.variant_label||""),
      product:{
        id:String(item.product?.id||""),
        product_code:String(item.product?.product_code||""),
        product_name:String(item.product?.product_name||""),
        selling_price:Number(item.product?.selling_price||0),
        image:String(item.product?.image||"")
      }
    }));
  }
  function persistPendingQuote(data,checkoutId){
    const prior=pendingRecord?.checkout_id===checkoutId?pendingRecord:null;
    return writePendingRecord({
      checkout_id:checkoutId,order_number:String(data.order_number),
      created_at:prior?.created_at||Date.now(),
      items:prior?.items||minimalCartSnapshot(),
      amounts:{
        subtotal:Number(data.subtotal),discount_amount:Number(data.discount_amount),
        cgst_amount:Number(data.cgst_amount),sgst_amount:Number(data.sgst_amount),
        delivery_fee:Number(data.delivery_fee),total_amount:Number(data.total_amount)
      },
      status:prior?.status||"awaiting_payment",
      phone_last4:String($("phone")?.value||"").replace(/\D/g,"").slice(-4),
      recovery_token:typeof data.recovery_token==="string"?data.recovery_token:(prior?.recovery_token||""),
      request_id:prior?.request_id||""
    });
  }
  function renderPendingBanner(message=""){
    const box=$("pendingCheckoutBanner");
    if(!box)return;
    box.hidden=!pendingRecord&&!message;
    if(box.hidden)return;
    const record=pendingRecord;
    const order=record?.order_number||"";
    const current=record?.status||"pending";
    const text=message||(current==="awaiting_payment"
      ?"Order "+order+" is awaiting your UPI reference. Do not create another order."
      :"Order "+order+" is waiting for payment verification. Please do not pay again.");
    $("pendingCheckoutMessage").textContent=text;
    const correct=$("pendingCheckoutCorrect");
    if(correct)correct.hidden=!record||!["awaiting_payment","pending"].includes(current);
    const status=$("pendingCheckoutStatus");
    if(status)status.hidden=!record;
    const restore=$("pendingCheckoutReturn");
    if(restore)restore.hidden=current!=="declined"&&current!=="cancelled";
  }

  const $=id=>document.getElementById(id);
  const sb=window.supabase?.createClient&&SUPABASE_URL&&KEY
    ?window.supabase.createClient(SUPABASE_URL,KEY):null;
  const esc=x=>String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  const money=x=>"₹"+Number(x||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  let cart=[];
  let buyNowActive=false;
  let cartVerified=false;
  let cartVerificationFailed=false;
  let submitting=false;
  let razorpayReady=false;
  let paymentChoiceTouched=false;
  const testHost=!["rainbowgoldcovering.com","www.rainbowgoldcovering.com"].includes(location.hostname);
  const razorpayTestAllowed=testHost||new URLSearchParams(location.search).get("test")==="1";
  const touchedFields=new Set();
  let showAllErrors=false;
  let readinessAttempt=0;
  let pending=null,pendingFingerprint='',pendingKey='',pendingError='',pendingTimer=null,pendingBusy=false,pendingAttempted=false,pendingVersion=0,pendingSubmitKey='';

  const selectedPaymentMethod=()=>document.querySelector('input[name="paymentMethod"]:checked')?.value||"upi";

  function read(){
    pendingRecord=readPendingRecord();
    renderPendingBanner();
    try{
      if(new URLSearchParams(location.search).has("bag"))window.RainbowCatalogue?.clearBuyNow();
      const saved=JSON.parse(localStorage.getItem(CART_KEY)||"[]");
      const ordinary=Array.isArray(saved)?saved.filter(x=>x&&x.variant_id&&x.product&&Number.isInteger(Number(x.quantity))&&Number(x.quantity)>0).slice(0,50):[];
      const selection=window.RainbowCatalogue?.readBuyNow();
      buyNowActive=Boolean(selection);
      cart=selection?[selection]:ordinary;
    }catch{cart=[];buyNowActive=false;}
    updateCount();
    if($("clearCart"))$("clearCart").textContent=buyNowActive?"Cancel Buy now":"Clear bag";
    const existing=$("buyNowBackToBag");
    if(buyNowActive&&!existing){
      const link=document.createElement("a");
      link.id="buyNowBackToBag";link.href="order.html?bag=1";
      link.className="btn btn-light";link.textContent="← Back to bag";
      link.style.cssText="display:inline-flex;margin-top:9px;min-height:44px;align-items:center";
      $("bagHeading")?.insertAdjacentElement("afterend",link);
    }else if(!buyNowActive&&existing)existing.remove();
  }
  function save(){
    try{
      if(buyNowActive){
        if(cart.length)window.RainbowCatalogue?.startBuyNow(cart[0]);
        else{window.RainbowCatalogue?.clearBuyNow();buyNowActive=false;}
      }else localStorage.setItem(CART_KEY,JSON.stringify(cart));
    }catch{msg("Your browser could not save this selection. Check device storage.","error");}
    updateCount();
  }
  function updateCount(){
    const el=$("cartCount");
    const count=cart.reduce((n,x)=>n+Number(x.quantity||0),0);
    if(el)el.textContent=count;
    const badge=$("bagItemCount");
    if(badge)badge.textContent=buyNowActive?"Buying now: "+count+" "+(count===1?"item":"items"):
      count===0?"Your bag is empty":count+" "+(count===1?"item":"items")+" in your bag";
  }
  function msg(text,kind=""){
    const el=$("orderMsg");
    if(el){el.textContent=text;el.className="order-msg "+kind;}
  }
  // UX-02: fail closed until the proposed A2 server contract returns a priced,
  // stock-checked awaiting_payment order. Never fall back to legacy create_online_order.
  const snapshot=()=>JSON.stringify({
    items:cart.map(item=>[String(item.variant_id),Number(item.quantity)]),
    fields:["name","phone","email","pin","city","state","address"].map(id=>String($(id)?.value||"").trim())
  });
  const paise=x=>Math.round(Number(x)*100);
  async function pendingApi(route,body){
    // Proposed Cloudflare route owns privileged DB writes, origin checks and
    // rate limits. The browser NEVER invokes a service-role RPC directly.
    const raw=String(window.RAINBOW_PAYMENT_CONFIG?.apiBaseUrl||"").trim();
    if(!raw)throw new Error("Secure checkout is not configured.");
    const base=new URL(raw);
    if(base.protocol!=="https:")throw new Error("Secure checkout needs HTTPS.");
    const timeout=AbortSignal.timeout(10000);
    const response=await fetch(base.origin+route,{
      method:"POST",mode:"cors",cache:"no-store",signal:timeout,
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(body)
    });
    if(!response.ok)throw new Error("Secure UPI checkout is unavailable. Please retry.");
    return response.json();
  }
  function clearPending(){
    pendingVersion++;if(pendingTimer!==null)clearTimeout(pendingTimer);
    pendingTimer=null;pending=null;pendingKey="";pendingError="";pendingBusy=false;
    pendingAttempted=false;pendingSubmitKey="";
    const qr=$("checkoutQR");if(qr){qr.replaceChildren();qr.hidden=true;}
  }
  function lockedAmounts(){
    return pending&&pendingFingerprint===snapshot()&&selectedPaymentMethod()==="upi"?pending.amounts:null;
  }
  function paintQR(){
    const qr=$("checkoutQR");if(!qr)return;
    qr.replaceChildren();qr.hidden=true;
    const amounts=lockedAmounts();
    if(!amounts||!pending||!pendingRecord||
      Date.now()-pendingRecord.created_at>PENDING_TTL)return;
    const img=document.createElement("img");img.src="assets/brand/pay.png";
    img.alt="Shop UPI QR. Verify the recipient name before transferring money.";
    img.width=176;img.height=176;
    const info=document.createElement("div");
    const heading=document.createElement("strong");heading.textContent="Scan to pay";
    const recipient=document.createElement("p");recipient.textContent="Verify recipient and amount before paying.";
    const reference=document.createElement("p");reference.className="checkout-locked-ref";
    reference.textContent="Order "+pending.order_number;
    const price=document.createElement("p");price.className="payment-total";
    const total=document.createElement("b");total.id="paymentDueTotal";
    total.textContent=money(amounts.total_amount);price.append("Pay ",total);
    info.append(heading,recipient,reference,price);qr.append(img,info);qr.hidden=false;
  }
  async function preparePending(){
    pendingTimer=null;
    if(pendingBusy||pendingAttempted||!sb||selectedPaymentMethod()!=="upi")return;
    // Prevent a second stock reservation while another local pending order exists.
    if(pendingRecord){renderPendingBanner();return;}
    if(!cartVerified||cartVerificationFailed||!cart.length||!cart.every(cartItemHasStock)||
       Object.keys(deliveryErrors()).length)return;
    const signature=snapshot();if(signature!==pendingFingerprint)return;
    pendingAttempted=true;pendingBusy=true;pendingError="";
    const generation=pendingVersion,key=pendingKey||(pendingKey=crypto.randomUUID());
    updatePlaceOrderState();
    try{
      const data=await pendingApi("/api/upi/prepare",{
        checkout_id:key,items:cart.map(i=>({variant_id:i.variant_id,quantity:Number(i.quantity)})),
        customer:{
          name:$("name").value.trim(),whatsapp_number:$("phone").value.trim(),
          email:$("email").value.trim(),pin_code:$("pin").value.trim(),
          city:$("city").value.trim(),state:$("state").value.trim(),
          address:$("address").value.trim()
        }
      });
      if(generation!==pendingVersion||signature!==snapshot())return;
      const names=["subtotal","discount_amount","cgst_amount","sgst_amount","delivery_fee","total_amount"];
      if(!data||data.checkout_id!==key||data.state!=="awaiting_payment"||!data.order_number||
        !/^[A-Za-z0-9_-]{32,128}$/.test(String(data.recovery_token||""))||
        !Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=Date.now()||
        !names.every(name=>Number.isFinite(Number(data[name]))))
        throw new Error("Pending checkout could not be verified.");
      if(paise(data.total_amount)!==paise(totals().total)){
        pendingError="Prices changed, please review your bag.";return;
      }
      if(!persistPendingQuote(data,key)){
        pendingError="Cannot safely remember this order. Payment is unavailable.";
        return;
      }
      renderPendingBanner();
      pending={checkout_id:key,order_number:String(data.order_number),
        amounts:Object.fromEntries(names.map(name=>[name,Number(data[name])]))};
      paintQR();
    }catch(e){if(generation===pendingVersion)pendingError=e.message||"Could not prepare UPI checkout.";}
    finally{if(generation===pendingVersion){pendingBusy=false;totals();updatePlaceOrderState();}}
  }
  function queuePending(){
    if(pendingTimer!==null||pendingAttempted||pendingBusy||pending)return;
    pendingTimer=setTimeout(()=>{void preparePending();},220);
  }
  function phoneLooksValid(phone){
    const cleaned=String(phone||"").replace(/[\s-]/g,"").replace(/^\+91/,"").replace(/^91(?=[6-9]\d{9}$)/,"").replace(/^0(?=[6-9]\d{9}$)/,"");
    return /^[6-9]\d{9}$/.test(cleaned);
  }
  // Same validation result is used for payment readiness, inline errors and submit.
  const deliveryFields=["name","phone","email","pin","city","state","address"];
  function deliveryErrors(){
    const val=id=>String($(id)?.value||"").trim();
    const errors={};
    if(val("name").length<2)errors.name="Enter at least 2 characters.";
    if(!phoneLooksValid(val("phone")))errors.phone="Enter a valid 10-digit Indian mobile number.";
    if(val("email")&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("email")))errors.email="Enter a valid email or leave it blank.";
    if(val("pin")&&!/^\d{6}$/.test(val("pin")))errors.pin="Enter a 6-digit PIN.";
    if(!deliveryFeeForState(val("state"))&&deliveryFeeForState(val("state"))!==0)errors.state="Select your delivery state.";
    if(val("address").length<10)errors.address="Enter at least 10 characters for your address.";
    return errors;
  }
  function paintDeliveryErrors(errors,force=false){
    for(const id of deliveryFields){
      const input=$(id);
      if(!input)continue;
      const visible=(showAllErrors||force||touchedFields.has(id))&&Boolean(errors[id]);
      const errorId=id+"CheckoutError";
      let note=$(errorId);
      if(visible&&!note){
        note=document.createElement("small");
        note.id=errorId;note.className="checkout-inline-error";
        note.style.cssText="display:block;color:#97232c;font-size:12px;line-height:1.45;margin-top:4px";
        input.insertAdjacentElement("afterend",note);
      }
      if(note){
        note.textContent=visible?errors[id]:"";
        note.hidden=!visible;
      }
      if(visible){input.setAttribute("aria-invalid","true");input.setAttribute("aria-describedby",errorId);}
      else {input.removeAttribute("aria-invalid");if(input.getAttribute("aria-describedby")===errorId)input.removeAttribute("aria-describedby");}
    }
  }
  function focusDeliveryError(errors){
    showAllErrors=true;paintDeliveryErrors(errors,true);
    const ids=Object.keys(errors);
    if(!ids.length)return false;
    const first=$(ids[0]);
    msg("Fix "+ids.length+" "+(ids.length===1?"field":"fields")+" to continue.","error");
    if(first){
      first.style.scrollMarginTop="110px";
      first.scrollIntoView({behavior:"smooth",block:"center"});
      first.focus({preventScroll:true});
    }
    return true;
  }
    function totals(){
    const subtotal=roundMoney(cart.reduce((sum,item)=>sum+Number(item.product.selling_price||0)*Number(item.quantity||0),0));
    const discount=roundMoney(subtotal*.03);
    const taxable=roundMoney(subtotal-discount);
    const cgst=roundMoney(taxable*.015);
    const sgst=roundMoney(taxable*.015);
    const shipping=cart.length?deliveryFeeForState($("state").value):null;
    const total=shipping===null?null:roundMoney(taxable+cgst+sgst+shipping);
    const locked=lockedAmounts();
    // UX-07: one display model drives the existing sidebar and the mobile
    // inline breakdown; the preview is never presented as server-authoritative.
    const display={
      subtotal:money(locked?.subtotal??subtotal),
      discount:"−"+money(locked?.discount_amount??discount),
      cgst:money(locked?.cgst_amount??cgst),
      sgst:money(locked?.sgst_amount??sgst),
      delivery:shipping===null?"Select state":money(locked?.delivery_fee??shipping),
      total:total===null?"—":money(locked?.total_amount??total)
    };
    for(const [key,ids] of Object.entries({
      subtotal:["subtotal","paymentMiniSubtotal"],
      discount:["discount","paymentMiniDiscount"],
      cgst:["cgst","paymentMiniCgst"],
      sgst:["sgst","paymentMiniSgst"],
      delivery:["delivery","paymentMiniDelivery"],
      total:["total","paymentMiniTotal"]
    })){
      for(const id of ids){const node=$(id);if(node)node.textContent=display[key];}
    }
    $("totalLabel").textContent="Total";
    const payTotal=$("paymentDueTotal");
    if(payTotal)payTotal.textContent=display.total;
    const headline=$("paymentPriceHeadline");
    if(headline)headline.textContent=total===null?"Select state to see total":
      locked?"Pay "+display.total:"Estimated "+display.total;
    const source=$("paymentPriceSource");
    if(source)source.textContent=locked?"Server-verified amount · Order "+pending.order_number:
      "Estimated total. Confirmed amount is shown before payment.";

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
  function updateCheckoutProgress(){
    const submitted=$("orderLayout")?.hidden===true&&Boolean(pendingRecord?.status==="pending");
    const deliveryValid=Object.keys(deliveryErrors()).length===0;
    const stockReady=cart.length>0&&cartVerified&&!cartVerificationFailed&&cart.every(cartItemHasStock);
    const paymentReady=deliveryValid&&stockReady&&
      (selectedPaymentMethod()==="razorpay"?razorpayReady:Boolean(lockedAmounts()));
    const index=!stockReady?0:!deliveryValid?1:2;
    const steps=[["bagStep","Bag"],["addressStep","Delivery"],["paymentStep","Pay"]];
    for(let i=0;i<steps.length;i++){
      const [id,label]=steps[i],node=$(id);if(!node)continue;
      const complete=submitted||i<index;
      const current=!submitted&&i===index;
      node.classList.toggle("is-complete",complete);
      node.classList.toggle("is-active",current);
      if(current)node.setAttribute("aria-current","step");
      else node.removeAttribute("aria-current");
      const marker=node.querySelector("b");
      if(marker)marker.textContent=complete?"✓":String(i+1);
      const announcement=node.querySelector("[data-step-announcement]");
      if(announcement)announcement.textContent="Step "+(i+1)+" of 3: "+label+
        (complete?", complete":current?", current":", upcoming")+
        (i===2&&!submitted&&!paymentReady?", payment not yet ready":"");
    }
  }
  function updatePlaceOrderState(){
    const button=$("placeOrder");
    if(!button)return;
    const reference=String($("paymentReference")?.value||"").trim();
    const shipping=deliveryFeeForState($("state").value);
    const errors=deliveryErrors();
    paintDeliveryErrors(errors);
    const validDelivery=Object.keys(errors).length===0;
    const payReady=cart.length>0&&cartVerified&&!cartVerificationFailed&&
      cart.every(cartItemHasStock)&&shipping!==null&&validDelivery;
    const gatewaySelected=selectedPaymentMethod()==="razorpay";
    const manualSelected=!gatewaySelected;
    const gatewayDetails=$("razorpayDetails");
    const manualDetails=$("manualPaymentDetails");
    if(gatewayDetails)gatewayDetails.hidden=!gatewaySelected;
    if(manualDetails)manualDetails.hidden=!manualSelected;
    const qr=$("checkoutQR"),qrMessage=$("qrUnavailable"),referenceGroup=$("paymentReferenceGroup");
    const signature=snapshot();
    if(signature!==pendingFingerprint){pendingFingerprint=signature;clearPending();}
    const quoteReady=!gatewaySelected&&payReady&&Boolean(lockedAmounts());
    if(qr){if(!quoteReady){qr.replaceChildren();qr.hidden=true;}else if(qr.hidden)paintQR();}
    if(qrMessage){
      qrMessage.hidden=gatewaySelected||quoteReady;
      qrMessage.textContent=!cart.length?"Add jewellery to your bag."
        :!validDelivery?"Complete your delivery details to unlock payment."
        :!cartVerified||cartVerificationFailed?"Verifying stock and prices…"
        :pendingError?pendingError
        :pendingBusy?"Preparing secure order…":"Preparing your payable amount…";
    }
    const retry=$("retryPendingCheckout");
    if(retry)retry.hidden=gatewaySelected||!pendingError;
    if(referenceGroup)referenceGroup.hidden=gatewaySelected||!quoteReady;
    if(!gatewaySelected&&payReady&&!pending&&!pendingBusy&&!pendingError)queuePending();
    button.textContent=submitting?"Processing…":gatewaySelected?"Pay securely · TEST →":"Submit UPI reference →";
    const actionReady=!submitting&&payReady&&
      (gatewaySelected?razorpayReady:quoteReady&&/^[A-Za-z0-9-]{8,64}$/.test(reference));
    button.disabled=false; // Keep reachable so invalid submission can focus its field.
    button.setAttribute("aria-disabled",String(!actionReady));
    button.dataset.checkoutReady=String(actionReady);
    updateCheckoutProgress();
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
    if(submitting)return;
    const errors=deliveryErrors();
    if(focusDeliveryError(errors))return;
    if($("placeOrder")?.dataset.checkoutReady!=="true"){
      if(selectedPaymentMethod()==="upi"&&lockedAmounts()&&
         !/^[A-Za-z0-9-]{8,64}$/.test(String($("paymentReference")?.value||"").trim())){
        const input=$("paymentReference");
        input.setAttribute("aria-invalid","true");
        let hint=$("paymentReferenceError");
        if(!hint){
          hint=document.createElement("small");hint.id="paymentReferenceError";
          hint.style.cssText="display:block;color:#97232c;font-size:12px;line-height:1.45;margin-top:4px";
          input.insertAdjacentElement("afterend",hint);
        }
        hint.textContent="Enter the 8–64 character UPI transaction reference.";
        input.setAttribute("aria-describedby","paymentReferenceError");
        input.style.scrollMarginTop="110px";
        input.scrollIntoView({behavior:"smooth",block:"center"});
        input.focus({preventScroll:true});
        msg("Fix 1 field to continue.","error");return;
      }
      msg(!cart.length?"Add jewellery to your bag first.":"Complete payment setup and verify stock before submitting.","error");
      return;
    }
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
    if(Object.keys(deliveryErrors()).length){focusDeliveryError(deliveryErrors());return;}
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
    msg(paymentMethod==="razorpay"?"Starting a secure test checkout…":"Submitting your payment reference for verification…");
    try{
      if(paymentMethod==="razorpay"){
        const result=await beginRazorpayTestPayment({
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
          $("orderSuccess").innerHTML="<h2>TEST payment verified</h2>"+
            "<p>Test order <strong>"+esc(result.orderNumber||"—")+
            "</strong> is confirmed.</p>"+
            "<p>No real money was deducted.</p>"+
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
      if(!pending||!lockedAmounts()){msg("A verified pending checkout is required.","error");return;}
      const data=await pendingApi("/api/upi/submit",{
        checkout_id:pending.checkout_id,
        request_id:pendingSubmitKey||(pendingSubmitKey=crypto.randomUUID()),
        transaction_reference:paymentReference
      });
      if(!data||data.order_number!==pending.order_number||data.payment_status!=="pending")
        throw new Error("The pending payment status could not be verified.");
      if(pendingRecord?.checkout_id===pending.checkout_id){
        pendingRecord.status="pending";
        pendingRecord.request_id=pendingSubmitKey;
        if(!writePendingRecord(pendingRecord)){
          msg("Order submitted, but this device could not save your receipt. Keep order "+pending.order_number+".","error");
        }
        renderPendingBanner();
      }
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

  // UX-03: native modal confirmation; nothing is mutated until confirmed.
  const clearTrigger=$("clearCart");
  const clearDialog=document.createElement("dialog");
  clearDialog.id="clearBagConfirm";clearDialog.className="checkout-clear-dialog";
  clearDialog.setAttribute("aria-labelledby","clearBagDialogTitle");
  clearDialog.style.cssText="width:min(92vw,390px);max-width:390px;max-height:90dvh;margin:auto;border:1px solid #eadacb;border-radius:20px;background:#fffdfa;color:#352827;padding:22px;box-shadow:0 24px 70px #0004";
  const clearHeading=document.createElement("h2");
  clearHeading.id="clearBagDialogTitle";clearHeading.style.cssText="font:600 23px/1.2 Georgia,serif;margin:0 0 18px";
  const clearActions=document.createElement("div");
  clearActions.style.cssText="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap";
  const keepBag=document.createElement("button"),confirmClear=document.createElement("button");
  for(const control of [keepBag,confirmClear]){
    control.type="button";control.style.cssText="min-height:48px;padding:10px 16px;border-radius:999px;font-size:14px;font-weight:700;cursor:pointer";
  }
  keepBag.textContent="Keep bag";keepBag.style.border="1px solid #bda99b";keepBag.style.background="#fff";
  confirmClear.textContent="Clear bag";confirmClear.style.border="1px solid #8f1520";
  confirmClear.style.background="#8f1520";confirmClear.style.color="#fff";
  clearActions.append(keepBag,confirmClear);clearDialog.append(clearHeading,clearActions);
  document.body.append(clearDialog);
  const backdropStyle=document.createElement("style");
  backdropStyle.textContent=".checkout-clear-dialog::backdrop{background:rgba(30,16,18,.58)}";
  document.head.append(backdropStyle);
  keepBag.addEventListener("click",()=>clearDialog.close());
  clearDialog.addEventListener("click",event=>{
    if(event.target===clearDialog)clearDialog.close();
  });
  clearDialog.addEventListener("close",()=>clearTrigger?.focus({preventScroll:true}));
  confirmClear.addEventListener("click",()=>{
    cart=[];cartVerified=true;cartVerificationFailed=false;
    save();render();msg("");clearDialog.close();
  });
  clearTrigger.onclick=()=>{
    const count=cart.reduce((n,item)=>n+Number(item.quantity||0),0);
    if(count<1)return;
    clearHeading.textContent=buyNowActive
      ?"Cancel Buy now for "+count+" "+(count===1?"item":"items")+"?"
      :"Remove all "+count+" "+(count===1?"item":"items")+" from your bag?";
    confirmClear.textContent=buyNowActive?"Cancel Buy now":"Clear bag";
    clearDialog.showModal();
    keepBag.focus();
  };
  // UX-09: status/correction ONLY use a server-authorized operation on the
  // original checkout. No client-side claim of paid and no second order creation.
  function restoreDeclinedBag(record){
    try{
      const saved=JSON.parse(localStorage.getItem(CART_KEY)||"[]");
      const list=Array.isArray(saved)?saved.filter(i=>i?.variant_id&&i?.product):[];
      for(const item of record.items||[]){
        if(!item?.variant_id||!item?.product||!Number.isInteger(Number(item.quantity)))continue;
        const match=list.find(i=>String(i.variant_id)===String(item.variant_id));
        if(match)match.quantity=Math.max(Number(match.quantity)||1,Number(item.quantity));
        else list.push(item);
      }
      localStorage.setItem(CART_KEY,JSON.stringify(list.slice(0,50)));
      return true;
    }catch{return false;}
  }
  function showPendingTerminal(message,returnBag){
    removePendingRecord();
    const box=$("pendingCheckoutBanner");if(box)box.hidden=false;
    $("pendingCheckoutMessage").textContent=message;
    $("pendingCheckoutStatus").hidden=true;
    $("pendingCheckoutCorrect").hidden=true;
    $("pendingCheckoutCorrection").hidden=true;
    $("pendingCheckoutReturn").hidden=!returnBag;
  }
  $("pendingCheckoutStatus")?.addEventListener("click",async()=>{
    const record=pendingRecord;if(!record)return;
    if(!record.recovery_token){
      renderPendingBanner("Order "+record.order_number+" is pending. Contact the shop with this order number to verify status.");
      return;
    }
    const button=$("pendingCheckoutStatus");button.disabled=true;
    try{
      const data=await pendingApi("/api/upi/status",{
        checkout_id:record.checkout_id,recovery_token:record.recovery_token
      });
      if(!data||data.order_number!==record.order_number)
        throw new Error("Could not verify this order's status.");
      if(data.state==="verified"&&data.payment_status==="paid"){
        showPendingTerminal("Order "+record.order_number+" payment verified by the shop.",false);
      }else if(["declined","cancelled"].includes(data.state)){
        const restored=restoreDeclinedBag(record);
        showPendingTerminal("Order "+record.order_number+" was "+data.state+
          (restored?". Your bag was restored.":". Contact the shop before ordering again."),restored);
      }else if(["pending","awaiting_payment"].includes(data.state)){
        record.status=data.state;
        writePendingRecord(record);renderPendingBanner();
      }else renderPendingBanner("Status needs shop review. Do not send another payment.");
    }catch{
      renderPendingBanner("Cannot verify the status right now. Keep order "+record.order_number+
        " and contact the shop; please do not pay again.");
    }finally{button.disabled=false;}
  });
  $("pendingCheckoutCorrect")?.addEventListener("click",()=>{
    if(!pendingRecord)return;
    $("pendingCheckoutCorrection").hidden=false;
    $("pendingCheckoutUtr").focus();
  });
  $("pendingCheckoutCancelUtr")?.addEventListener("click",()=>{
    $("pendingCheckoutCorrection").hidden=true;
    $("pendingCheckoutCorrect")?.focus();
  });
  let correctionRequestId="",correctionValue="";
  $("pendingCheckoutUtr")?.addEventListener("input",()=>{
    if($("pendingCheckoutUtr").value.trim()!==correctionValue)correctionRequestId="";
  });
  $("pendingCheckoutSaveUtr")?.addEventListener("click",async()=>{
    const record=pendingRecord;if(!record)return;
    const utr=$("pendingCheckoutUtr").value.trim();
    if(!/^[A-Za-z0-9-]{8,64}$/.test(utr)){
      $("pendingCheckoutMessage").textContent="Enter an 8–64 character UPI reference.";
      $("pendingCheckoutUtr").focus();return;
    }
    if(!record.recovery_token){
      renderPendingBanner("Correcting this order requires shop verification. Contact the shop with order "+record.order_number+".");
      return;
    }
    correctionRequestId=correctionRequestId||crypto.randomUUID();
    correctionValue=utr;
    const button=$("pendingCheckoutSaveUtr");button.disabled=true;
    try{
      const data=await pendingApi("/api/upi/correct",{
        checkout_id:record.checkout_id,recovery_token:record.recovery_token,
        request_id:correctionRequestId,transaction_reference:utr
      });
      if(!data||data.order_number!==record.order_number||data.payment_status!=="pending")
        throw new Error("Correction was not confirmed.");
      record.status="pending";
      writePendingRecord(record);
      $("pendingCheckoutCorrection").hidden=true;
      renderPendingBanner("Reference updated for order "+record.order_number+
        ". Payment remains pending shop verification.");
    }catch{
      renderPendingBanner("Could not update the reference. Retry this correction or contact the shop; no new order was created.");
    }finally{button.disabled=false;}
  });
  $("pendingCheckoutReturn")?.addEventListener("click",()=>{location.href="order.html?bag=1";});
  $("placeOrder").onclick=placeOrder;
  $("paymentReference").addEventListener("input",()=>{
    const input=$("paymentReference");
    const valid=/^[A-Za-z0-9-]{8,64}$/.test(String(input.value||"").trim());
    if(valid){input.removeAttribute("aria-invalid");input.removeAttribute("aria-describedby");
      const hint=$("paymentReferenceError");if(hint)hint.hidden=true;}
    updatePlaceOrderState();
  });
  $("retryPendingCheckout")?.addEventListener("click",()=>{
    pendingError="";pendingAttempted=false;updatePlaceOrderState();
  });
  for(const id of deliveryFields){
    const field=$(id);if(!field)continue;
    field.addEventListener("blur",()=>{
      touchedFields.add(id);
      paintDeliveryErrors(deliveryErrors());
      updatePlaceOrderState();
    });
    field.addEventListener("input",()=>updatePlaceOrderState());
    field.addEventListener("change",()=>updatePlaceOrderState());
  }
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
    const status=await razorpayTestAvailability();
    if(attempt!==readinessAttempt)return;
    razorpayReady=status.available;
    connection?.classList.add(status.available?"is-online":"is-offline");
    if(message)message.textContent=status.message;
    if(indicator)indicator.title=status.available?"Connected":"Not connected";
    if(retry){retry.hidden=status.available;retry.disabled=false;}
    const gateway=$("payRazorpay");
    if(gateway){
      gateway.disabled=!status.available||!razorpayTestAllowed;
      // Availability never changes the customer's chosen payment method.
      // Even a failed provider probe cannot silently select manual UPI.
    }
    updatePlaceOrderState();
  }
  $("retryGateway").addEventListener("click",()=>{if(razorpayTestAllowed)checkGateway();});
  document.addEventListener("visibilitychange",()=>{
    if(razorpayTestAllowed&&document.visibilityState==="visible" && !razorpayReady)checkGateway();
  });
  window.addEventListener("pageshow",event=>{
    if(razorpayTestAllowed&&event.persisted)checkGateway();
  });
  const testChoice=$("razorpayChoice");
  if(testChoice){testChoice.hidden=!razorpayTestAllowed;testChoice.style.display=razorpayTestAllowed?"":"none";}
  if(!razorpayTestAllowed){
    const connection=$("gatewayConnection");
    if(connection){connection.hidden=true;connection.style.display="none";}
    $("payRazorpay").disabled=true;
  }else checkGateway();
})();