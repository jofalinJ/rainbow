(() => {
  const SUPABASE_CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
  const SUPABASE_URL=String(SUPABASE_CONFIG.supabaseUrl||"").trim();
  const SUPABASE_PUBLISHABLE_KEY=String(SUPABASE_CONFIG.supabasePublishableKey||"").trim();
  let client=null, realtimeChannel=null, realtimeRefreshTimer=null, refreshInterval=null, productsLoading=false, productsReloadRequested=false, catalogueProducts=[], visibleProducts=[], activeCategory="", activeProductId="";

  const esc=value=>String(value??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  const money=value=>"₹"+Number(value||0).toLocaleString("en-IN",{maximumFractionDigits:2});
  const getProductImages=product=>{
    const images=Array.isArray(product.product_images)?product.product_images:[];
    return images.filter(image=>image&&image.public_url)
      .sort((a,b)=>{
        if(Boolean(a.is_primary)!==Boolean(b.is_primary))return a.is_primary?-1:1;
        return Number(a.sort_order||0)-Number(b.sort_order||0);
      }).slice(0,5);
  };
  const getImage=product=>(getProductImages(product)[0]||{}).public_url||"";
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
    const footer=document.querySelector('[data-config="footerBrandText"]');
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

  function normalizeCategory(value){
    return String(value??"")
      .toLocaleLowerCase("en")
      .replace(/&/g," and ")
      .replace(/[\'’]/g,"")
      .replace(/jewellery/g,"jewelry")
      .replace(/[^a-z0-9]+/g," ")
      .trim();
  }

  function categoryMatches(product,category){
    const categoryName=product.categories&&typeof product.categories==="object"
      ?String(product.categories.name||"")
      :"";
    const hasCategoryName=categoryName.trim().length>0;
    const searchable=normalizeCategory([categoryName,product.type,product.product_name].filter(Boolean).join(" "));
    const key=String(category||"").toLocaleLowerCase("en");
    const rules={
      chains:/\bchain\b/,
      necklaces:/\bnecklace(s)?\b/,
      earrings:/\bearring(s)?\b/,
      bangles:/\bbangle(s)?\b/,
      rings:/\bring(s)?\b/,
      "men's jewellery":/\b(men|mens|male)\b/,
      "men’s jewellery":/\b(men|mens|male)\b/
    };
    const matcher=rules[key];
    if(!matcher)return false;
    const designFields=normalizeCategory([product.type,product.product_name].filter(Boolean).join(" "));
    if(key.indexOf("men")===0){
      if(hasCategoryName)return matcher.test(normalizeCategory(categoryName));
      return matcher.test(designFields);
    }
    return matcher.test(normalizeCategory(categoryName))||matcher.test(designFields);
  }

  function render(){
    const grid=document.getElementById("productGrid"),status=document.getElementById("productStatus");
    const heading=document.getElementById("productHeading"),clearButton=document.getElementById("clearProductFilter");
    if(!grid)return;
    const products=activeCategory?catalogueProducts.filter(product=>categoryMatches(product,activeCategory)):catalogueProducts;
    visibleProducts=products;
    if(status)status.textContent=activeCategory
      ?products.length+" "+(products.length===1?"product":"products")+" in "+activeCategory
      :products.length+" product"+(products.length===1?"":"s")+" available";
    if(heading)heading.textContent=activeCategory?"Explore "+activeCategory.toLocaleLowerCase("en")+".":"Our latest products.";
    if(clearButton)clearButton.hidden=!activeCategory;
    grid.innerHTML=products.length?products.map(p=>{
      const stock=getStock(p);
      const stockClass=stock===0?"out":"in";
      const stockText=stock===0?"Out of stock":"In stock";
      const image=getImage(p);
      return '<article class="product-card" tabindex="0" role="button" aria-label="View details for '+esc(p.product_name)+'" data-product-id="'+esc(p.id)+'">'+
        '<div class="product-image">'+(image?'<img src="'+esc(image)+'" alt="'+esc(p.product_name)+'" loading="lazy">':'<div class="placeholder">RG</div>')+'</div>'+
        '<div class="product-body"><div class="product-code">'+esc(p.product_code)+'</div>'+
        '<h3 class="product-name">'+esc(p.product_name)+'</h3><div class="product-type">'+esc((p.categories&&p.categories.name)||p.type||"Jewellery")+'</div>'+
        '<div class="product-meta"><strong class="product-price">'+money(p.selling_price)+'</strong><span class="product-stock '+stockClass+'">'+stockText+'</span></div></div></article>';
    }).join(""):'<div class="product-empty">'+(activeCategory?'No '+esc(activeCategory.toLocaleLowerCase("en"))+' products are currently in stock.':'No products are currently in stock. Please check again soon.')+'</div>';
    grid.querySelectorAll("[data-product-id]").forEach(card=>{
      const open=()=>openProductModal(catalogueProducts.find(p=>String(p.id)===String(card.dataset.productId)));
      card.addEventListener("click",open);
      card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
    });
  }

  function bindCollectionFilters(){
    document.querySelectorAll("[data-filter-type]").forEach(link=>link.addEventListener("click",event=>{
      event.preventDefault();
      activeCategory=link.dataset.filterType||"";
      render();
      document.getElementById("products")?.scrollIntoView({behavior:"smooth",block:"start"});
    }));
    const clearButton=document.getElementById("clearProductFilter");
    if(clearButton)clearButton.addEventListener("click",()=>{
      activeCategory="";
      render();
    });
  }

  function openProductModal(product){
    if(!product)return;
    const modal=document.getElementById("productModal"),content=document.getElementById("productModalContent");
    const panel=modal?.querySelector(".product-modal-panel");
    if(!modal||!content)return;
    activeProductId=String(product.id);
    const images=getProductImages(product);
    const main=images[0]?.public_url||"";
    const activeVariants=(product.product_variants||[]).filter(v=>v.active!==false);
    const stockOf=v=>Math.max(0,Number(v?.stock_quantity||0));
    const cleanOption=value=>{
      const text=String(value??"").trim();
      return !text||text==="0"?"":text;
    };
    const valueFor=(variant,key)=>{
      if(!variant)return "";
      if(key==="length"){
        const raw=variant.length_cm??product.length_cm;
        const n=Number(raw);
        return raw!==null&&raw!==undefined&&Number.isFinite(n)&&n>0?String(n):"";
      }
      return cleanOption(variant[key]);
    };
    const valuesFor=key=>[...new Set(activeVariants.map(v=>valueFor(v,key)).filter(Boolean))];
    const colorOptions=valuesFor("color");
    const sizeOptions=valuesFor("size");
    const lengthOptions=valuesFor("length");
    let selectedVariant=activeVariants.find(v=>stockOf(v)>0)||activeVariants[0]||null;
    const labelForVariant=v=>{
      if(!v)return "Unavailable option";
      const parts=[];
      const color=valueFor(v,"color"),size=valueFor(v,"size"),length=valueFor(v,"length");
      if(color)parts.push("Color: "+color);
      if(size)parts.push("Size: "+size);
      if(length)parts.push("Length: "+length+" cm");
      return parts.join(" · ")||"Standard option";
    };
    const makePicker=(key,label,values,selected)=>{
      if(!values.length)return "";
      return '<label class="variant-picker-label"><span>'+label+'</span><select data-choice="'+key+'" aria-label="Choose '+label.toLowerCase()+'">'+
        values.map(value=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(key==="length"?value+" cm":value)+'</option>').join("")+
      '</select></label>';
    };
    const choiceControls=[
      makePicker("color","Color",colorOptions,valueFor(selectedVariant,"color")),
      makePicker("size","Size",sizeOptions,valueFor(selectedVariant,"size")),
      makePicker("length","Length (cm)",lengthOptions,valueFor(selectedVariant,"length"))
    ].join("");
    const noDimensionChoices=!colorOptions.length&&!sizeOptions.length&&!lengthOptions.length;
    const genericVariantPicker=noDimensionChoices&&activeVariants.length>1
      ?'<label class="variant-picker-label"><span>Available option</span><select data-variant-select aria-label="Choose product option">'+activeVariants.map(v=>'<option value="'+esc(v.id)+'"'+(selectedVariant&&String(selectedVariant.id)===String(v.id)?' selected':'')+(stockOf(v)<=0?' disabled':'')+'>'+esc(labelForVariant(v))+(stockOf(v)<=0?' — Out of stock':'')+'</option>').join("")+'</select></label>'
      :"";
    const category=product.categories&&typeof product.categories==="object"?(product.categories.name||""):product.type||"Jewellery";
    const details=[
      ["Product code",product.product_code],
      ["Category",category],
      ["Thickness",product.thickness],
      ["Gold amount",product.gold_amount_g!=null?product.gold_amount_g+" g":null],
      ["Length",lengthOptions.length?null:(product.length_cm!=null?product.length_cm+" cm":null)]
    ].filter(item=>item[1]!==null&&item[1]!==undefined&&String(item[1]).trim()!=="");
    const galleryHtml='<div class="product-gallery">'+
      '<div class="product-detail-main">'+(main?'<img data-gallery-main src="'+esc(main)+'" alt="'+esc(product.product_name)+'">':'<div class="placeholder">RG</div>')+
        '<span class="gallery-count" data-gallery-count>'+images.length+' / 5 photos</span></div>'+
      (images.length>1?'<div class="product-detail-thumbs">'+images.map((image,i)=>'<button type="button" class="product-detail-thumb'+(i===0?' active':'')+'" data-gallery-src="'+esc(image.public_url)+'" data-gallery-alt="'+esc(product.product_name+' — image '+(i+1))+'" aria-label="View product image '+(i+1)+'"><img src="'+esc(image.public_url)+'" alt="" loading="lazy"></button>').join("")+'</div>':"")+
      '</div>';
    const lengthGuide=lengthOptions.length
      ?'<details class="length-guide"><summary>View length guide</summary><img src="assets/brand/length.png" alt="Jewellery length reference guide" loading="lazy"></details>'
      :"";
    content.innerHTML='<div class="product-detail-grid"><div>'+galleryHtml+'</div>'+
      '<div class="product-detail-info"><span class="section-kicker">PRODUCT DETAILS</span><h2 id="modalProductName">'+esc(product.product_name)+'</h2>'+
      '<div class="modal-price">'+money(product.selling_price)+'</div>'+
      '<span class="product-stock '+(stockOf(selectedVariant)===0?"out":"in")+'" data-variant-status>'+(stockOf(selectedVariant)===0?"Out of stock":"In stock")+'</span>'+
      (product.description?'<p class="modal-description">'+esc(product.description)+'</p>':"")+
      (details.length?'<div class="detail-list">'+details.map(d=>'<div><span>'+esc(d[0])+'</span><strong>'+esc(d[1])+'</strong></div>').join("")+'</div>':"")+
      choiceControls+genericVariantPicker+lengthGuide+
      '<div class="product-buy-actions"><div class="quantity-picker"><button type="button" data-qty-minus aria-label="Decrease quantity">−</button><span data-qty>1</span><button type="button" data-qty-plus aria-label="Increase quantity">＋</button></div><button class="btn btn-light" type="button" data-add-cart>Add to Cart</button><button class="btn btn-dark" type="button" data-buy-now>Buy Now →</button></div></div></div>';

    const qtyEl=content.querySelector("[data-qty]");
    const minus=content.querySelector("[data-qty-minus]"),plus=content.querySelector("[data-qty-plus]");
    const addButton=content.querySelector("[data-add-cart]"),buyButton=content.querySelector("[data-buy-now]");
    const status=content.querySelector("[data-variant-status]");
    let selectedQty=1;
    const updateVariantState=()=>{
      const stock=stockOf(selectedVariant);
      if(status){status.textContent=!selectedVariant?"Unavailable combination":stock===0?"Out of stock":"In stock";status.className="product-stock "+(!selectedVariant||stock===0?"out":"in");}
      if(qtyEl)qtyEl.textContent=String(selectedQty);
      if(minus)minus.disabled=!selectedVariant||stock===0||selectedQty<=1;
      if(plus)plus.disabled=!selectedVariant||stock===0||selectedQty>=stock;
      if(addButton)addButton.disabled=!selectedVariant||stock===0;
      if(buyButton)buyButton.disabled=!selectedVariant||stock===0;
    };
    const choiceSelects=[...content.querySelectorAll("[data-choice]")];
    const applyVariant=v=>{
      if(!v)return;
      selectedVariant=v;
      choiceSelects.forEach(select=>{select.value=valueFor(v,select.dataset.choice);});
      const generic=content.querySelector("[data-variant-select]");
      if(generic)generic.value=String(v.id);
    };
    const matchingScore=(variant,selected)=>choiceSelects.reduce((score,select)=>score+(valueFor(variant,select.dataset.choice)===selected[select.dataset.choice]?1:0),0);
    const syncVariant=changedKey=>{
      const selected={};
      choiceSelects.forEach(select=>{selected[select.dataset.choice]=select.value;});
      let candidates=activeVariants.filter(variant=>choiceSelects.every(select=>valueFor(variant,select.dataset.choice)===selected[select.dataset.choice]));
      if(!candidates.length&&changedKey){
        candidates=activeVariants.filter(variant=>valueFor(variant,changedKey)===selected[changedKey]);
        candidates.sort((a,b)=>(matchingScore(b,selected)-matchingScore(a,selected))||(stockOf(b)-stockOf(a)));
      }
      if(!candidates.length)candidates=activeVariants.slice().sort((a,b)=>stockOf(b)-stockOf(a));
      const next=candidates.find(v=>stockOf(v)>0)||candidates[0]||null;
      selectedVariant=next;
      if(next)applyVariant(next);
      selectedQty=1;
      updateVariantState();
    };
    choiceSelects.forEach(select=>select.addEventListener("change",()=>syncVariant(select.dataset.choice)));
    const generic=content.querySelector("[data-variant-select]");
    if(generic)generic.addEventListener("change",()=>{
      selectedVariant=activeVariants.find(v=>String(v.id)===String(generic.value))||null;
      selectedQty=1;updateVariantState();
    });
    content.querySelectorAll("[data-gallery-src]").forEach(button=>button.addEventListener("click",()=>{
      const image=content.querySelector("[data-gallery-main]");
      if(image){image.src=button.dataset.gallerySrc;image.alt=button.dataset.galleryAlt||product.product_name;}
      content.querySelectorAll("[data-gallery-src]").forEach(item=>item.classList.toggle("active",item===button));
    }));
    minus.onclick=()=>{selectedQty=Math.max(1,selectedQty-1);updateVariantState();};
    plus.onclick=()=>{selectedQty=Math.min(Math.max(1,stockOf(selectedVariant)),selectedQty+1);updateVariantState();};
    const makeCartItem=quantity=>({
      variant_id:selectedVariant.id,
      quantity,
      variant_label:labelForVariant(selectedVariant),
      product:{
        id:product.id,product_code:product.product_code,product_name:product.product_name,type:product.type,
        selling_price:product.selling_price,description:product.description,image:main,
        variant_color:valueFor(selectedVariant,"color")||null,
        variant_size:valueFor(selectedVariant,"size")||null,
        variant_length_cm:valueFor(selectedVariant,"length")||null
      }
    });
    const addSelectedToCart=replace=>{
      const stock=stockOf(selectedVariant);
      if(!selectedVariant||stock<=0){if(status)status.textContent="This option is out of stock.";return;}
      const cart=getCart();
      if(replace){saveCart([makeCartItem(Math.min(selectedQty,stock))]);location.href="order.html";return;}
      const existing=cart.find(item=>String(item.variant_id)===String(selectedVariant.id));
      const oldQty=Number(existing?.quantity||0);
      if(oldQty>=stock){if(status)status.textContent="The cart already contains all available stock for this option.";return;}
      const next=Math.min(stock,oldQty+selectedQty);
      if(existing){existing.quantity=next;existing.variant_label=labelForVariant(selectedVariant);existing.product=makeCartItem(next).product;}
      else cart.push(makeCartItem(next));
      saveCart(cart);
      if(status)status.textContent="Added to cart.";
      closeProductModal();
    };
    addButton.onclick=()=>addSelectedToCart(false);
    buyButton.onclick=()=>addSelectedToCart(true);
    updateVariantState();
    if(panel)panel.scrollTop=0;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    document.body.classList.add("modal-open");
    updateProductNavigation();
  }

  function updateProductNavigation(){
    const previous=document.querySelector("[data-product-prev]");
    const next=document.querySelector("[data-product-next]");
    const show=visibleProducts.length>1&&document.getElementById("productModal")?.classList.contains("open");
    [previous,next].forEach(button=>{if(button)button.hidden=!show;});
  }

  function navigateProduct(step){
    if(!visibleProducts.length)return;
    const currentIndex=visibleProducts.findIndex(product=>String(product.id)===String(activeProductId));
    const base=currentIndex<0?0:currentIndex;
    const nextIndex=(base+step+visibleProducts.length)%visibleProducts.length;
    openProductModal(visibleProducts[nextIndex]);
  }

  function closeProductModal(){
    const modal=document.getElementById("productModal");if(!modal)return;
    modal.classList.remove("open");modal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open");activeProductId="";updateProductNavigation();
  }
  function bindProductModal(){
    document.querySelectorAll("[data-close-product]").forEach(el=>el.addEventListener("click",closeProductModal));
    document.querySelector("[data-product-prev]")?.addEventListener("click",()=>navigateProduct(-1));
    document.querySelector("[data-product-next]")?.addEventListener("click",()=>navigateProduct(1));
    document.addEventListener("keydown",e=>{
      const modal=document.getElementById("productModal");
      if(e.key==="Escape")closeProductModal();
      if(!modal?.classList.contains("open"))return;
      if(["INPUT","TEXTAREA","SELECT"].includes(e.target?.tagName))return;
      if(e.key==="ArrowLeft"){e.preventDefault();navigateProduct(-1);}
      if(e.key==="ArrowRight"){e.preventDefault();navigateProduct(1);}
    });
    let touchStartX=null;
    const modal=document.getElementById("productModal");
    modal?.addEventListener("touchstart",event=>{touchStartX=event.changedTouches?.[0]?.clientX??null;},{passive:true});
    modal?.addEventListener("touchend",event=>{
      const end=event.changedTouches?.[0]?.clientX;
      if(touchStartX===null||end===undefined)return;
      const delta=end-touchStartX;
      if(Math.abs(delta)>70)navigateProduct(delta<0?1:-1);
      touchStartX=null;
    },{passive:true});
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
        .select("id,product_code,product_name,type,category_id,categories(name),selling_price,description,length_cm,thickness,gold_amount_g,created_at,product_variants(id,stock_quantity,color,size,length_cm,active),product_images(id,public_url,is_primary,sort_order)")
        .eq("active",true).order("created_at",{ascending:false});
      if(error)throw error;
      const stockedProducts=(data||[]).filter(product=>getStock(product)>0);
      catalogueProducts=stockedProducts;
      if(activeProductId&&!stockedProducts.some(product=>String(product.id)===String(activeProductId)))closeProductModal();
      render();
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
    bindCollectionFilters();
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