(() => {
  const SUPABASE_CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
  const SUPABASE_URL=String(SUPABASE_CONFIG.supabaseUrl||"").trim();
  const SUPABASE_PUBLISHABLE_KEY=String(SUPABASE_CONFIG.supabasePublishableKey||"").trim();
  let client=null, realtimeChannel=null, realtimeRefreshTimer=null, refreshInterval=null, productsLoading=false, productsReloadRequested=false;

  const esc=value=>String(value??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  const money=value=>"₹"+Number(value||0).toLocaleString("en-IN",{maximumFractionDigits:2});
  const getImage=product=>{
    const images=Array.isArray(product.product_images)?product.product_images:[];
    return (images.find(x=>x.is_primary)||images[0]||{}).public_url||"";
  };
  const CART_KEY="rainbow_cart_v1";
  const getCart=()=>{try{return JSON.parse(localStorage.getItem(CART_KEY)||"[]")}catch{return[]}};
  const saveCart=items=>{localStorage.setItem(CART_KEY,JSON.stringify(items));updateCartCount()};
  const updateCartCount=()=>{const el=document.getElementById("cartCount");if(el)el.textContent=getCart().reduce((n,x)=>n+Number(x.quantity||0),0)};
  const getStock=product=>(Array.isArray(product.product_variants)?product.product_variants:[])
    .filter(v=>v.active!==false).reduce((sum,v)=>sum+Number(v.stock_quantity||0),0);

  function applyBusinessConfig(){
    const cfg=window.RAINBOW_BUSINESS_CONFIG;
    if(!cfg)return;
    const brand=document.querySelector('[data-config="brandName"]');
    const eyebrow=document.querySelector('[data-config="eyebrow"]');
    const footer=document.querySelector('[data-config="footerBrand"]');
    if(brand)brand.textContent=(cfg.businessName||"Rainbow").split(" ")[0].toUpperCase();
    if(eyebrow)eyebrow.textContent=(cfg.businessName||"Rainbow Gold Covering").toUpperCase()+" · "+(cfg.trustLine||"");
    if(footer)footer.textContent=cfg.businessName||"Rainbow Gold Covering";
    const branches=document.getElementById("branchList");
    if(branches&&Array.isArray(cfg.branches)){
      branches.innerHTML=cfg.branches.map(b=>
        '<div class="branch"><strong>'+esc(b.name)+'</strong><span>'+esc(b.address)+'</span><a href="'+esc(b.mapUrl)+'" target="_blank" rel="noopener noreferrer">Open in Maps →</a></div>'
      ).join("");
    }
    document.title=(cfg.businessName||"Rainbow Gold Covering")+" — Jewellery, Made to Shine";
  }

  function render(products){
    const grid=document.getElementById("productGrid"),status=document.getElementById("productStatus");
    if(!grid)return;
    status.textContent=products.length+" product"+(products.length===1?"":"s")+" available";
    grid.innerHTML=products.length?products.map(p=>{
      const stock=getStock(p);
      const stockClass=stock===0?"out":"in";
      const stockText=stock===0?"Out of stock":"In stock";
      const image=getImage(p);
      return '<article class="product-card" tabindex="0" role="button" aria-label="View details for '+esc(p.product_name)+'" data-product-id="'+esc(p.id)+'">'+
        '<div class="product-image">'+(image?'<img src="'+esc(image)+'" alt="'+esc(p.product_name)+'" loading="lazy">':'<div class="placeholder">RG</div>')+'</div>'+
        '<div class="product-body"><div class="product-code">'+esc(p.product_code)+'</div>'+
        '<h3 class="product-name">'+esc(p.product_name)+'</h3><div class="product-type">'+esc(p.type||"Jewellery")+'</div>'+
        '<div class="product-meta"><strong class="product-price">'+money(p.selling_price)+'</strong><span class="product-stock '+stockClass+'">'+stockText+'</span></div></div></article>';
    }).join(""):'<div class="product-empty">No products are available yet.</div>';
    grid.querySelectorAll("[data-product-id]").forEach(card=>{
      const open=()=>openProductModal(products.find(p=>String(p.id)===String(card.dataset.productId)));
      card.addEventListener("click",open);
      card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
    });
  }

  function openProductModal(product){
    if(!product)return;
    const modal=document.getElementById("productModal"),content=document.getElementById("productModalContent");
    if(!modal||!content)return;
    const images=Array.isArray(product.product_images)?product.product_images:[];
    const main=getImage(product);
    const activeVariants=(product.product_variants||[]).filter(v=>v.active!==false);
    const labelForVariant=(v,index)=>{
      const details=[];
      if(v.color!=null&&String(v.color)!=="0"&&String(v.color).trim()!=="")details.push("Color: "+String(v.color));
      if(v.size!=null&&String(v.size)!=="0"&&String(v.size).trim()!=="")details.push("Size: "+String(v.size));
      let label=details.join(" · ")||"Standard option";
      const sameLabel=activeVariants.filter(x=>String(x.color??"0")===String(v.color??"0")&&String(x.size??"0")===String(v.size??"0"));
      if(sameLabel.length>1)label+=" (Option "+(index+1)+")";
      return label;
    };
    let selectedVariant=activeVariants.find(v=>Number(v.stock_quantity||0)>0)||activeVariants[0]||null;
    const stockOf=v=>Math.max(0,Number(v?.stock_quantity||0));
    const details=[
      ["Product code",product.product_code],
      ["Category",product.type||"Jewellery"],
      ["Description",product.description],
      ["Thickness",product.thickness],
      ["Length",product.length_cm!=null?product.length_cm+" cm":null],
      ["Gold amount",product.gold_amount_g!=null?product.gold_amount_g+" g":null]
    ].filter(x=>x[1]!==null&&x[1]!==undefined&&String(x[1]).trim()!=="");
    const variantPicker=activeVariants.length>1
      ? '<label class="variant-picker-label"><span>Choose options</span><select data-variant-select aria-label="Choose size or color">'+activeVariants.map((v,i)=>'<option value="'+esc(v.id)+'"'+(selectedVariant&&String(v.id)===String(selectedVariant.id)?' selected':'')+(stockOf(v)<=0?' disabled':'')+'>'+esc(labelForVariant(v,i))+(stockOf(v)<=0?' — Out of stock':'')+'</option>').join("")+'</select></label>'
      : "";
    content.innerHTML='<div class="product-detail-grid"><div><div class="product-detail-main">'+(main?'<img src="'+esc(main)+'" alt="'+esc(product.product_name)+'">':'<div class="placeholder">RG</div>')+'</div>'+(images.length>1?'<div class="product-detail-thumbs">'+images.map(i=>'<img src="'+esc(i.public_url||"")+'" alt="" loading="lazy">').join("")+'</div>':"")+'</div><div class="product-detail-info"><span class="section-kicker">PRODUCT DETAILS</span><h2 id="modalProductName">'+esc(product.product_name)+'</h2><div class="modal-price">'+money(product.selling_price)+'</div><span class="product-stock '+(stockOf(selectedVariant)===0?"out":"in")+'" data-variant-status>'+(stockOf(selectedVariant)===0?"Out of stock":"In stock")+'</span>'+(product.description?'<p class="modal-description">'+esc(product.description)+'</p>':"")+(details.length?'<div class="detail-list">'+details.map(d=>'<div><span>'+esc(d[0])+'</span><strong>'+esc(d[1])+'</strong></div>').join("")+'</div>':"")+variantPicker+'<div class="product-buy-actions"><div class="quantity-picker"><button type="button" data-qty-minus aria-label="Decrease quantity">−</button><span data-qty>1</span><button type="button" data-qty-plus aria-label="Increase quantity">＋</button></div><button class="btn btn-light" type="button" data-add-cart>Add to Cart</button><button class="btn btn-dark" type="button" data-buy-now>Buy Now →</button></div></div></div>';
    let selectedQty=1;
    const qtyEl=content.querySelector("[data-qty]");
    const minus=content.querySelector("[data-qty-minus]"),plus=content.querySelector("[data-qty-plus]");
    const addButton=content.querySelector("[data-add-cart]"),buyButton=content.querySelector("[data-buy-now]");
    const status=content.querySelector("[data-variant-status]");
    const updateVariantState=()=>{
      const stock=stockOf(selectedVariant);
      if(status){status.textContent=stock===0?"Out of stock":"In stock";status.className="product-stock "+(stock===0?"out":"in");}
      if(qtyEl)qtyEl.textContent=String(selectedQty);
      if(minus)minus.disabled=stock===0||selectedQty<=1;
      if(plus)plus.disabled=stock===0||selectedQty>=stock;
      if(addButton)addButton.disabled=stock===0;
      if(buyButton)buyButton.disabled=stock===0;
    };
    minus.onclick=()=>{selectedQty=Math.max(1,selectedQty-1);updateVariantState()};
    plus.onclick=()=>{selectedQty=Math.min(Math.max(1,stockOf(selectedVariant)),selectedQty+1);updateVariantState()};
    const select=content.querySelector("[data-variant-select]");
    if(select)select.addEventListener("change",()=>{
      selectedVariant=activeVariants.find(v=>String(v.id)===String(select.value))||null;
      selectedQty=1;
      updateVariantState();
    });
    const makeCartItem=quantity=>({
      variant_id:selectedVariant.id,
      quantity,
      variant_label:labelForVariant(selectedVariant,activeVariants.indexOf(selectedVariant)),
      product:{
        id:product.id,
        product_code:product.product_code,
        product_name:product.product_name,
        type:product.type,
        selling_price:product.selling_price,
        description:product.description,
        image:main,
        variant_color:selectedVariant.color&&String(selectedVariant.color)!=="0"?selectedVariant.color:null,
        variant_size:selectedVariant.size&&String(selectedVariant.size)!=="0"?selectedVariant.size:null
      }
    });
    const addSelectedToCart=(replace)=>{
      const stock=stockOf(selectedVariant);
      if(!selectedVariant||stock<=0){if(status)status.textContent="This option is out of stock.";return;}
      const cart=getCart();
      if(replace){
        saveCart([makeCartItem(Math.min(selectedQty,stock))]);
        location.href="order.html";
        return;
      }
      const existing=cart.find(x=>String(x.variant_id)===String(selectedVariant.id));
      const oldQty=Number(existing?.quantity||0);
      if(oldQty>=stock){if(status)status.textContent="The cart already contains all available stock for this option.";return;}
      const next=Math.min(stock,oldQty+selectedQty);
      if(existing){
        existing.quantity=next;
        existing.variant_label=labelForVariant(selectedVariant,activeVariants.indexOf(selectedVariant));
        existing.product=makeCartItem(next).product;
      }else cart.push(makeCartItem(next));
      saveCart(cart);
      if(status)status.textContent="Added to cart.";
      closeProductModal();
    };
    addButton.onclick=()=>addSelectedToCart(false);
    buyButton.onclick=()=>addSelectedToCart(true);
    updateVariantState();
    modal.classList.add("open");modal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");
  }
  function closeProductModal(){
    const modal=document.getElementById("productModal");if(!modal)return;
    modal.classList.remove("open");modal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open");
  }
  function bindProductModal(){
    document.querySelectorAll("[data-close-product]").forEach(el=>el.addEventListener("click",closeProductModal));
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeProductModal();});
  }

  function scheduleCatalogRefresh(){
    if(realtimeRefreshTimer)window.clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer=window.setTimeout(()=>{
      realtimeRefreshTimer=null;
      loadProducts();
    },250);
  }

  async function loadProducts(){
    if(productsLoading){productsReloadRequested=true;return;}
    productsLoading=true;
    const status=document.getElementById("productStatus");
    try{
      const {data,error}=await client.from("products")
        .select("id,product_code,product_name,type,selling_price,description,length_cm,thickness,gold_amount_g,created_at,product_variants(id,stock_quantity,color,size,active),product_images(public_url,is_primary)")
        .eq("active",true).order("created_at",{ascending:false});
      if(error)throw error;
      render(data||[]);
    }catch(error){
      console.error(error);
      if(status)status.textContent="Products are temporarily unavailable.";
    }finally{
      productsLoading=false;
      if(productsReloadRequested){productsReloadRequested=false;scheduleCatalogRefresh();}
    }
  }
  function startRealtime(){
    if(!client||realtimeChannel)return;
    realtimeChannel=client.channel("customer-product-catalogue")
      .on("postgres_changes",{event:"*",schema:"public",table:"products"},scheduleCatalogRefresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"product_variants"},scheduleCatalogRefresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"product_images"},scheduleCatalogRefresh)
      .subscribe();
  }

  async function init(){
    applyBusinessConfig();
    updateCartCount();
    bindProductModal();
    document.querySelectorAll("[data-scroll]").forEach(button=>button.addEventListener("click",()=>{
      document.querySelector(button.dataset.scroll)?.scrollIntoView({behavior:"smooth"});
    }));
    const year=document.getElementById("year");if(year)year.textContent=new Date().getFullYear();
    if(!window.supabase?.createClient||!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY){const status=document.getElementById("productStatus");if(status)status.textContent="The product catalogue is temporarily unavailable.";return;}
    client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
    await loadProducts();
    startRealtime();
    // Fallback refresh keeps the catalogue current even if realtime is temporarily unavailable.
    refreshInterval=window.setInterval(scheduleCatalogRefresh,30000);
    window.addEventListener("pagehide",()=>{
      if(refreshInterval)window.clearInterval(refreshInterval);
      if(realtimeRefreshTimer)window.clearTimeout(realtimeRefreshTimer);
      if(client&&realtimeChannel)client.removeChannel(realtimeChannel);
      realtimeChannel=null;
    },{once:true});
  }
  init();
})();