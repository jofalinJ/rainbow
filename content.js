(() => {
  const SUPABASE_CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
  const SUPABASE_URL=String(SUPABASE_CONFIG.supabaseUrl||"").trim();
  const SUPABASE_PUBLISHABLE_KEY=String(SUPABASE_CONFIG.supabasePublishableKey||"").trim();
  let client=null, realtimeChannel=null, realtimeRefreshTimer=null, refreshInterval=null, productsLoading=false, productsReloadRequested=false, catalogueProducts=[], visibleProducts=[], activeCategory="", activeProductId="";
  const WISHLIST_KEY="rainbow_wishlist_v1";
  let activeSearch="",activeSegment="all",wishlistOnly=false,visualSearchSignature=null,visualSearchScores=new Map(),speechRecognition=null;
  const wishlistIds=new Set(readWishlist());
  const visualSignatureCache=new Map();

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
  function readWishlist(){try{const value=JSON.parse(localStorage.getItem(WISHLIST_KEY)||"[]");return Array.isArray(value)?value.map(String):[]}catch{return[];}}
  function saveWishlist(){try{localStorage.setItem(WISHLIST_KEY,JSON.stringify([...wishlistIds]));}catch{}updateWishlistCount();}
  function updateWishlistCount(){const badge=document.getElementById("wishlistCount");if(badge){badge.textContent=String(wishlistIds.size);badge.hidden=wishlistIds.size===0;}const button=document.getElementById("wishlistToggle");if(button){button.setAttribute("aria-pressed",String(wishlistOnly));button.classList.toggle("is-selected",wishlistOnly);}}
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

  function categoryFor(product){
    const categoryName=product.categories&&typeof product.categories==="object"
      ?String(product.categories.name||"").trim()
      :"";
    return categoryName||String(product.type||"").trim()||"Jewellery";
  }

  function categoryBuckets(){
    const labels=new Map();
    catalogueProducts.forEach(product=>{
      const label=categoryFor(product),key=normalizeCategory(label);
      if(key&&!labels.has(key))labels.set(key,{label,products:[]});
      if(key)labels.get(key).products.push(product);
    });
    return [...labels.values()].sort((a,b)=>a.label.localeCompare(b.label,"en"));
  }
  function renderCategorySidebar(){
    const sidebar=document.getElementById("drawerCategories");
    if(!sidebar)return;
    const buckets=categoryBuckets();
    const groups=[
      {title:"Chains",matches:b=>/chain/.test(normalizeCategory(b.label))},
      {title:"Everyday jewellery",matches:b=>/(anklet|bracelet|bangle|ring)/.test(normalizeCategory(b.label))},
      {title:"Occasion & statement",matches:b=>/(earring|necklace|dollar|pendant)/.test(normalizeCategory(b.label))},
      {title:"Men's collection",matches:b=>/(men|mens|male)/.test(normalizeCategory(b.label))}
    ];
    const used=new Set();
    const makeCard=b=>{
      const item=b.products.find(product=>getImage(product))||b.products[0];
      const src=item?getImage(item):"";
      return '<button type="button" class="drawer-subcategory" data-filter-type="'+esc(b.label)+'" aria-label="Browse '+esc(b.label)+'">'+
        (src?'<img src="'+esc(src)+'" alt="" loading="lazy">':'<span class="drawer-subcategory-placeholder" aria-hidden="true">RG</span>')+
        '<span>'+esc(b.label)+'</span></button>';
    };
    const groupMarkup=groups.map(group=>{
      const items=buckets.filter(b=>group.matches(b));
      if(!items.length)return "";
      items.forEach(b=>used.add(normalizeCategory(b.label)));
      return '<details class="drawer-accordion"><summary>'+esc(group.title)+'</summary><div class="drawer-subcategory-grid">'+items.map(makeCard).join("")+'</div></details>';
    }).join("");
    const remaining=buckets.filter(b=>!used.has(normalizeCategory(b.label)));
    const others=remaining.length?'<details class="drawer-accordion" open><summary>More to explore</summary><div class="drawer-subcategory-grid">'+remaining.map(makeCard).join("")+'</div></details>':"";
    sidebar.innerHTML='<button type="button" class="drawer-all-category" data-filter-type="">All jewellery <span>'+catalogueProducts.length+'</span></button>'+(groupMarkup||"")+others+
      (buckets.length?"":'<div class="drawer-empty">Your categories will appear here as products are added and stocked.</div>');
  }
  function renderFeaturedCollections(){
    const target=document.getElementById("drawerFeatured");
    if(!target)return;
    const picks=categoryBuckets().sort((a,b)=>b.products.length-a.products.length).slice(0,4);
    target.innerHTML=picks.map(bucket=>{
      const product=bucket.products.find(p=>getImage(p))||bucket.products[0];
      const image=product?getImage(product):"";
      return '<button type="button" class="drawer-featured-card" data-filter-type="'+esc(bucket.label)+'">'+
        (image?'<img src="'+esc(image)+'" alt="" loading="lazy">':'<span class="drawer-featured-placeholder" aria-hidden="true">RG</span>')+
        '<strong>'+esc(bucket.label)+'</strong><small>'+bucket.products.length+' design'+(bucket.products.length===1?"":"s")+'</small></button>';
    }).join("")||'<div class="drawer-empty">Featured picks will appear here when catalogue products are available.</div>';
  }
  function isMenProduct(product){
    return /(men|mens|male)/.test(normalizeCategory([categoryFor(product),product.type,product.product_name].join(" ")));
  }
  function matchesTextSearch(product,query){
    if(!query)return true;
    const haystack=normalizeCategory([product.product_name,product.type,categoryFor(product),product.description].filter(Boolean).join(" "));
    const tokens=normalizeCategory(query).split(/\s+/).filter(Boolean);
    return tokens.every(token=>haystack.includes(token));
  }

  function render(){
    const grid=document.getElementById("productGrid"),status=document.getElementById("productStatus");
    const heading=document.getElementById("productHeading"),clearButton=document.getElementById("clearProductFilter");
    if(!grid)return;
    renderCategorySidebar();
    renderFeaturedCollections();
    let products=catalogueProducts.filter(product=>{
      if(activeCategory&&normalizeCategory(categoryFor(product))!==normalizeCategory(activeCategory))return false;
      if(activeSegment==="men"&&!isMenProduct(product))return false;
      if(activeSegment==="women"&&isMenProduct(product))return false;
      if(!matchesTextSearch(product,activeSearch))return false;
      if(wishlistOnly&&!wishlistIds.has(String(product.id)))return false;
      return true;
    });
    if(activeSegment==="new")products=products.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    if(visualSearchSignature)products=products.slice().sort((a,b)=>(visualSearchScores.get(String(b.id))??-1)-(visualSearchScores.get(String(a.id))??-1));
    visibleProducts=products;
    if(status){
      if(visualSearchSignature)status.textContent=products.length+" visual matches - ranked by dominant image colours";
      else if(wishlistOnly)status.textContent=products.length+" saved item"+(products.length===1?"":"s");
      else if(activeSearch)status.textContent=products.length+" result"+(products.length===1?"":"s")+" for \""+activeSearch+"\"";
      else if(activeCategory)status.textContent=products.length+" "+(products.length===1?"product":"products")+" in "+activeCategory;
      else if(activeSegment==="new")status.textContent=products.length+" latest design"+(products.length===1?"":"s");
      else status.textContent=products.length+" product"+(products.length===1?"":"s")+" available";
    }
    if(heading)heading.textContent=wishlistOnly?"Your wishlist":activeSearch?"Search results":visualSearchSignature?"Visual matches":activeCategory?"Explore "+activeCategory.toLowerCase()+".":activeSegment==="men"?"Men's jewellery":activeSegment==="women"?"Women's jewellery":activeSegment==="new"?"New in":"Shop jewellery.";
    if(clearButton)clearButton.hidden=!(activeCategory||activeSearch||visualSearchSignature||wishlistOnly||activeSegment!=="all");
    document.querySelectorAll("[data-segment]").forEach(button=>{
      const active=button.dataset.segment===activeSegment;
      button.classList.toggle("is-active",active);button.setAttribute("aria-pressed",String(active));
    });
    const wishlistButton=document.getElementById("wishlistToggle");
    if(wishlistButton){wishlistButton.setAttribute("aria-pressed",String(wishlistOnly));wishlistButton.classList.toggle("is-selected",wishlistOnly);}
    grid.innerHTML=products.length?products.map(p=>{
      const stock=getStock(p),stockClass=stock===0?"out":"in",stockText=stock===0?"Out of stock":"In stock",image=getImage(p);
      const saved=wishlistIds.has(String(p.id));
      return '<article class="product-card" tabindex="0" role="button" aria-label="View details for '+esc(p.product_name)+'" data-product-id="'+esc(p.id)+'">'+
        '<div class="product-image">'+(image?'<img src="'+esc(image)+'" alt="'+esc(p.product_name)+'" loading="lazy">':'<div class="placeholder">RG</div>')+
        '<button type="button" class="product-wishlist-button'+(saved?' is-saved':'')+'" data-wishlist-product="'+esc(p.id)+'" aria-label="'+(saved?"Remove ":"Add ")+esc(p.product_name)+(saved?" from":" to")+' wishlist" aria-pressed="'+saved+'">'+(saved?"♥":"♡")+'</button></div>'+
        '<div class="product-body"><h3 class="product-name">'+esc(p.product_name)+'</h3><div class="product-type">'+esc(categoryFor(p))+'</div>'+
        '<div class="product-meta"><strong class="product-price">'+money(p.selling_price)+'</strong><span class="product-stock '+stockClass+'">'+stockText+'</span></div></div></article>';
    }).join(""):'<div class="product-empty">'+(wishlistOnly?'No saved items yet. Tap the heart on a product to add it to your wishlist.':activeSearch?'No products matched that search. Try another term or browse the categories.':visualSearchSignature?'No visual matches could be ranked for this image. Try a clearer photo or search by name.':activeCategory?'No '+esc(activeCategory.toLowerCase())+' products are currently in stock.':'No products are currently in stock. Please check again soon.')+'</div>';
    grid.querySelectorAll("[data-product-id]").forEach(card=>{
      const open=()=>openProductModal(catalogueProducts.find(p=>String(p.id)===String(card.dataset.productId)));
      card.addEventListener("click",event=>{if(event.target.closest("[data-wishlist-product]"))return;open();});
      card.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){if(event.target.closest("[data-wishlist-product]"))return;event.preventDefault();open();}});
    });
    grid.querySelectorAll("[data-wishlist-product]").forEach(button=>button.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();const id=String(button.dataset.wishlistProduct);
      if(wishlistIds.has(id))wishlistIds.delete(id);else wishlistIds.add(id);
      saveWishlist();render();
    }));
  }

  function bindCollectionFilters(){
    const drawer=document.getElementById("shopDrawer");
    if(drawer)drawer.addEventListener("click",event=>{
      const category=event.target.closest("[data-filter-type]");
      if(category){
        event.preventDefault();activeCategory=category.dataset.filterType||"";
        activeSearch="";visualSearchSignature=null;visualSearchScores.clear();activeSegment="all";wishlistOnly=false;
        const search=document.getElementById("siteSearch");if(search)search.value="";
        render();closeShopDrawer();document.getElementById("products")?.scrollIntoView({behavior:"smooth",block:"start"});return;
      }
      const segment=event.target.closest("[data-segment]");
      if(segment){
        activeSegment=segment.dataset.segment||"all";activeCategory="";activeSearch="";visualSearchSignature=null;visualSearchScores.clear();wishlistOnly=false;
        const search=document.getElementById("siteSearch");if(search)search.value="";
        render();closeShopDrawer();document.getElementById("products")?.scrollIntoView({behavior:"smooth",block:"start"});
      }
      if(event.target.closest("[data-close-drawer]"))closeShopDrawer();
    });
    const clearButton=document.getElementById("clearProductFilter");
    if(clearButton)clearButton.addEventListener("click",()=>{
      activeCategory="";activeSearch="";visualSearchSignature=null;visualSearchScores.clear();activeSegment="all";wishlistOnly=false;
      const search=document.getElementById("siteSearch");if(search)search.value="";
      render();showSearchFeedback("");
    });
  }
  function showSearchFeedback(message,isError=false){
    const feedback=document.getElementById("searchFeedback");if(!feedback)return;
    feedback.textContent=message||"";feedback.hidden=!message;feedback.classList.toggle("is-error",Boolean(isError));
  }
  function applyTextSearch(){
    const field=document.getElementById("siteSearch");activeSearch=String(field?.value||"").trim();
    activeCategory="";activeSegment="all";wishlistOnly=false;visualSearchSignature=null;visualSearchScores.clear();
    render();showSearchFeedback(activeSearch?"Showing catalogue results for \""+activeSearch+"\".":"");
    document.getElementById("products")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function colorSignature(image){
    const size=36,canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
    const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)throw new Error("Canvas is unavailable.");
    context.fillStyle="#fff";context.fillRect(0,0,size,size);context.drawImage(image,0,0,size,size);
    const data=context.getImageData(0,0,size,size).data,bins=new Array(54).fill(0);let total=0;
    for(let i=0;i<data.length;i+=16){
      const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,l=(max+min)/2;
      let h=0,s=0;
      if(delta){s=delta/(1-Math.abs(2*l-1));if(max===r)h=((g-b)/delta)%6;else if(max===g)h=(b-r)/delta+2;else h=(r-g)/delta+4;h=(h*60+360)%360;}
      const hi=Math.min(5,Math.floor(h/60)),si=Math.min(2,Math.floor(s*3)),li=Math.min(2,Math.floor(l*3));
      bins[(hi*3+si)*3+li]++;total++;
    }
    return bins.map(value=>value/(total||1));
  }
  function imageSignatureFromSource(src,isUserImage=false){
    if(!isUserImage&&visualSignatureCache.has(src))return visualSignatureCache.get(src);
    const promise=new Promise((resolve,reject)=>{
      const image=new Image();if(!isUserImage)image.crossOrigin="anonymous";
      image.onload=()=>{try{resolve(colorSignature(image));}catch(error){reject(error);}};
      image.onerror=()=>reject(new Error("A product photo could not be analysed by the browser."));
      image.src=src;
    });
    if(!isUserImage)visualSignatureCache.set(src,promise);return promise;
  }
  function cosineSimilarity(a,b){
    let dot=0,aa=0,bb=0;for(let i=0;i<Math.min(a.length,b.length);i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
    return dot/(Math.sqrt(aa*bb)||1);
  }
  async function runVisualSearch(file){
    if(!file)return;
    if(!file.type||!file.type.startsWith("image/")){showSearchFeedback("Choose an image file or take a photo.",true);return;}
    if(file.size>12*1024*1024){showSearchFeedback("Please use an image smaller than 12 MB.",true);return;}
    showSearchFeedback("Analysing the photo and comparing catalogue images...");
    try{
      const objectUrl=URL.createObjectURL(file);let reference;
      try{reference=await imageSignatureFromSource(objectUrl,true);}finally{URL.revokeObjectURL(objectUrl);}
      const scored=await Promise.all(catalogueProducts.map(async product=>{
        const image=getImage(product);if(!image)return null;
        try{return {id:String(product.id),score:cosineSimilarity(reference,await imageSignatureFromSource(image,false))};}catch{return null;}
      }));
      visualSearchScores=new Map(scored.filter(Boolean).map(item=>[item.id,item.score]));
      if(!visualSearchScores.size)throw new Error("Product photos could not be analysed. Try text search instead.");
      visualSearchSignature=reference;activeSearch="";activeCategory="";activeSegment="all";wishlistOnly=false;
      const field=document.getElementById("siteSearch");if(field)field.value="";
      render();showSearchFeedback("Visual matches are ranked by dominant image colours and tones. Different lighting or backgrounds can affect results.");
      document.getElementById("products")?.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){console.warn("Visual search failed",error);showSearchFeedback(error.message||"Visual search is unavailable for this photo.",true);}
  }
  function bindHeaderActions(){
    document.getElementById("siteSearchForm")?.addEventListener("submit",event=>{event.preventDefault();applyTextSearch();});
    document.getElementById("voiceSearch")?.addEventListener("click",()=>{
      const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!SpeechRecognition){showSearchFeedback("Voice search is not supported in this browser. Type your search instead.",true);return;}
      if(speechRecognition){speechRecognition.stop();speechRecognition=null;}
      speechRecognition=new SpeechRecognition();speechRecognition.lang="en-IN";speechRecognition.interimResults=false;speechRecognition.maxAlternatives=1;
      showSearchFeedback("Listening... speak the product or category you are looking for.");
      speechRecognition.onresult=event=>{const transcript=event.results?.[0]?.[0]?.transcript||"";const field=document.getElementById("siteSearch");if(field)field.value=transcript;applyTextSearch();};
      speechRecognition.onerror=()=>showSearchFeedback("Voice input wasn't available. Check microphone permission or type your search.",true);
      speechRecognition.onend=()=>{speechRecognition=null;};
      try{speechRecognition.start();}catch{showSearchFeedback("Voice input couldn't start. Try again or type your search.",true);}
    });
    const fileInput=document.getElementById("visualSearchFile");
    document.getElementById("visualSearchButton")?.addEventListener("click",()=>fileInput?.click());
    fileInput?.addEventListener("change",()=>{const file=fileInput.files?.[0];if(file)runVisualSearch(file);fileInput.value="";});
    document.getElementById("wishlistToggle")?.addEventListener("click",()=>{
      wishlistOnly=!wishlistOnly;activeCategory="";activeSearch="";visualSearchSignature=null;visualSearchScores.clear();activeSegment="all";
      const field=document.getElementById("siteSearch");if(field)field.value="";
      render();showSearchFeedback(wishlistOnly?"Showing your saved items.":"");
      document.getElementById("products")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
    document.getElementById("drawerTrackAction")?.addEventListener("click",()=>{closeShopDrawer();openTrackingOverlay();});
    document.getElementById("drawerWishlistAction")?.addEventListener("click",()=>{closeShopDrawer();wishlistOnly=true;activeCategory="";activeSearch="";visualSearchSignature=null;visualSearchScores.clear();activeSegment="all";render();document.getElementById("products")?.scrollIntoView({behavior:"smooth",block:"start"});});
    document.getElementById("accountOpen")?.addEventListener("click",openAccountOverlay);
    document.getElementById("orderTrackOpen")?.addEventListener("click",openTrackingOverlay);
    document.getElementById("accountTrackOrder")?.addEventListener("click",()=>{closeUtilityOverlays();openTrackingOverlay();});
    document.querySelectorAll("[data-close-utility]").forEach(button=>button.addEventListener("click",closeUtilityOverlays));
    document.getElementById("trackingForm")?.addEventListener("submit",submitOrderTracking);
    document.getElementById("menuToggle")?.addEventListener("click",openShopDrawer);
    document.getElementById("drawerClose")?.addEventListener("click",closeShopDrawer);
    document.getElementById("drawerScrim")?.addEventListener("click",closeShopDrawer);
    document.addEventListener("keydown",event=>{if(event.key==="Escape"){closeShopDrawer();closeUtilityOverlays();}});
    updateWishlistCount();
  }
  function openShopDrawer(){
    const drawer=document.getElementById("shopDrawer"),scrim=document.getElementById("drawerScrim"),toggle=document.getElementById("menuToggle");
    if(!drawer||!scrim)return;
    drawer.classList.add("is-open");drawer.setAttribute("aria-hidden","false");drawer.removeAttribute("inert");
    scrim.hidden=false;requestAnimationFrame(()=>scrim.classList.add("is-visible"));
    document.body.classList.add("drawer-open");if(toggle)toggle.setAttribute("aria-expanded","true");
    document.getElementById("drawerClose")?.focus();
  }
  function closeShopDrawer(){
    const drawer=document.getElementById("shopDrawer"),scrim=document.getElementById("drawerScrim"),toggle=document.getElementById("menuToggle");
    if(!drawer||!scrim)return;
    drawer.classList.remove("is-open");drawer.setAttribute("aria-hidden","true");drawer.setAttribute("inert","");
    scrim.classList.remove("is-visible");window.setTimeout(()=>{if(!scrim.classList.contains("is-visible"))scrim.hidden=true;},260);
    document.body.classList.remove("drawer-open");if(toggle){toggle.setAttribute("aria-expanded","false");toggle.focus({preventScroll:true});}
  }
  function openUtilityOverlay(id){
    closeUtilityOverlays();const overlay=document.getElementById(id);if(!overlay)return;
    overlay.hidden=false;overlay.setAttribute("aria-hidden","false");document.body.classList.add("utility-open");
    overlay.querySelector("input,button")?.focus();
  }
  function closeUtilityOverlays(){
    document.querySelectorAll(".utility-overlay").forEach(overlay=>{overlay.hidden=true;overlay.setAttribute("aria-hidden","true");});
    document.body.classList.remove("utility-open");
  }
  function openTrackingOverlay(){openUtilityOverlay("trackingOverlay");loadMyOrdersInto(document.getElementById("trackingAutoOrders"),"Tracking");}
  function openAccountOverlay(){openUtilityOverlay("accountOverlay");loadMyOrdersInto(document.getElementById("accountOrders"),"Account");}
  async function loadMyOrdersInto(container,label){
    if(!container)return;
    container.hidden=false;container.innerHTML='<p class="muted">Checking for active orders linked to a signed-in account...</p>';
    try{
      if(!client){container.innerHTML='<p class="muted">Guest checkout orders can be found using the product code and phone number below.</p>';return;}
      const sessionResult=await client.auth.getSession();if(sessionResult.error)throw sessionResult.error;
      if(!sessionResult.data?.session){container.innerHTML='<p class="muted">No customer account is signed in. Use the product code and phone lookup below to track a guest order.</p>';return;}
      const {data,error}=await client.rpc("track_my_online_orders");if(error)throw error;
      const orders=Array.isArray(data)?data:[];
      if(!orders.length){container.innerHTML='<p class="muted">No active online orders are linked to this account email. Guest orders can still be checked with the lookup form.</p>';return;}
      container.innerHTML='<p class="tracking-panel-label">ACTIVE ORDERS</p>'+orders.map(order=>'<article class="active-order-card"><div class="tracking-result-top"><div><strong>'+esc(order.order_number)+'</strong><small>'+esc(order.product_names||"Online order")+' - '+new Date(order.created_at).toLocaleDateString("en-IN")+'</small></div><span class="tracking-status '+esc(String(order.status||"pending").toLowerCase())+'">'+esc(order.status||"pending")+'</span></div><small>Payment: '+esc(order.payment_status||"pending")+' - Total Rs '+Number(order.total_amount||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})+'</small></article>').join("");
    }catch(error){console.warn("Account order tracking unavailable",error);container.innerHTML='<p class="muted">Automatic order lookup is unavailable for this session. Use the product code and phone lookup instead.</p>';}
  }
  async function submitOrderTracking(event){
    event.preventDefault();
    const code=String(document.getElementById("trackingProductCode")?.value||"").trim(),phone=String(document.getElementById("trackingPhone")?.value||"").trim();
    const message=document.getElementById("trackingMessage"),results=document.getElementById("trackingResults");
    if(message){message.textContent="Checking your order...";message.classList.remove("error");}if(results)results.innerHTML="";
    if(!code||phone.replace(/[^0-9]/g,"").length<10){if(message){message.textContent="Enter the ordered product code and a valid phone number.";message.classList.add("error");}return;}
    try{
      if(!client)throw new Error("Order tracking is temporarily unavailable. Please try again later.");
      const {data,error}=await client.rpc("track_online_order",{p_product_code:code,p_phone:phone});if(error)throw error;
      const orders=Array.isArray(data)?data:[];
      if(!orders.length){if(message)message.textContent="No matching online order was found. Check both details and try again.";return;}
      if(message)message.textContent=orders.length+" matching order"+(orders.length===1?"":"s")+" found.";
      if(results)results.innerHTML=orders.map(order=>'<article class="tracking-result-card"><div class="tracking-result-top"><div><strong>'+esc(order.order_number)+'</strong><small>'+esc(order.product_name||"Ordered item")+' - '+new Date(order.created_at).toLocaleDateString("en-IN")+'</small></div><span class="tracking-status '+esc(String(order.status||"pending").toLowerCase())+'">'+esc(order.status||"pending")+'</span></div><small>Payment: '+esc(order.payment_status||"pending")+'</small></article>').join("");
    }catch(error){console.error("Order tracking failed.",error);if(message){message.textContent="We couldn't check the order right now. Please try again.";message.classList.add("error");}}
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
      ["Category",category],
      ["Thickness",product.thickness],
      ["Gold amount",product.gold_amount_g!=null?product.gold_amount_g+" g":null],
      ["Length",lengthOptions.length?null:(product.length_cm!=null?product.length_cm+" cm":null)]
    ].filter(item=>item[1]!==null&&item[1]!==undefined&&String(item[1]).trim()!=="");
    let activeImageIndex=0;
    const galleryHtml='<div class="product-gallery">'+
      '<div class="product-detail-main">'+(main?'<img data-gallery-main src="'+esc(main)+'" alt="'+esc(product.product_name)+'">':'<div class="placeholder">RG</div>')+
        '<span class="gallery-count" data-gallery-count>1 / '+images.length+' photo'+(images.length===1?'':'s')+'</span></div>'+
      (images.length>1?'<div class="product-detail-thumbs">'+images.map((image,i)=>'<button type="button" class="product-detail-thumb'+(i===0?' active':'')+'" data-gallery-src="'+esc(image.public_url)+'" data-gallery-index="'+i+'" data-gallery-alt="'+esc(product.product_name+' — image '+(i+1))+'" aria-label="View product image '+(i+1)+'" aria-current="'+(i===0?'true':'false')+'"><img src="'+esc(image.public_url)+'" alt="" loading="lazy"></button>').join("")+'</div>':"")+
      '</div>';
    const lengthGuide=lengthOptions.length
      ?'<details class="length-guide"><summary>View length guide</summary><img src="assets/brand/length.png" alt="Jewellery length reference guide" loading="lazy"></details>'
      :"";
    const detailsPanel=(details.length||product.description)
      ?'<details class="product-details-accordion" open><summary><span>Product details</span><span class="details-indicator" aria-hidden="true"></span></summary>'+
        (product.description?'<p class="modal-description">'+esc(product.description)+'</p>':"")+
        (details.length?'<div class="detail-list">'+details.map(d=>'<div><span>'+esc(d[0])+'</span><strong>'+esc(d[1])+'</strong></div>').join("")+'</div>':"")+
        '</details>'
      :"";
    const savedInWishlist=wishlistIds.has(String(product.id));
    content.innerHTML='<div class="product-detail-grid"><div>'+galleryHtml+'</div>'+
      '<div class="product-detail-info">'+
        '<div class="product-breadcrumb"><span>Rainbow Gold Covering</span><span aria-hidden="true">›</span><span>'+esc(category)+'</span></div>'+
        '<h2 id="modalProductName">'+esc(product.product_name)+'</h2>'+
        '<div class="product-type modal-product-type">'+esc(category)+'</div>'+
        '<div class="modal-price-row"><div class="modal-price">'+money(product.selling_price)+'</div><span class="product-stock '+(stockOf(selectedVariant)===0?"out":"in")+'" data-variant-status>'+(stockOf(selectedVariant)===0?"Out of stock":"In stock")+'</span></div>'+
        choiceControls+genericVariantPicker+
        '<div class="product-quantity-row"><span>Quantity</span><div class="quantity-picker"><button type="button" data-qty-minus aria-label="Decrease quantity">−</button><span data-qty>1</span><button type="button" data-qty-plus aria-label="Increase quantity">＋</button></div></div>'+
        '<div class="product-buy-actions"><button class="btn btn-dark" type="button" data-add-cart>Add to Cart</button><button class="btn btn-light" type="button" data-buy-now>Buy Now →</button></div>'+
        '<button class="modal-wishlist-button'+(savedInWishlist?' is-saved':'')+'" type="button" data-modal-wishlist aria-pressed="'+savedInWishlist+'"><span aria-hidden="true">'+(savedInWishlist?'♥':'♡')+'</span><span>'+(savedInWishlist?'Saved to wishlist':'Save to wishlist')+'</span></button>'+
        '<div class="product-support-card"><span>Need help?</span><p>Ask us about this design, sizing, or delivery options.</p><button type="button" data-contact-store>Contact Rainbow <span aria-hidden="true">→</span></button></div>'+
        detailsPanel+lengthGuide+
      '</div></div>';
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
      activeImageIndex=Number(button.dataset.galleryIndex||0);
      if(image){image.src=button.dataset.gallerySrc;image.alt=button.dataset.galleryAlt||product.product_name;}
      const count=content.querySelector("[data-gallery-count]");
      if(count)count.textContent=(activeImageIndex+1)+" / "+images.length+" photo"+(images.length===1?"":"s");
      content.querySelectorAll("[data-gallery-src]").forEach(item=>{
        const active=item===button;
        item.classList.toggle("active",active);
        item.setAttribute("aria-current",String(active));
      });
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
    const modalWishlistButton=content.querySelector("[data-modal-wishlist]");
    if(modalWishlistButton)modalWishlistButton.addEventListener("click",()=>{
      const id=String(product.id);
      if(wishlistIds.has(id))wishlistIds.delete(id);else wishlistIds.add(id);
      saveWishlist();
      const saved=wishlistIds.has(id);
      modalWishlistButton.classList.toggle("is-saved",saved);
      modalWishlistButton.setAttribute("aria-pressed",String(saved));
      const icon=modalWishlistButton.querySelector("span[aria-hidden]");
      const label=modalWishlistButton.querySelector("span:not([aria-hidden])");
      if(icon)icon.textContent=saved?"♥":"♡";
      if(label)label.textContent=saved?"Saved to wishlist":"Save to wishlist";
      render();
    });
    content.querySelector("[data-contact-store]")?.addEventListener("click",()=>{
      closeProductModal();
      document.getElementById("contact")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
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
    updateWishlistCount();
    bindProductModal();
    bindCollectionFilters();
    bindHeaderActions();
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