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
  let deliveryFee=null;
  let deliveryRates=[];
  let deliveryRatesLoaded=false;
  let cartVerified=false;
  let cartVerificationFailed=false;
  let submitting=false;

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
    if(el)el.textContent=cart.reduce((n,x)=>n+Number(x.quantity||0),0);
  }
  function msg(text,kind=""){
    const el=$("orderMsg");
    if(el){el.textContent=text;el.className="order-msg "+kind;}
  }
  function phoneLooksValid(phone){
    const digits=String(phone||"").replace(/\D/g,"");
    return digits.length>=10&&digits.length<=13;
  }
  function distanceValue(){
    const raw=$("distance").value.trim();
    if(!raw)return null;
    const number=Number(raw);
    if(!Number.isFinite(number)||number<0||number>500)return NaN;
    return number===0?null:number;
  }
  function matchingRate(distance){
    return deliveryRates
      .filter(rate=>Number(rate.min_km)<=distance&&(rate.max_km==null||Number(rate.max_km)>=distance))
      .sort((a,b)=>Number(b.min_km)-Number(a.min_km))[0]||null;
  }
  function updateDeliveryPreview(){
    const distance=distanceValue();
    const note=$("deliveryNote");
    if(Number.isNaN(distance)){
      deliveryFee=null;
      if(note)note.textContent="Enter a distance from 0 to 500 km, or leave it empty so the shop can confirm delivery.";
    }else if(distance==null){
      deliveryFee=null;
      if(note)note.textContent="No distance rate is applied. The displayed total excludes delivery; the shop will confirm the delivery fee.";
    }else if(!deliveryRatesLoaded){
      deliveryFee=null;
      if(note)note.textContent="Checking the active delivery rates…";
    }else{
      const rate=matchingRate(distance);
      if(rate){
        deliveryFee=Math.max(0,Number(rate.fee||0));
        if(note)note.textContent="Delivery fee matched to the store's active rate for "+distance+" km.";
      }else{
        deliveryFee=null;
        if(note)note.textContent="No active delivery rate covers "+distance+" km. Clear the distance field so the shop can confirm the delivery fee.";
      }
    }
    totals();
    updatePlaceOrderState();
  }
  function totals(){
    const subtotal=roundMoney(cart.reduce((sum,item)=>sum+Number(item.product.selling_price||0)*Number(item.quantity||0),0));
    const discount=roundMoney(subtotal*.03);
    const taxable=roundMoney(subtotal-discount);
    const cgst=roundMoney(taxable*.015);
    const sgst=roundMoney(taxable*.015);
    const total=roundMoney(taxable+cgst+sgst+(deliveryFee??0));
    $("subtotal").textContent=money(subtotal);
    $("discount").textContent=money(discount);
    $("cgst").textContent=money(cgst);
    $("sgst").textContent=money(sgst);
    $("delivery").textContent=deliveryFee==null?"Fee confirmed by store":money(deliveryFee);
    $("total").textContent=money(total);
    $("totalLabel").textContent=deliveryFee==null?"Total before delivery":"Total including delivery";
    return {subtotal,discount,cgst,sgst,total};
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
    const distance=distanceValue();
    const distanceInvalid=Number.isNaN(distance);
    const rateRequired=distance!=null;
    const noRate=rateRequired&&(!deliveryRatesLoaded||!matchingRate(distance));
    const invalidStock=cart.some(item=>!cartItemHasStock(item));
    button.disabled=submitting||cart.length===0||distanceInvalid||noRate||invalidStock||(!cartVerified&&cart.length>0)||cartVerificationFailed;
  }
  async function verifyCart(){
    if(!cart.length){cartVerified=true;render();return;}
    if(!sb){
      cartVerificationFailed=true;
      msg("Checkout is temporarily unavailable. Please try again later.","error");
      render();
      return;
    }
    msg("Checking current product prices and stock…");
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
  async function loadDeliveryRates(){
    if(!sb){deliveryRatesLoaded=true;updateDeliveryPreview();return;}
    try{
      const {data,error}=await sb.from("delivery_rates")
        .select("min_km,max_km,fee").eq("active",true).order("min_km",{ascending:true});
      if(error)throw error;
      deliveryRates=Array.isArray(data)?data:[];
      deliveryRatesLoaded=true;
    }catch(error){
      console.warn("Delivery rates could not be loaded.",error);
      deliveryRates=[];
      deliveryRatesLoaded=false;
    }
    updateDeliveryPreview();
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
    const customer={
      name,
      whatsapp_number:phone,
      email,
      pin_code:pin,
      city:$("city").value.trim(),
      state:$("state").value.trim(),
      address
    };
    if(!name||!phone||!address){msg("Name, WhatsApp number and delivery address are required.","error");return;}
    if(!phoneLooksValid(phone)){msg("Enter a valid WhatsApp number, including country code if needed.","error");return;}
    if(pin&&!/^\d{6}$/.test(pin)){msg("Enter a valid 6-digit PIN code.","error");return;}
    const distance=distanceValue();
    if(Number.isNaN(distance)){msg("Enter a distance from 0 to 500 km, or leave it empty.","error");return;}
    if(distance!=null&&(!deliveryRatesLoaded||!matchingRate(distance))){
      msg("No active delivery rate covers this distance. Clear the distance field so the shop can confirm the fee.","error");return;
    }
    submitting=true;
    $("placeOrder").textContent="Placing order…";
    updatePlaceOrderState();
    msg("Placing your order…");
    try{
      const {data,error}=await sb.rpc("create_online_order",{
        p_items:cart.map(item=>({variant_id:item.variant_id,quantity:Number(item.quantity)})),
        p_customer:customer,
        p_delivery_distance_km:distance
      });
      if(error)throw error;
      cart=[];
      save();
      $("orderLayout").hidden=true;
      $("orderSuccess").hidden=false;
      $("orderSuccess").innerHTML='<h2>Order received.</h2><p>Your order number is <strong>'+esc(data.order_number)+'</strong>.</p><p>Total before any separately confirmed delivery charge: <strong>'+money(data.total_amount)+'</strong>. Rainbow Gold Covering will contact you on WhatsApp to confirm the order and delivery details.</p><a class="btn btn-dark" href="index.html#products">Continue Shopping</a>';
      const overlay=$("successOverlay");if(overlay){$("successOrderNumber").textContent="Order number: "+String(data.order_number||"");$("successOrderText").textContent="Order total: "+money(data.total_amount)+". Thank you for choosing Rainbow Gold Covering — we’ll contact you to confirm delivery details.";overlay.hidden=false;document.body.classList.add("order-success-open");$("successContinue").focus();}
      msg("");
    }catch(error){
      console.error("Order creation failed.",error);
      msg(error.message||"We could not place the order. Please try again.","error");
    }finally{
      submitting=false;
      $("placeOrder").textContent="Place Order →";
      updatePlaceOrderState();
    }
  }
  const successContinue=$("successContinue");if(successContinue)successContinue.onclick=()=>{window.location.href="index.html#products";};
  const successOverlay=$("successOverlay");if(successOverlay)successOverlay.addEventListener("click",event=>{if(event.target===successOverlay){successOverlay.hidden=true;document.body.classList.remove("order-success-open");}});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&successOverlay&&!successOverlay.hidden){successOverlay.hidden=true;document.body.classList.remove("order-success-open");}});
  $("clearCart").onclick=()=>{cart=[];cartVerified=true;cartVerificationFailed=false;save();render();msg("");};
  $("distance").oninput=updateDeliveryPreview;
  $("placeOrder").onclick=placeOrder;
  read();
  render();
  loadDeliveryRates();
  verifyCart();
})();