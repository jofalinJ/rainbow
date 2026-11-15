import {INDIAN_STATES,deliveryFeeForState,gstComponentsForState} from "./order-pricing.mjs";
import {attachPinAutofill} from "./pin-lookup.mjs";
import {razorpayAvailability,beginRazorpayPayment} from "./order-razorpay.mjs?v=20261103-online-only";
(() => {
  const CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
  const SUPABASE_URL=String(CONFIG.supabaseUrl||"").trim();
  const KEY=String(CONFIG.supabasePublishableKey||"").trim();
  const {key:CART_KEY,maxLines:MAX_CART_LINES,maxQuantity:MAX_CART_QUANTITY,read:readBag}=window.RainbowBag;
  const $=id=>document.getElementById(id);
  const sb=window.supabase?.createClient&&SUPABASE_URL&&KEY
    ?window.supabase.createClient(SUPABASE_URL,KEY):null;
  const esc=x=>String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  const money=x=>"₹"+Number(x||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  let cart=[];
  let lastSavedCart="";
  let cartVerified=false;
  let cartVerificationFailed=false;
  let cartVerificationAttempt=0;
  let cartRefreshPending=false;
  let submitting=false;
  let razorpayReady=false;
  let razorpayMode="test";
  let readinessAttempt=0;

  function read(){
    cart=readBag();
    lastSavedCart=JSON.stringify(cart);
    updateCount();
  }
  function save(items){
    const data=JSON.stringify(items);
    try{localStorage.setItem(CART_KEY,data);}
    catch{
      cartStatus("Your browser could not save changes to your bag. Check available storage and try again.","error",cartVerificationFailed&&Boolean(sb));
      return false;
    }
    cart=items;
    lastSavedCart=data;
    updateCount();
    return true;
  }
  function refreshCart(){
    if(submitting){cartRefreshPending=true;return;}
    read();
    if(!$("orderLayout").hidden)verifyCart();
  }
  function cartIsCurrent(){
    if(JSON.stringify(readBag())===lastSavedCart)return true;
    refreshCart();
    return false;
  }
  function removePaidItems(paidItems){
    const paidQuantities=new Map(paidItems.map(item=>[String(item.variant_id),item.quantity]));
    const remaining=readBag().flatMap(item=>{
      const paidQuantity=paidQuantities.get(String(item.variant_id));
      if(!paidQuantity)return [item];
      const quantity=Number(item.quantity)-paidQuantity;
      return quantity>0?[{...item,quantity}]:[];
    });
    return save(remaining);
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
  function cartStatus(text,kind="",retry=false){
    const status=$("cartStatus");
    status.textContent=text;
    status.className="order-msg "+kind;
    status.hidden=!text;
    $("retryCart").hidden=!retry;
  }
  function phoneLooksValid(phone){
    const digits=String(phone||"").replace(/\D/g,"");
    return /^[+0-9 -]{10,20}$/.test(phone)&&digits.length>=10&&digits.length<=13;
  }
    function totals(){
    const subtotal=roundMoney(cart.reduce((sum,item)=>sum+Number(item.product.selling_price||0)*Number(item.quantity||0),0));
    // Online checkout has no promotional discount; tax is calculated on the full subtotal.
    const taxable=subtotal;
    const gst=gstComponentsForState(taxable,$("state").value);
    const {cgst=0,sgst=0,igst=0}=gst||{};
    const shipping=cart.length?deliveryFeeForState($("state").value):null;
    const total=shipping===null||!gst?null:roundMoney(taxable+cgst+sgst+igst+shipping);
    $("subtotal").textContent=money(subtotal);
    $("cgst").textContent=money(cgst);
    $("sgst").textContent=money(sgst);
    $("igst").textContent=money(igst);
    $("cgstLine").hidden=gst?.mode==="inter";
    $("sgstLine").hidden=gst?.mode==="inter";
    $("igstLine").hidden=gst?.mode!=="inter";
    $("delivery").textContent=shipping===null?"Choose state":money(shipping);
    $("total").textContent=total===null?"—":money(total);
    $("totalLabel").textContent="Total";
    return {subtotal,cgst,sgst,igst,shipping,total};
  }
    function roundMoney(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
  function cartItemHasStock(item){
    return item.unavailable!==true&&Number.isFinite(Number(item.current_stock))&&
      Number(item.current_stock)>=Number(item.quantity);
  }
  function bagProblem(){
    if(cart.length>MAX_CART_LINES)return "Checkout supports up to "+MAX_CART_LINES+" different items. Remove "+(cart.length-MAX_CART_LINES)+" to continue.";
    if(cart.some(item=>Number(item.quantity)>MAX_CART_QUANTITY))return "Reduce the highlighted quantities to "+MAX_CART_QUANTITY+" or fewer per option.";
    if(cartVerified&&cart.some(item=>!cartItemHasStock(item)))return "Remove unavailable items or adjust quantities to the available stock.";
    return "";
  }
  function showCartStatus(){
    const problem=bagProblem();
    if(problem){cartStatus(problem,"error",cartVerificationFailed&&Boolean(sb));return;}
    if(cartVerificationFailed){
      cartStatus(sb?"We could not verify current prices and stock. Check your connection and try again.":"Checkout is temporarily unavailable. Please try again later.","error",Boolean(sb));
      return;
    }
    cartStatus(cart.length&&!cartVerified?"Checking price and stock…":"");
  }
  function render(){
    const items=$("orderItems");
    const active=document.activeElement;
    const previousAction=["inc","dec","remove"].find(action=>active?.dataset?.[action]!==undefined&&items.contains(active));
    const previousId=previousAction?active.closest(".order-item").dataset.variant:null;
    const clear=$("clearCart");
    clear.disabled=submitting||!cart.length;
    items.innerHTML=cart.length?cart.map((item,index)=>{
      const quantity=Number(item.quantity);
      const stock=Number(item.current_stock);
      const stockKnown=cartVerified&&Number.isFinite(stock);
      const availableLimit=stockKnown?Math.min(stock,MAX_CART_QUANTITY):MAX_CART_QUANTITY;
      const stockMessage=cartVerified&&item.unavailable===true?"This option is unavailable. Remove it to continue."
        :stockKnown&&stock<=0?"Out of stock. Remove this item to continue."
        :stockKnown&&stock<MAX_CART_QUANTITY&&quantity>stock?"Only "+stock+" available. Reduce the quantity to continue."
        :quantity>MAX_CART_QUANTITY?"Up to "+MAX_CART_QUANTITY+" per option. Reduce the quantity to continue.":"";
      const variant=item.variant_label?esc(item.variant_label)+" • ":"";
      const name=esc(item.product.product_name);
      return '<div class="order-item" data-variant="'+esc(item.variant_id)+'">'+
        (item.product.image?'<img src="'+esc(item.product.image)+'" alt="" loading="lazy" width="72" height="72">':'<div class="order-item-placeholder"></div>')+
        '<div><h3>'+name+'</h3><small>'+variant+money(item.product.selling_price)+'</small>'+
        '<div class="order-qty"><button type="button" data-dec="'+index+'" aria-label="Decrease quantity for '+name+'" '+(submitting||quantity<=1?'disabled':'')+'>−</button><span>'+quantity+'</span><button type="button" data-inc="'+index+'" aria-label="Increase quantity for '+name+'" '+(submitting||!stockKnown||quantity>=availableLimit?'disabled':'')+'>＋</button><button type="button" data-remove="'+index+'" aria-label="Remove '+name+'" '+(submitting?'disabled':'')+'>Remove</button></div>'+
        (stockMessage?'<small class="cart-warning">'+esc(stockMessage)+'</small>':'')+
        '</div><div class="order-price">'+money(Number(item.product.selling_price)*quantity)+'</div></div>';
    }).join(""):'<div class="empty">Your cart is empty. <a href="index.html#products">Browse products →</a></div>';
    items.querySelectorAll("[data-inc]").forEach(button=>button.onclick=()=>change(Number(button.dataset.inc),1));
    items.querySelectorAll("[data-dec]").forEach(button=>button.onclick=()=>change(Number(button.dataset.dec),-1));
    items.querySelectorAll("[data-remove]").forEach(button=>button.onclick=()=>removeItem(Number(button.dataset.remove)));
    if(previousAction){
      const index=cart.findIndex(item=>String(item.variant_id)===previousId);
      const fallback=Math.min(Number(active.dataset[previousAction]),cart.length-1);
      const rowIndex=index>=0?index:fallback;
      const actions=index>=0?[previousAction,"inc","dec","remove"]:["remove","inc","dec"];
      const target=actions.map(action=>items.querySelector('[data-'+action+'="'+rowIndex+'"]:not(:disabled)')).find(Boolean);
      (target||items.querySelector(".empty a"))?.focus({preventScroll:true});
    }else if(active===clear&&!cart.length){
      items.querySelector(".empty a")?.focus({preventScroll:true});
    }
    totals();
    updatePlaceOrderState();
  }
  function change(index,delta){
    const item=cart[index];
    if(submitting||!item||!cartIsCurrent())return;
    const quantity=Number(item.quantity);
    const stock=cartVerified?Number(item.current_stock):NaN;
    const limit=Math.min(MAX_CART_QUANTITY,Number.isFinite(stock)?stock:MAX_CART_QUANTITY);
    if(delta>0&&(!Number.isFinite(stock)||quantity>=limit))return;
    const nextQuantity=Math.max(1,quantity+delta);
    if(nextQuantity===quantity)return;
    const items=cart.slice();
    items[index]={...item,quantity:nextQuantity};
    if(save(items)){render();showCartStatus();}
  }
  function removeItem(index){
    if(submitting||!cart[index]||!cartIsCurrent())return;
    const wasOverLimit=cart.length>MAX_CART_LINES;
    if(!save(cart.filter((_,itemIndex)=>itemIndex!==index)))return;
    if(!cart.length||(wasOverLimit&&cart.length===MAX_CART_LINES))verifyCart();
    else{render();showCartStatus();}
  }
  function updatePlaceOrderState(){
    const button=$("placeOrder");
    if(!button)return;
    const shipping=deliveryFeeForState($("state").value);
    const payReady=cart.length>0&&cartVerified&&!cartVerificationFailed&&!bagProblem()&&shipping!==null;
    button.textContent=submitting?"Processing…":razorpayMode==="live"?"Pay securely →":"Pay securely · TEST →";
    button.disabled=submitting||!payReady||!razorpayReady;
  }
    async function verifyCart(){
    const attempt=++cartVerificationAttempt;
    cartVerified=false;
    cartVerificationFailed=false;
    if(!cart.length||cart.length>MAX_CART_LINES){render();showCartStatus();return;}
    if(!sb){
      cartVerificationFailed=true;
      render();
      showCartStatus();
      return;
    }
    render();
    showCartStatus();
    try{
      const variantIds=[...new Set(cart.map(item=>String(item.variant_id)))];
      const {data:variants,error:variantError}=await sb.from("product_variants")
        .select("id,product_id,stock_quantity,active,color,size,length_cm").in("id",variantIds);
      if(attempt!==cartVerificationAttempt)return;
      if(variantError)throw variantError;
      const foundVariants=variants||[];
      const productIds=[...new Set(foundVariants.map(item=>item.product_id).filter(Boolean))];
      let products=[];
      if(productIds.length){
        const {data,error}=await sb.from("products")
          .select("id,product_code,product_name,type,selling_price,description,active,length_cm,product_images(public_url,is_primary),erp_online_listings!inner(published,online_price)")
          .in("id",productIds).eq("erp_online_listings.published",true);
        if(attempt!==cartVerificationAttempt)return;
        if(error)throw error;
        products=data||[];
      }
      if(!cartIsCurrent())return;
      const variantById=new Map(foundVariants.map(item=>[String(item.id),item]));
      const productById=new Map(products.map(item=>[String(item.id),item]));
      cart=cart.map(item=>{
        const variant=variantById.get(String(item.variant_id));
        const product=variant?productById.get(String(variant.product_id)):null;
        if(!variant||!product||variant.active===false||product.active===false){
          return {...item,unavailable:true,current_stock:0};
        }
        const listing=Array.isArray(product.erp_online_listings)?product.erp_online_listings[0]:product.erp_online_listings;
        const onlinePrice=Number(listing?.online_price??product.selling_price);
        if(!Number.isFinite(onlinePrice)||onlinePrice<=0)return {...item,unavailable:true,current_stock:0};
        const images=Array.isArray(product.product_images)?product.product_images:[];
        const image=(images.find(entry=>entry.is_primary)||images[0]||{}).public_url||item.product.image||"";
        const opts=[];
        if(variant.color!=null&&String(variant.color)!=="0"&&String(variant.color).trim())opts.push("Color: "+variant.color);
        if(variant.size!=null&&String(variant.size)!=="0"&&String(variant.size).trim())opts.push("Size: "+variant.size);
        const length=Number(variant.length_cm??product.length_cm);
        if(Number.isFinite(length)&&length>0)opts.push("Length: "+length+" cm");
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
            selling_price:onlinePrice,
            description:product.description,
            image,
          }
        };
      });
      cartVerified=true;
      render();
      showCartStatus();
    }catch(error){
      if(attempt!==cartVerificationAttempt||!cartIsCurrent())return;
      console.error("Cart verification failed.",error);
      cartVerificationFailed=true;
      render();
      showCartStatus();
    }
  }
  function focusOrderConfirmation(paid=false){
    $("addressStep").classList.remove("is-active");
    $("addressStep").classList.add("is-complete");
    $("paymentStep").classList.add(paid?"is-complete":"is-active");
    if(paid)$("paymentStep").classList.remove("is-active");
    const confirmation=$("orderSuccess");
    confirmation.tabIndex=-1;
    confirmation.focus({preventScroll:true});
    confirmation.scrollIntoView({block:"start"});
  }
  function validateDeliveryFields(){
    const checks=[
      ["name",value=>!value?"Enter the name for delivery.":value.length>120?"Keep the name within 120 characters.":""],
      ["phone",value=>phoneLooksValid(value)?"":"Enter a valid WhatsApp number, including country code if needed."],
      ["email",value=>value.length>254?"Keep the email within 254 characters.":value&&!$("email").checkValidity()?"Enter a valid email address, or leave it empty.":""],
      ["pin",value=>value&&!/^\d{6}$/.test(value)?"Enter a valid 6-digit PIN code.":""],
      ["city",value=>value.length>120?"Keep the city within 120 characters.":""],
      ["state",value=>deliveryFeeForState(value)===null?"Choose a valid Indian state or union territory for delivery.":""],
      ["address",value=>!value?"Enter the delivery address.":value.length>600?"Keep the delivery address within 600 characters.":""]
    ];
    for(const [id]of checks){$(id).setCustomValidity("");$(id).removeAttribute("aria-invalid");}
    for(const [id,check]of checks){
      const field=$(id),error=check(field.value.trim());
      if(!error)continue;
      field.setCustomValidity(error);
      field.setAttribute("aria-invalid","true");
      field.reportValidity();
      msg(error,"error");
      return false;
    }
    return true;
  }
    async function placeOrder(){
    if(submitting||!cart.length)return;
    if(!cartIsCurrent())return;
    if(!sb){msg("Checkout is temporarily unavailable. Please try again later.","error");return;}
    if(!cartVerified||cartVerificationFailed||bagProblem()){showCartStatus();return;}
    if(!validateDeliveryFields())return;
    const name=$("name").value.trim();
    const phone=$("phone").value.trim();
    const email=$("email").value.trim();
    const pin=$("pin").value.trim();
    const address=$("address").value.trim();
    const shipping=deliveryFeeForState($("state").value);
    const customer={
      name,
      whatsapp_number:phone,
      email,
      pin_code:pin,
      city:$("city").value.trim(),
      state:$("state").value.trim(),
      address,
      whatsapp_opt_in:$("whatsappReceiptConsent")?.checked===true,
      // Older cached checkouts must never be charged using a different pricing rule.
      pricing_revision:"no-discount-20261111",
      payment_method:"razorpay"
    };
    if(shipping===null){msg("Choose a valid Indian state or union territory for delivery.","error");return;}
    if(!razorpayReady){
      msg("Online payment is temporarily unavailable. Retry the connection before paying.","error");return;
    }
    submitting=true;
    render();
    msg("Starting secure checkout…");
    const items=cart.map(item=>({variant_id:item.variant_id,quantity:Number(item.quantity)}));
    try{
      const result=await beginRazorpayPayment({
        items,
        customer,
        displayTotal:totals().total,
        expectedMode:razorpayMode,
        onPaymentFailed:reason=>msg("Payment failed: "+reason+" You can retry in Razorpay or close checkout.","error")
      });
      if(result.status==="paid"){
        const bagUpdated=removePaidItems(items);
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
          (bagUpdated?"":"<p>Your browser could not update your bag. Review it before your next order.</p>")+
          "<a class='btn btn-light' href='index.html#products'>Continue shopping</a>";
        msg("");
        focusOrderConfirmation(true);
      }else if(result.status==="pending"){
        msg("Payment "+(result.orderNumber?"for order "+result.orderNumber+" ":"")+"is awaiting confirmation. Do not pay again; contact the shop "+(result.orderNumber?"with this order number":"with your payment reference")+" if it remains pending.","error");
      }else{
        msg("Payment window closed. Your order was not confirmed. Check your Razorpay payment status before retrying.");
      }
    }catch(error){
      console.error("Order creation failed.",error);
      msg(error.message||"We could not submit the payment details. Please check the information and try again.","error");
    }finally{
      submitting=false;
      if(cartRefreshPending){cartRefreshPending=false;refreshCart();}
      else if(!$("orderLayout").hidden)render();
    }
  }

  $("clearCart").onclick=()=>{
    if(!submitting&&cartIsCurrent()&&save([])){verifyCart();msg("");}
  };
  $("retryCart").addEventListener("click",refreshCart);
  $("deliveryForm").addEventListener("submit",event=>{event.preventDefault();placeOrder();});
  for(const id of ["name","phone","email","pin","city","state","address"]){
    $(id).addEventListener("input",()=>{$(id).setCustomValidity("");$(id).removeAttribute("aria-invalid");});
  }
  const stateField=$("state");
  for(const state of INDIAN_STATES)stateField.add(new Option(state,state));
  stateField.addEventListener("change",()=>{totals();updatePlaceOrderState();});
  // Postal lookups suggest the district/town and state; customers can correct
  // them. A state change immediately re-runs shipping and CGST/SGST/IGST.
  attachPinAutofill({
    pinInput:$("pin"),cityInput:$("city"),stateInput:stateField,
    statusElement:$("pinLookupStatus"),
    localitySelect:$("pinLocality"),localityWrap:$("pinLocalityWrap")
  });
  refreshCart();
  async function checkGateway(){
    const attempt=++readinessAttempt;
    razorpayReady=false;
    const gateway=$("payRazorpay");
    if(gateway)gateway.disabled=true;
    updatePlaceOrderState();
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
    if(badge)badge.textContent=razorpayMode==="live"?"LIVE":"TEST MODE";
    if(choiceNote)choiceNote.textContent=razorpayMode==="live"?"Real payment · Protected by Razorpay.":"Test only — no real charge.";
    connection?.classList.add(status.available?"is-online":"is-offline");
    if(message)message.textContent=status.message;
    if(indicator)indicator.title=status.available?"Connected":"Not connected";
    if(retry){retry.hidden=status.available;retry.disabled=false;}
    if(gateway){
      gateway.disabled=!status.available;
      gateway.checked=true;
    }
    updatePlaceOrderState();
  }
  $("retryGateway").addEventListener("click",checkGateway);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && !razorpayReady)checkGateway();
  });
  window.addEventListener("storage",event=>{
    if(event.storageArea===localStorage&&(event.key===CART_KEY||event.key===null))refreshCart();
  });
  window.addEventListener("pageshow",event=>{
    if(event.persisted){refreshCart();checkGateway();}
  });
  checkGateway();
})();
