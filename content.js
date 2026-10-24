(() => {
  const SUPABASE_CONFIG=window.RAINBOW_SUPABASE_CONFIG||{};
  const SUPABASE_URL=String(SUPABASE_CONFIG.supabaseUrl||"").trim();
  const SUPABASE_PUBLISHABLE_KEY=String(SUPABASE_CONFIG.supabasePublishableKey||"").trim();
  let client=null, realtimeChannel=null, realtimeRefreshTimer=null, refreshInterval=null, productsLoading=false, productsReloadRequested=false, catalogueProducts=[], catalogueCategories=[], visibleProducts=[], activeCategory="", activeProductId="";
  let promotionProductIds=[],promotionSlides=[],promotionActive=0,promotionSignature="",promotionTimer=null;
  let promotionPaused=false;
  const reducePromotionMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true;
  const WISHLIST_KEY="rainbow_wishlist_v1";
  const discovery=window.RainbowDiscovery;
  const catalogue=window.RainbowCatalogue;
  const paging={epoch:0,loading:false,hasMore:true,total:0,offset:0,autoPages:0,error:""};
  let promotionProducts=[],newestProducts=[],metadataLoading=false,metadataError=false,loaderObserver=null,showAllProducts=false;
  const filterState={minPrice:"",maxPrice:"",color:"",size:"",length:"",inStock:true};
  let catalogueSort="featured";
  const track=(name,detail={})=>window.RainbowAnalytics?.track(name,detail);
  let activeSearch="",activeSegment="all",wishlistOnly=false,visualSearchSignature=null,visualSearchScores=new Map(),speechRecognition=null;
  const wishlistIds=new Set(readWishlist());
  const visualSignatureCache=new Map();
  const scrollBehavior=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"auto":"smooth";
  let drawerReturnFocus=null,utilityReturnFocus=null,modalReturnFocus=null;
  let galleryTimer=null;
  const galleryReducedMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches===true;
  function stopGalleryRotation(){if(galleryTimer){clearInterval(galleryTimer);galleryTimer=null;}}
  function trapDialogFocus(event,container){
    if(event.key!=="Tab"||!container)return;
    const controls=[...container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(element=>!element.hidden&&element.getClientRects().length>0&&element.getAttribute("aria-hidden")!=="true");
    const first=controls[0],last=controls[controls.length-1];
    if(!first){event.preventDefault();container.focus();return;}
    if(event.shiftKey&&(document.activeElement===first||!container.contains(document.activeElement))){
      event.preventDefault();last.focus();
    }else if(!event.shiftKey&&(document.activeElement===last||!container.contains(document.activeElement))){
      event.preventDefault();first.focus();
    }
  }

  const esc=value=>String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
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
  const getThumb=product=>catalogue?.thumbnailUrl(getProductImages(product)[0])||getImage(product);
  const responsiveSource=product=>{const original=getImage(product),small=getThumb(product);return small&&small!==original?(" srcset=\'"+esc(small)+" 480w, "+esc(original)+" 1600w\' sizes=\'(max-width:700px) 50vw, (max-width:1000px) 33vw, 25vw\'"):"";};
  const CART_KEY="rainbow_cart_v1";
  function readWishlist(){try{const value=JSON.parse(localStorage.getItem(WISHLIST_KEY)||"[]");return Array.isArray(value)?value.map(String):[]}catch{return[];}}
  function saveWishlist(){try{localStorage.setItem(WISHLIST_KEY,JSON.stringify([...wishlistIds]));}catch{}updateWishlistCount();}
  function updateWishlistCount(){const badge=document.getElementById("wishlistCount");if(badge){badge.textContent=String(wishlistIds.size);badge.hidden=wishlistIds.size===0;}const button=document.getElementById("wishlistToggle");if(button){button.setAttribute("aria-pressed",String(wishlistOnly));button.classList.toggle("is-selected",wishlistOnly);}}
  const getCart=()=>{try{return JSON.parse(localStorage.getItem(CART_KEY)||"[]")}catch{return[]}};
  const saveCart=items=>{localStorage.setItem(CART_KEY,JSON.stringify(items));updateCartCount()};
  const updateCartCount=()=>{const el=document.getElementById("cartCount");if(el)el.textContent=getCart().reduce((n,x)=>n+Number(x.quantity||0),0)};
  const getStock=product=>(Array.isArray(product.product_variants)?product.product_variants:[])
    .filter(v=>v.active!==false).reduce((sum,v)=>sum+Number(v.stock_quantity||0),0);

  function displayPromotionSlide(position){
    if(!promotionSlides.length)return;
    promotionActive=(position+promotionSlides.length)%promotionSlides.length;
    const current=promotionSlides[promotionActive];
    const image=document.getElementById("promotionImage");
    const view=document.getElementById("promotionView");
    if(image){
      if(image.getAttribute("src")!==current.image)image.src=current.image;
      image.alt=current.product.product_name||"Rainbow jewellery";
    }
    if(view)view.setAttribute("aria-label","View "+(current.product.product_name||"featured jewellery"));
    document.querySelectorAll("#promotionDots button").forEach((dot,i)=>{
      const active=i===promotionActive;
      dot.classList.toggle("is-active",active);
      dot.setAttribute("aria-current",active?"true":"false");
      dot.setAttribute("aria-label","Show featured image "+(i+1)+" of "+promotionSlides.length);
    });
  }
  function schedulePromotionRotation(){
    if(promotionTimer){clearInterval(promotionTimer);promotionTimer=null;}
    if(reducePromotionMotion||promotionSlides.length<2)return;
    promotionTimer=window.setInterval(()=>{
      if(promotionPaused||document.visibilityState==="hidden")return;
      displayPromotionSlide(promotionActive+1);
    },5000);
  }
  function renderPromotion(){
    const section=document.getElementById("featuredPromotion");
    if(!section)return;
    const available=promotionProductIds.map(id=>promotionProducts.find(p=>String(p.id)===String(id)))
      .filter(Boolean).filter(p=>getStock(p)>0&&Boolean(getImage(p)))
      .map(product=>({product,image:getImage(product)}));
    const signature=available.map(item=>item.product.id+":"+item.image).join("|");
    const heroProduct=available[0]||newestProducts.find(p=>getStock(p)>0&&Boolean(getImage(p)))||catalogueProducts.find(p=>getStock(p)>0&&Boolean(getImage(p)));
    const hero=document.getElementById("heroArt"),heroLink=document.getElementById("heroProductLink");
    const heroImage=document.getElementById("heroProductImage"),heroTitle=document.getElementById("heroProductTitle");
    if(hero){hero.classList.toggle("has-product",Boolean(heroProduct));}
    if(heroLink){heroLink.hidden=!heroProduct;heroLink.href=heroProduct?"product.html?sku="+encodeURIComponent((heroProduct.product||heroProduct).product_code||""):"#products";}
    if(heroImage&&heroProduct){heroImage.src=heroProduct.image||getImage(heroProduct.product||heroProduct);heroImage.alt=(heroProduct.product||heroProduct).product_name||"Featured jewellery";}
    if(heroTitle&&heroProduct)heroTitle.textContent=(heroProduct.product||heroProduct).product_name||"Discover this design";
    if(signature===promotionSignature){section.hidden=!available.length;return;}
    promotionSignature=signature;
    promotionSlides=available;promotionActive=0;
    section.hidden=!available.length;
    const dots=document.getElementById("promotionDots");
    if(dots){
      dots.replaceChildren();
      for(let i=0;i<available.length;i++){
        const button=document.createElement("button");
        button.type="button";
        button.addEventListener("click",()=>displayPromotionSlide(i));
        dots.append(button);
      }
      dots.hidden=available.length<2;
    }
    for(const id of ["promotionPrevious","promotionNext"]){
      const arrow=document.getElementById(id);
      if(arrow)arrow.hidden=available.length<2;
    }
    if(available.length)displayPromotionSlide(0);
    schedulePromotionRotation();
  }

  function applyBusinessConfig(){
    const cfg=window.RAINBOW_BUSINESS_CONFIG;
    if(!cfg)return;
    const brand=document.querySelector('[data-config="brandName"]');
    const eyebrow=document.querySelector('[data-config="eyebrow"]');
    const footer=document.querySelector('[data-config="footerBrandText"]');
    if(brand){const words=String(cfg.businessName||"Rainbow Gold Covering").trim().split(/\s+/);brand.textContent=words.slice(0,2).join(" ").toUpperCase();const sub=brand.parentElement?.querySelector("small");if(sub)sub.textContent=words.slice(2).join(" ").toUpperCase();}
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

  function productInSegment(product,segment=activeSegment){
    const gender=["male","unisex"].includes(String(product.gender||"women").toLowerCase())
      ?String(product.gender||"").toLowerCase()
      :"women";
    if(segment==="men")return gender==="male"||gender==="unisex";
    if(segment==="women")return gender==="women"||gender==="unisex";
    return true;
  }
  function categoryBuckets(products=[...catalogueProducts,...promotionProducts,...newestProducts]){
    const labels=new Map();
    const ensure=(label,metadata={})=>{
      const name=String(label||"").trim(),key=normalizeCategory(name);
      if(!key)return null;
      if(!labels.has(key))labels.set(key,{
        label:name,products:[],
        storefrontOrder:Number(metadata.storefront_order??999),
        storefrontVisible:metadata.show_in_storefront!==false
      });
      return labels.get(key);
    };
    catalogueCategories.forEach(category=>ensure(category.name,category));
    products.forEach(product=>{
      if(!productInSegment(product))return;
      const categoryName=categoryFor(product);
      const metadata=catalogueCategories.find(category=>normalizeCategory(category.name)===normalizeCategory(categoryName))
        ||product.categories||{};
      const bucket=ensure(categoryName,metadata);
      if(bucket)bucket.products.push(product);
    });
    return [...labels.values()]
      .filter(bucket=>bucket.storefrontVisible)
      .sort((a,b)=>a.storefrontOrder-b.storefrontOrder||a.label.localeCompare(b.label,"en"));
  }
  function renderCategorySidebar(){
    const sidebar=document.getElementById("drawerCategories");
    if(!sidebar)return;
    const buckets=window.matchMedia("(max-width:767px)").matches
      ?storefrontMobileBuckets():categoryBuckets();
    const typeButtons=buckets.map(bucket=>{
      const cover=bucket.products.find(p=>getImage(p))||null;
      const url=cover?getThumb(cover):"";
      return "<button type='button' class='drawer-type-link' data-filter-type='"+esc(bucket.label)+"' aria-label='Browse "+esc(bucket.label)+"'>"+
        (url?"<img class='drawer-type-thumb' src='"+esc(url)+"' alt='' loading='lazy' decoding='async'>":
          "<span class='drawer-type-fallback' aria-hidden='true'>✦</span>")+
        "<span>"+esc(bucket.label)+"</span></button>";
    }).join("");
    sidebar.innerHTML=
      "<button type='button' class='drawer-all-category' data-filter-type=''>All product types</button>"+
      (typeButtons?"<div class='drawer-type-grid' aria-label='Available product types'>"+typeButtons+"</div>":
        "<div class='drawer-empty'>Product types will appear as in-stock designs are added.</div>");
  }
  // Category-first mobile browsing uses the same real category metadata and product
  // photographs as the desktop catalogue. No duplicate backend requests.
  const mobileCategoryImageCache=new Map();
  const mobileCategoryStockCounts=new Map();
  let mobileCategoryCountsReady=false;
  let mobileCategorySignature="";
  // Server-side exact counts: never infer category emptiness from a paginated page.
  async function loadCategoryStockCounts(){
    mobileCategoryCountsReady=false;
    mobileCategoryStockCounts.clear();
    const counted=await Promise.all(catalogueCategories.filter(c=>c.show_in_storefront!==false).map(async c=>{
      const result=await client.from("product_variants")
        .select("id,products!inner(category_id,active)",{count:"exact",head:true})
        .eq("active",true).gt("stock_quantity",0)
        .eq("products.active",true).eq("products.category_id",c.id);
      if(result.error)throw result.error;
      return [normalizeCategory(c.name),Number(result.count||0)];
    }));
    counted.forEach(([name,count])=>mobileCategoryStockCounts.set(name,count));
    mobileCategoryCountsReady=true;
  }
  function storefrontMobileBuckets(){
    if(!mobileCategoryCountsReady)return [];
    return categoryBuckets().filter(bucket=>mobileCategoryStockCounts.get(normalizeCategory(bucket.label))>0);
  }
  function renderMobileCategories(){
    const section=document.getElementById("mobileCategorySection");
    const track=document.getElementById("mobileCategoryTrack");
    if(!section||!track)return;
    if(!mobileCategoryCountsReady){
      track.innerHTML='<span class="mobile-category-loading" role="status">Loading collections…</span>';
      section.hidden=false;
      return;
    }
    const buckets=storefrontMobileBuckets();
    const prepared=buckets.map(bucket=>{
      const key=normalizeCategory(bucket.label);
      const photographed=bucket.products.find(product=>getImage(product));
      if(photographed)mobileCategoryImageCache.set(key,getThumb(photographed));
      return {name:bucket.label,key,image:mobileCategoryImageCache.get(key)||""};
    });
    const signature=JSON.stringify(prepared);
    if(signature!==mobileCategorySignature){
      const previousScroll=track.scrollLeft;
      track.innerHTML=
        "<button type='button' class='mobile-category-card mobile-category-card--all' data-mobile-category='' aria-label='Show all jewellery'>"+
          "<span class='mobile-category-picture mobile-category-picture--all' aria-hidden='true'>✦</span><span class='mobile-category-name'>All designs</span></button>"+
        prepared.map(item=>"<button type='button' class='mobile-category-card' data-mobile-category='"+esc(item.name)+"' aria-label='Shop "+esc(item.name)+"'>"+
          "<span class='mobile-category-picture'>"+(item.image?
            "<img src='"+esc(item.image)+"' alt='' width='120' height='120' loading='lazy' decoding='async'>":
            "<span class='mobile-category-fallback' aria-hidden='true'>"+esc(item.name.trim().slice(0,1).toUpperCase())+"</span>")+
          "</span><span class='mobile-category-name'>"+esc(item.name)+"</span></button>").join("");
      track.scrollLeft=previousScroll;
      mobileCategorySignature=signature;
    }
    track.querySelectorAll("[data-mobile-category]").forEach(button=>{
      const selected=(button.dataset.mobileCategory||"")===activeCategory&&!wishlistOnly&&!activeSearch;
      button.classList.toggle("is-active",selected);
      button.setAttribute("aria-pressed",String(selected));
    });
    section.hidden=false;
    const seeAll=document.getElementById("mobileCategorySeeAll");
    if(seeAll){seeAll.disabled=prepared.length===0;seeAll.setAttribute("aria-disabled",String(prepared.length===0));}
    const empty=document.getElementById("mobileCategoryEmpty");
    if(empty)empty.hidden=prepared.length>0;
  }
  function isMenProduct(product){
    return String(product.gender||"women").toLowerCase()==="male";
  }

  function matchesTextSearch(product,query){
    if(!query)return true;
    const haystack=normalizeCategory([product.product_name,product.type,categoryFor(product),product.description].filter(Boolean).join(" "));
    const tokens=normalizeCategory(query).split(/\s+/).filter(Boolean);
    return tokens.every(token=>haystack.includes(token));
  }

  function syncShopFilters(){
    // Filter inputs accept values not present on this page. Datalists are merely suggestions.
    for(const [id,key] of [["catalogColorList","color"],["catalogSizeList","size"]]){
      const list=document.getElementById(id);if(!list)continue;
      const values=new Set();
      for(const product of [...catalogueProducts,...promotionProducts,...newestProducts]){
        for(const v of (product.product_variants||[])){
          const value=String(v[key]||"").trim();
          if(v.active!==false&&Number(v.stock_quantity)>0&&value&&value!=="0")values.add(value);
        }
      }
      list.replaceChildren(...[...values].sort((a,b)=>a.localeCompare(b,"en",{numeric:true})).slice(0,80).map(v=>new Option(v,v)));
    }
    const suggestions=document.getElementById("productSearchSuggestions");
    if(suggestions)suggestions.replaceChildren(...catalogueProducts.slice(0,60).map(p=>new Option(p.product_name)));
  }
  function renderLatestArrivals(){
    const section=document.getElementById("latestSection"),grid=document.getElementById("latestGrid");
    if(!section||!grid)return;
    const latest=[...newestProducts].filter(p=>getStock(p)>0&&Boolean(getImage(p)))
      .sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0)).slice(0,4);
    section.hidden=latest.length===0;
    grid.replaceChildren();
    latest.forEach(p=>{
      const anchor=document.createElement("a");anchor.href="product.html?sku="+encodeURIComponent(p.product_code||"");anchor.className="latest-item";
      const img=document.createElement("img");img.src=getThumb(p);if(getThumb(p)!==getImage(p)){img.srcset=getThumb(p)+" 480w, "+getImage(p)+" 1600w";img.sizes="(max-width:700px) 50vw, 25vw";}img.alt=p.product_name||"New jewellery design";img.width=320;img.height=320;img.loading="lazy";img.decoding="async";
      const label=document.createElement("strong");label.textContent=p.product_name||"Jewellery";
      const price=document.createElement("span");price.textContent=money(p.selling_price);
      anchor.append(img,label,price);grid.append(anchor);
    });
  }
  function bindAdvancedFilters(){
    const form=document.getElementById("shopFilters");if(!form)return;
    form.addEventListener("submit",event=>event.preventDefault());
    // Move the SAME live form between desktop sidebar and mobile hamburger drawer.
    // Moving nodes preserves values, listeners, and avoids duplicate field IDs.
    const desktopHost=document.getElementById("desktopFilterHost");
    const drawerHost=document.getElementById("drawerFilterHost");
    const breakpoint=window.matchMedia?.("(max-width: 800px)");
    if(desktopHost&&drawerHost&&breakpoint){
      const placeFilters=()=>{
        const mobile=breakpoint.matches;
        const target=mobile?drawerHost:desktopHost;
        if(form.parentElement!==target)target.appendChild(form);
        const menuToggle=document.getElementById("menuToggle");
        if(menuToggle)menuToggle.setAttribute("aria-label",
          mobile?"Open navigation and jewellery filters":"Open navigation");
        if(!mobile&&document.getElementById("shopDrawer")?.classList.contains("is-open"))closeShopDrawer();
      };
      placeFilters();
      if(breakpoint.addEventListener)breakpoint.addEventListener("change",placeFilters);
      else breakpoint.addListener?.(placeFilters);
    }
    document.getElementById("drawerFilterResults")?.addEventListener("click",()=>{
      closeShopDrawer();
      document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
    });
    const fields=[["catalogMinPrice","minPrice"],["catalogMaxPrice","maxPrice"],["catalogColor","color"],["catalogSize","size"],["catalogLength","length"]];
    for(const [id,key] of fields)document.getElementById(id)?.addEventListener("change",event=>{
      filterState[key]=event.target.value.trim();resetCatalogue();
    });
    document.getElementById("catalogSort")?.addEventListener("change",event=>{
      catalogueSort=event.target.value;resetCatalogue();track("sort_catalogue",{sort:catalogueSort});
    });
    document.getElementById("catalogReset")?.addEventListener("click",()=>{
      for(const [id,key] of fields){filterState[key]="";const el=document.getElementById(id);if(el)el.value="";}
      catalogueSort="featured";const sort=document.getElementById("catalogSort");if(sort)sort.value="featured";
      resetCatalogue();
    });
  }
  function render(){
    const grid=document.getElementById("productGrid"),status=document.getElementById("productStatus");
    const heading=document.getElementById("productHeading"),clearButton=document.getElementById("clearProductFilter");
    if(!grid)return;
    renderCategorySidebar();
    renderMobileCategories();
    // Supabase returns already filtered and stably sorted rows; do not re-filter a single page.
    let products=catalogueProducts;
    if(visualSearchSignature)products=products.slice().sort((a,b)=>(visualSearchScores.get(String(b.id))??-1)-(visualSearchScores.get(String(a.id))??-1));
    visibleProducts=products;
    // Failed requests never masquerade as an empty inventory.
    if(!products.length&&paging.error){
      if(status)status.textContent="Catalogue unavailable";
      grid.innerHTML='<div class="catalogue-error" role="alert">'+
        '<p>Couldn\'t load jewellery. Check your connection and try again.</p>'+
        '<button type="button" id="catalogueRetry">Retry</button></div>';
      renderPager(false);return;
    }
    if(!products.length&&paging.loading){
      if(status)status.textContent="Loading jewellery…";
      grid.innerHTML='<div class="catalogue-skeleton" aria-label="Loading jewellery"></div>'.repeat(8);
      renderPager(false);return;
    }

    const filtersActive=Object.entries(filterState).some(([key,value])=>key!=="inStock"&&value!=="");
    const categoryLanding=!window.matchMedia("(max-width:767px)").matches&&!showAllProducts&&!activeCategory&&!activeSearch&&!visualSearchSignature&&!wishlistOnly&&!filtersActive&&catalogueSort==="featured";
    if(heading){
      heading.textContent=wishlistOnly?"Saved jewellery":activeSearch?"Search results":visualSearchSignature?"Visual matches":activeCategory?"Explore "+activeCategory.toLowerCase()+".":showAllProducts?"All jewellery.":categoryLanding?(activeSegment==="women"?"Shop women by category.":activeSegment==="men"?"Shop men by category.":"Shop by category."):"Shop jewellery.";
    }
    if(clearButton){
      clearButton.textContent=activeCategory?"Back to product types":"View all jewellery";
      clearButton.hidden=!(activeCategory||activeSearch||visualSearchSignature||wishlistOnly||activeSegment!=="all"||showAllProducts);
    }
    document.querySelectorAll("[data-segment]").forEach(button=>{
      const active=button.dataset.segment===activeSegment;
      button.classList.toggle("is-active",active);button.setAttribute("aria-pressed",String(active));
    });
    const wishlistButton=document.getElementById("wishlistToggle");
    if(wishlistButton){wishlistButton.setAttribute("aria-pressed",String(wishlistOnly));wishlistButton.classList.toggle("is-selected",wishlistOnly);}
    document.body.classList.toggle("mobile-wishlist-view",wishlistOnly);

    if(categoryLanding){
      renderPager(true);
      const buckets=categoryBuckets();
      if(status)status.textContent=buckets.length?"Choose a product type to explore.":"No product types have in-stock products yet.";
      grid.innerHTML=buckets.length?buckets.map(bucket=>{
        const product=bucket.products.find(item=>getImage(item))||bucket.products[0];
        const image=product?getThumb(product):"";
        return "<button type='button' class='category-tile' data-category-tile='"+esc(bucket.label)+"' aria-label='Browse "+esc(bucket.label)+"'>"+
          "<span class='category-tile-image'>"+(image?"<img src='"+esc(image)+"' alt='' loading='lazy'>":"<span class='placeholder'>RG</span>")+"</span>"+
          "<span class='category-tile-copy'><strong>"+esc(bucket.label)+"</strong><small>View collection</small></span></button>";
      }).join(""):"<div class='product-empty'>Product categories will appear here when in-stock designs are added.</div>";
      grid.querySelectorAll("[data-category-tile]").forEach(tile=>tile.addEventListener("click",()=>{
        activeCategory=tile.dataset.categoryTile||"";showAllProducts=false;
        track("select_category",{category:activeCategory});resetCatalogue();
        document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
      }));
      return;
    }

    if(status){
      if(visualSearchSignature)status.textContent=products.length+" loaded visual matches (not the entire shop)";
      else if(wishlistOnly)status.textContent=paging.total+" saved item"+(paging.total===1?"":"s");
      else if(activeSearch)status.textContent=paging.total+" result"+(paging.total===1?"":"s")+" for \""+activeSearch+"\"";
      else if(activeCategory)status.textContent=paging.total+" "+(paging.total===1?"product":"products")+" in "+activeCategory;
      else status.textContent=paging.total+" product"+(paging.total===1?"":"s")+" available";
    }
    const existingIds=[...grid.querySelectorAll("[data-product-id]")].map(card=>card.dataset.productId);
    const appendOnly=existingIds.length>0&&products.length>existingIds.length&&existingIds.every((id,index)=>String(products[index]?.id)===String(id));
    const toRender=appendOnly?products.slice(existingIds.length):products;
    const rendered=toRender.length?toRender.map(p=>{
      const stock=getStock(p),stockClass=stock===0?"out":"in",stockText=stock===0?"Out of stock":"In stock",image=getThumb(p);
      const saved=wishlistIds.has(String(p.id));
      return "<article class='product-card' data-product-id='"+esc(p.id)+"'>"+
        "<div class='product-image'>"+(image?"<img src='"+esc(image)+"'"+responsiveSource(p)+" alt='"+esc(p.product_name)+"' width='320' height='320' loading='lazy' decoding='async'>":"<div class='placeholder'>RG</div>")+
        "<button type='button' class='product-wishlist-button"+(saved?" is-saved":"")+"' data-wishlist-product='"+esc(p.id)+"' aria-label='"+(saved?"Remove ":"Add ")+esc(p.product_name)+(saved?" from":" to")+" wishlist' aria-pressed='"+saved+"'>"+(saved?"♥":"♡")+"</button></div>"+
        "<div class='product-body'><h3 class='product-name'>"+esc(p.product_name)+"</h3><div class='product-type'>"+esc(categoryFor(p))+"</div>"+
        "<div class='product-meta'><strong class='product-price'>"+money(p.selling_price)+"</strong><span class='product-stock "+stockClass+"'>"+stockText+"</span></div><div class='product-card-actions'><button type='button' data-product-open>Quick view</button><a href='product.html?sku="+encodeURIComponent(p.product_code||"")+"'>Details ↗</a></div></div></article>";
    }).join(""):"<div class='product-empty'>"+(wishlistOnly?"Nothing saved yet. Tap a heart to save a design.":activeSearch?"No matches. Try another search or category.":visualSearchSignature?"No visual matches could be ranked for this image. Try a clearer photo or search by name.":activeCategory?"No "+esc(activeCategory.toLowerCase())+" products are currently in stock.":"No jewellery listed yet.")+"</div>";
    renderPager(false);
    if(appendOnly)grid.insertAdjacentHTML("beforeend",rendered);
    else grid.innerHTML=rendered;
    grid.querySelectorAll("[data-product-id]:not([data-shop-bound])").forEach(card=>{
      card.dataset.shopBound="true";
      const open=()=>openProductModal(catalogueProducts.find(p=>String(p.id)===String(card.dataset.productId)));
      card.addEventListener("click",event=>{if(event.target.closest("[data-wishlist-product],a[href]"))return;open();});
      card.querySelector("[data-product-open]")?.addEventListener("keydown",event=>{if(event.key===" "){event.preventDefault();open();}});
    });
    grid.querySelectorAll("[data-wishlist-product]:not([data-wishlist-bound])").forEach(button=>{button.dataset.wishlistBound="true";button.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();const id=String(button.dataset.wishlistProduct);
      if(wishlistIds.has(id))wishlistIds.delete(id);else wishlistIds.add(id);
      saveWishlist();document.dispatchEvent(new CustomEvent("rainbow:mobile-toast",{detail:{message:wishlistIds.has(id)?"Added to saved designs":"Removed from saved designs"}}));render();
    });});
  }

  function bindCollectionFilters(){
    const mobileTrack=document.getElementById("mobileCategoryTrack");
    mobileTrack?.addEventListener("click",event=>{
      const button=event.target.closest("[data-mobile-category]");
      if(!button)return;
      const targetCategory=button.dataset.mobileCategory||"";
      activeCategory=targetCategory;
      showAllProducts=!targetCategory;
      activeSearch="";visualSearchSignature=null;visualSearchScores.clear();wishlistOnly=false;activeSegment="all";
      const search=document.getElementById("siteSearch");if(search)search.value="";
      showSearchFeedback("");
      const section=document.getElementById("mobileCategorySection");
      section?.classList.remove("is-expanded");
      const seeAll=document.getElementById("mobileCategorySeeAll");
      if(seeAll){seeAll.setAttribute("aria-expanded","false");seeAll.textContent="See all";}
      track("select_category",{category:targetCategory||"all",source:"mobile_category_rail"});
      resetCatalogue();
      document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
    });
    document.getElementById("mobileCategorySeeAll")?.addEventListener("click",event=>{
      const section=document.getElementById("mobileCategorySection");
      if(!section)return;
      const expanded=section.classList.toggle("is-expanded");
      event.currentTarget.setAttribute("aria-expanded",String(expanded));
      event.currentTarget.textContent=expanded?"Show less":"See all";
    });
    const drawer=document.getElementById("shopDrawer");
    if(drawer)drawer.addEventListener("click",event=>{
      const category=event.target.closest("[data-filter-type]");
      if(category){
        event.preventDefault();activeCategory=category.dataset.filterType||"";showAllProducts=false;
        activeSearch="";visualSearchSignature=null;visualSearchScores.clear();wishlistOnly=false;
        const search=document.getElementById("siteSearch");if(search)search.value="";
        resetCatalogue();closeShopDrawer();document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});return;
      }
      const segment=event.target.closest("[data-segment]");
      if(segment){
        activeSegment=segment.dataset.segment||"all";activeCategory="";activeSearch="";showAllProducts=false;visualSearchSignature=null;visualSearchScores.clear();wishlistOnly=false;
        const search=document.getElementById("siteSearch");if(search)search.value="";
        resetCatalogue();closeShopDrawer();document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
      }
      if(event.target.closest("[data-close-drawer]"))closeShopDrawer();
    });
    document.getElementById("browseAllProducts")?.addEventListener("click",()=>{
      showAllProducts=true;activeCategory="";activeSearch="";visualSearchSignature=null;wishlistOnly=false;
      const search=document.getElementById("siteSearch");if(search)search.value="";
      resetCatalogue();document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
    });
    const clearButton=document.getElementById("clearProductFilter");
    if(clearButton)clearButton.addEventListener("click",()=>{
      if(activeCategory){
        activeCategory="";
      }else{
        activeSearch="";visualSearchSignature=null;visualSearchScores.clear();activeSegment="all";wishlistOnly=false;showAllProducts=false;
        const search=document.getElementById("siteSearch");if(search)search.value="";
      }
      resetCatalogue();showSearchFeedback("");
    });
  }

  function showSearchFeedback(message,isError=false){
    const feedback=document.getElementById("searchFeedback");if(!feedback)return;
    feedback.textContent=message||"";feedback.hidden=!message;feedback.classList.toggle("is-error",Boolean(isError));
  }
  function applyTextSearch(){
    const field=document.getElementById("siteSearch");activeSearch=String(field?.value||"").trim();
    activeCategory="";activeSegment="all";wishlistOnly=false;visualSearchSignature=null;showAllProducts=false;visualSearchScores.clear();
    resetCatalogue().then(()=>track("search",{results:paging.total}));showSearchFeedback(activeSearch?"Searching catalogue for \""+activeSearch+"\".":"");
    document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
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
      visualSearchSignature=reference;activeSearch="";activeCategory="";activeSegment="all";wishlistOnly=false;showAllProducts=false;
      const field=document.getElementById("siteSearch");if(field)field.value="";
      render();showSearchFeedback("Visual colour matching ranks only the "+catalogueProducts.length+" currently loaded designs, not all 10,000. Use text search for a full-catalogue search.");
      document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
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
      wishlistOnly=!wishlistOnly;activeCategory="";activeSearch="";showAllProducts=false;visualSearchSignature=null;visualSearchScores.clear();activeSegment="all";
      const field=document.getElementById("siteSearch");if(field)field.value="";
      resetCatalogue();showSearchFeedback(wishlistOnly?"Showing your saved items.":"");
      document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});
    });
    document.getElementById("drawerWishlistAction")?.addEventListener("click",()=>{closeShopDrawer();wishlistOnly=true;activeCategory="";activeSearch="";showAllProducts=false;visualSearchSignature=null;visualSearchScores.clear();activeSegment="all";resetCatalogue();document.getElementById("products")?.scrollIntoView({behavior:scrollBehavior,block:"start"});});
    document.getElementById("accountOpen")?.addEventListener("click",openAccountOverlay);
    document.querySelectorAll("[data-account-mode]").forEach(button=>button.addEventListener("click",()=>setAccountAuthMode(button.dataset.accountMode)));
    document.getElementById("accountSignInForm")?.addEventListener("submit",submitAccountSignIn);
    document.getElementById("accountSignUpForm")?.addEventListener("submit",submitAccountSignUp);
    document.getElementById("accountSignOut")?.addEventListener("click",signOutAccount);
    document.querySelectorAll("[data-close-utility]").forEach(button=>button.addEventListener("click",closeUtilityOverlays));
    document.getElementById("trackingForm")?.addEventListener("submit",submitOrderTracking);
    document.getElementById("menuToggle")?.addEventListener("click",openShopDrawer);
    document.getElementById("drawerClose")?.addEventListener("click",closeShopDrawer);
    document.getElementById("drawerScrim")?.addEventListener("click",closeShopDrawer);
    document.addEventListener("keydown",event=>{
      const utility=document.querySelector(".utility-overlay:not([hidden])");
      const drawer=document.getElementById("shopDrawer");
      if(event.key==="Tab"){
        if(utility)trapDialogFocus(event,utility.querySelector(".utility-panel"));
        else if(drawer?.classList.contains("is-open"))trapDialogFocus(event,drawer);
        return;
      }
      if(event.key!=="Escape")return;
      if(utility){event.preventDefault();closeUtilityOverlays();}
      else if(drawer?.classList.contains("is-open")){event.preventDefault();closeShopDrawer();}
    });
    updateWishlistCount();
  }
  function openShopDrawer(){
    const drawer=document.getElementById("shopDrawer"),scrim=document.getElementById("drawerScrim"),toggle=document.getElementById("menuToggle");
    if(!drawer||!scrim||drawer.classList.contains("is-open"))return;
    drawerReturnFocus=document.activeElement;
    drawer.classList.add("is-open");drawer.setAttribute("aria-hidden","false");drawer.removeAttribute("inert");
    scrim.hidden=false;requestAnimationFrame(()=>scrim.classList.add("is-visible"));
    document.body.classList.add("drawer-open");if(toggle)toggle.setAttribute("aria-expanded","true");
    document.getElementById("drawerClose")?.focus();
  }
  function closeShopDrawer(){
    const drawer=document.getElementById("shopDrawer"),scrim=document.getElementById("drawerScrim"),toggle=document.getElementById("menuToggle");
    if(!drawer||!scrim||!drawer.classList.contains("is-open"))return;
    drawer.classList.remove("is-open");drawer.setAttribute("aria-hidden","true");drawer.setAttribute("inert","");
    scrim.classList.remove("is-visible");window.setTimeout(()=>{if(!scrim.classList.contains("is-visible"))scrim.hidden=true;},260);
    document.body.classList.remove("drawer-open");
    if(toggle)toggle.setAttribute("aria-expanded","false");
    const restore=drawerReturnFocus?.isConnected?drawerReturnFocus:toggle;
    drawerReturnFocus=null;
    restore?.focus({preventScroll:true});
  }
  function openUtilityOverlay(id){
    const overlay=document.getElementById(id);if(!overlay)return;
    if(!document.querySelector(".utility-overlay:not([hidden])"))utilityReturnFocus=document.activeElement;
    closeUtilityOverlays(false);
    overlay.hidden=false;overlay.setAttribute("aria-hidden","false");document.body.classList.add("utility-open");
    (overlay.querySelector(".utility-panel input:not([disabled]):not([hidden])")||overlay.querySelector(".utility-close"))?.focus();
  }
  function closeUtilityOverlays(restoreFocus=true){
    const wasOpen=Boolean(document.querySelector(".utility-overlay:not([hidden])"));
    document.querySelectorAll(".utility-overlay").forEach(overlay=>{overlay.hidden=true;overlay.setAttribute("aria-hidden","true");});
    document.body.classList.remove("utility-open");
    if(wasOpen&&restoreFocus!==false){
      const restore=utilityReturnFocus;utilityReturnFocus=null;
      if(restore?.isConnected)restore.focus({preventScroll:true});
    }
  }
  function openTrackingOverlay(){openUtilityOverlay("trackingOverlay");loadMyOrdersInto(document.getElementById("trackingAutoOrders"),"Tracking");}
  function setAccountAuthMessage(message,isError=false){
    const node=document.getElementById("accountAuthMessage");
    if(!node)return;
    node.textContent=message||"";
    node.classList.toggle("is-error",Boolean(isError));
  }
  function setAccountAuthMode(mode){
    const isSignup=mode==="signup";
    document.querySelectorAll("[data-account-mode]").forEach(button=>{
      const active=button.dataset.accountMode===(isSignup?"signup":"signin");
      button.classList.toggle("is-active",active);
      button.setAttribute("aria-pressed",String(active));
    });
    const signIn=document.getElementById("accountSignInForm");
    const signUp=document.getElementById("accountSignUpForm");
    if(signIn)signIn.hidden=isSignup;
    if(signUp)signUp.hidden=!isSignup;
    setAccountAuthMessage("");
  }
  function renderAccountAuthState(session){
    const user=session?.user||null;
    const authForms=document.getElementById("accountAuthForms");
    const signedIn=document.getElementById("accountSignedIn");
    const identity=document.getElementById("accountIdentity");
    const nameNode=document.getElementById("accountSignedInName");
    const emailNode=document.getElementById("accountSignedInEmail");
    const accountButton=document.getElementById("accountOpen");
    if(authForms)authForms.hidden=Boolean(user);
    if(signedIn)signedIn.hidden=!user;
    if(user){
      const name=String(user.user_metadata?.full_name||"").trim();
      if(identity)identity.textContent="You're signed in to your Rainbow customer account.";
      if(nameNode)nameNode.textContent=name?("Welcome, "+name):"Welcome to Rainbow";
      if(emailNode)emailNode.textContent=user.email||"";
      if(accountButton){accountButton.setAttribute("aria-label","Your account, signed in");accountButton.title="Your account";}
    }else{
      if(identity)identity.textContent="Sign in to see your orders.";
      if(nameNode)nameNode.textContent="";
      if(emailNode)emailNode.textContent="";
      if(accountButton){accountButton.setAttribute("aria-label","Your account and orders");accountButton.title="Your account";}
      setAccountAuthMode("signin");
    }
  }
  async function refreshAccountPanel(){
    const orders=document.getElementById("accountOrders");
    if(!client){
      renderAccountAuthState(null);
      setAccountAuthMessage("Account sign-in is temporarily unavailable. Please try again shortly.",true);
      if(orders)orders.innerHTML='<p class="muted">Order history is temporarily unavailable.</p>';
      return;
    }
    try{
      const {data,error}=await client.auth.getSession();
      if(error)throw error;
      const session=data?.session||null;
      renderAccountAuthState(session);
      if(session)await loadMyOrdersInto(orders,"Account");
      else if(orders)orders.innerHTML='<p class="muted">Sign in to see orders linked to your account. Guest orders can be tracked with a product code and phone number.</p>';
    }catch(error){
      renderAccountAuthState(null);
      setAccountAuthMessage(error.message||"Unable to check your account. Please try again.",true);
      if(orders)orders.innerHTML='<p class="muted">Order history is temporarily unavailable.</p>';
    }
  }
  async function submitAccountSignIn(event){
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),label=button?.textContent||"Sign in";
    const email=String(document.getElementById("accountSignInEmail")?.value||"").trim().toLowerCase();
    const password=String(document.getElementById("accountSignInPassword")?.value||"");
    if(!client){setAccountAuthMessage("Account sign-in is temporarily unavailable. Please try again shortly.",true);return;}
    if(button){button.disabled=true;button.textContent="Signing in…";}
    setAccountAuthMessage("");
    try{
      const {error}=await client.auth.signInWithPassword({email,password});
      if(error)throw error;
      form.reset();
      await refreshAccountPanel();
    }catch(error){
      setAccountAuthMessage(error.message||"Unable to sign in. Check your details and try again.",true);
    }finally{
      if(button){button.disabled=false;button.textContent=label;}
    }
  }
  async function submitAccountSignUp(event){
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),label=button?.textContent||"Create account";
    const name=String(document.getElementById("accountSignUpName")?.value||"").trim();
    const email=String(document.getElementById("accountSignUpEmail")?.value||"").trim().toLowerCase();
    const phoneInput=String(document.getElementById("accountSignUpPhone")?.value||"").trim();
    const phone=phoneInput.replace(/\D/g,"");
    const password=String(document.getElementById("accountSignUpPassword")?.value||"");
    if(name.length>120){setAccountAuthMessage("Please keep your name under 120 characters.",true);return;}
    if(phone.length<10||phone.length>13){setAccountAuthMessage("Enter a valid phone number with 10 to 13 digits.",true);return;}
    if(!client){setAccountAuthMessage("Account sign-up is temporarily unavailable. Please try again shortly.",true);return;}
    if(button){button.disabled=true;button.textContent="Creating account…";}
    setAccountAuthMessage("");
    try{
      const {data,error}=await client.auth.signUp({
        email,password,
        options:{data:{full_name:name,phone,account_type:"storefront_customer"}}
      });
      if(error)throw error;
      if(data?.session){
        form.reset();
        await refreshAccountPanel();
      }else{
        setAccountAuthMessage("Check your inbox for an email confirmation link. If this email already has an account, sign in instead.");
      }
    }catch(error){
      setAccountAuthMessage(error.message||"Unable to create your account. Please try again.",true);
    }finally{
      if(button){button.disabled=false;button.textContent=label;}
    }
  }
  async function signOutAccount(){
    if(!client)return;
    const button=document.getElementById("accountSignOut");
    if(button){button.disabled=true;button.textContent="Signing out…";}
    try{
      const {error}=await client.auth.signOut();
      if(error)throw error;
      renderAccountAuthState(null);
      setAccountAuthMessage("You are signed out.");
      const orders=document.getElementById("accountOrders");
      if(orders)orders.innerHTML='<p class="muted">Sign in to see orders linked to your account. Guest orders can be tracked with a product code and phone number.</p>';
    }catch(error){
      setAccountAuthMessage(error.message||"Unable to sign out. Please try again.",true);
    }finally{
      if(button){button.disabled=false;button.textContent="Sign out";}
    }
  }
  function openAccountOverlay(){
    openUtilityOverlay("accountOverlay");
    setAccountAuthMessage("");
    refreshAccountPanel();
  }
  function shipmentCardMarkup(order,helpers){
    const {shipmentTimeline,trackingStatus,TRACKING_URL}=helpers;
    const shipped=Boolean(order.consignment_number);
    const status=String(order.order_status||order.status||"pending").toLowerCase();
    const {steps,notice}=shipmentTimeline(status,order.shipment_status);
    const date=order.created_at?new Date(order.created_at).toLocaleDateString("en-IN"):"";
    const dispatched=order.dispatch_date?new Date(order.dispatch_date+"T12:00:00").toLocaleDateString("en-IN"):"";
    const updated=order.shipment_updated_at?new Date(order.shipment_updated_at).toLocaleString("en-IN"):"";
    const tracking=shipped?'<div class="customer-shipment"><div class="customer-shipment-head"><span>Courier</span><strong>'+esc(order.courier_provider||"The Professional Couriers")+'</strong></div>'+
      '<div class="customer-shipment-head"><span>Consignment</span><strong>'+esc(order.consignment_number)+'</strong></div>'+
      '<div class="customer-shipment-head"><span>Shipped on</span><strong>'+esc(dispatched||"Awaiting dispatch")+'</strong></div>'+
      '<div class="customer-shipment-head"><span>Latest store-verified status</span><strong>'+esc(trackingStatus(order.shipment_status))+'</strong></div>'+
      '<p class="tracking-manual-note">Updated by Rainbow staff'+(updated?" · "+esc(updated):"")+'. Not a live courier update.</p>'+
      '<a class="tracking-courier-link" href="'+TRACKING_URL+'" target="_blank" rel="noopener noreferrer">Track on Professional Couriers ↗</a></div>'
      :'<p class="tracking-manual-note">Tracking details will appear here when the store dispatches your order.</p>';
    const timeline='<ol class="shipment-timeline" aria-label="Delivery progress">'+steps.map(step=>
      '<li class="shipment-step is-'+step.state+'"><span class="shipment-dot" aria-hidden="true"></span><span>'+esc(step.label)+'</span></li>').join("")+'</ol>';
    return '<article class="active-order-card"><div class="tracking-result-top"><div><strong>'+esc(order.order_number)+'</strong>'+
      '<small>'+esc(order.product_names||order.product_name||"Online order")+(date?" · "+esc(date):"")+'</small></div>'+
      '<span class="tracking-status '+esc(status)+'">'+esc(status)+'</span></div>'+
      '<small>Payment: '+esc(order.payment_status||"pending")+(order.total_amount!=null?' · Total ₹'+Number(order.total_amount).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}):"")+'</small>'+
      (notice?'<p class="tracking-manual-note">'+esc(notice)+'</p>':"")+timeline+tracking+'</article>';
  }
  async function loadMyOrdersInto(container,label){
    if(!container)return;
    container.hidden=false;
    container.innerHTML='<p class="muted">Looking up your orders securely…</p>';
    try{
      if(!client){container.innerHTML='<p class="muted">Sign-in is currently unavailable. Use the guest order lookup below.</p>';return;}
      const sessionResult=await client.auth.getSession();
      if(sessionResult.error)throw sessionResult.error;
      if(!sessionResult.data?.session){container.innerHTML='<p class="muted">Sign in or use the product-code and phone lookup below.</p>';return;}
      const [{data,error},helpers]=await Promise.all([
        client.rpc("track_my_order_shipments"),
        import("./admin/shipment-utils.mjs")
      ]);
      if(error)throw error;
      const orders=Array.isArray(data)?data:[];
      container.innerHTML=orders.length
        ?'<p class="tracking-panel-label">MY ORDERS · STORE-UPDATED TRACKING</p>'+orders.map(order=>shipmentCardMarkup(order,helpers)).join("")
        :'<p class="muted">No online orders are linked to this account email. You can also use the guest lookup form.</p>';
    }catch(error){
      console.warn("Account order tracking unavailable",error?.code||"");
      container.innerHTML='<p class="muted">Order history is temporarily unavailable. Try the guest lookup below.</p>';
    }
  }
  async function submitOrderTracking(event){
    event.preventDefault();
    const code=String(document.getElementById("trackingProductCode")?.value||"").trim();
    const phone=String(document.getElementById("trackingPhone")?.value||"").trim();
    const message=document.getElementById("trackingMessage"),results=document.getElementById("trackingResults");
    if(message){message.textContent="Checking your order…";message.classList.remove("error");}
    if(results)results.innerHTML="";
    if(!code||phone.replace(/[^0-9]/g,"").length<10){
      if(message){message.textContent="Enter the product code and a valid phone number.";message.classList.add("error");}
      return;
    }
    try{
      if(!client)throw new Error("Tracking is temporarily unavailable.");
      const [{data,error},helpers]=await Promise.all([
        client.rpc("track_guest_order_shipments",{p_product_code:code,p_phone:phone}),
        import("./admin/shipment-utils.mjs")
      ]);
      if(error)throw error;
      const orders=Array.isArray(data)?data:[];
      if(!orders.length){if(message)message.textContent="No matching online order was found.";return;}
      if(message)message.textContent=orders.length+" matching order"+(orders.length===1?"":"s")+" found.";
      if(results)results.innerHTML=orders.map(order=>shipmentCardMarkup(order,helpers)).join("");
    }catch(error){
      console.warn("Guest order tracking failed",error?.code||"");
      if(message){message.textContent="We couldn't check the order right now. Please try again.";message.classList.add("error");}
    }
  }

  function openProductModal(product){
    if(!product)return;
    const modal=document.getElementById("productModal"),content=document.getElementById("productModalContent");
    const panel=modal?.querySelector(".product-modal-panel");
    if(!modal||!content)return;
    if(!modal.classList.contains("open"))modalReturnFocus=document.activeElement;
    activeProductId=String(product.id);track("view_item",{item_id:product.product_code||product.id});
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
        detailsPanel+lengthGuide+
        '<div class="product-support-card"><span>Need help?</span><p>Ask us about this design, sizing, or delivery options.</p><button type="button" data-contact-store>Contact Rainbow on WhatsApp <span aria-hidden="true">↗</span></button></div>'+
        '<p class="product-permalink"><a href="product.html?sku='+encodeURIComponent(product.product_code||"")+'">View full details &amp; share ↗</a></p>'+
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
    stopGalleryRotation();
    const showGalleryImage=index=>{
      if(images.length<2)return;
      activeImageIndex=(index+images.length)%images.length;
      const image=content.querySelector("[data-gallery-main]");
      const entry=images[activeImageIndex];
      if(image){image.src=entry.public_url;image.alt=product.product_name+" — image "+(activeImageIndex+1);}
      const count=content.querySelector("[data-gallery-count]");
      if(count)count.textContent=(activeImageIndex+1)+" / "+images.length+" photos";
      content.querySelectorAll("[data-gallery-index]").forEach(button=>{
        const active=Number(button.dataset.galleryIndex)===activeImageIndex;
        button.classList.toggle("active",active);
        button.setAttribute("aria-current",String(active));
      });
    };
    const pauseGallery=()=>stopGalleryRotation();
    const resumeGallery=()=>{
      stopGalleryRotation();
      if(galleryReducedMotion||images.length<2)return;
      galleryTimer=window.setInterval(()=>{
        if(document.visibilityState!=="hidden"&&document.getElementById("productModal")?.classList.contains("open")){
          showGalleryImage(activeImageIndex+1);
        }
      },10000);
    };
    content.querySelectorAll("[data-gallery-index]").forEach(button=>button.addEventListener("click",()=>{
      showGalleryImage(Number(button.dataset.galleryIndex||0));
      resumeGallery();
    }));
    const gallery=content.querySelector(".product-detail-main");
    if(gallery&&images.length>1){
      let swipeX=null,swipeY=null;
      gallery.addEventListener("touchstart",event=>{
        const touch=event.changedTouches?.[0];
        if(!touch)return;
        swipeX=touch.clientX;swipeY=touch.clientY;pauseGallery();
      },{passive:true});
      gallery.addEventListener("touchend",event=>{
        const touch=event.changedTouches?.[0];
        if(!touch||swipeX===null)return;
        const dx=touch.clientX-swipeX,dy=touch.clientY-swipeY;
        if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3){
          showGalleryImage(activeImageIndex+(dx<0?1:-1));
          event.stopPropagation(); // Swipe photos, not the next jewellery product.
        }
        swipeX=null;swipeY=null;resumeGallery();
      },{passive:true});
      gallery.addEventListener("mouseenter",pauseGallery);
      gallery.addEventListener("mouseleave",resumeGallery);
      gallery.addEventListener("focusin",pauseGallery);
      gallery.addEventListener("focusout",event=>{
        if(!gallery.contains(event.relatedTarget))resumeGallery();
      });
      gallery.dataset.swipeGallery="true";
      gallery.setAttribute("aria-label","Product photos. Swipe left or right to see more.");
    }
    resumeGallery();
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
      if(replace){
        if(!window.RainbowCatalogue?.startBuyNow(makeCartItem(Math.min(selectedQty,stock)))){
          if(status)status.textContent="Could not start Buy now. Try again.";return;
        }
        location.href="order.html";return;
      }
      const existing=cart.find(item=>String(item.variant_id)===String(selectedVariant.id));
      const oldQty=Number(existing?.quantity||0);
      if(oldQty>=stock){if(status)status.textContent="The cart already contains all available stock for this option.";return;}
      const next=Math.min(stock,oldQty+selectedQty);
      if(existing){existing.quantity=next;existing.variant_label=labelForVariant(selectedVariant);existing.product=makeCartItem(next).product;}
      else cart.push(makeCartItem(next));
      saveCart(cart);track("add_to_cart",{item_id:product.product_code||product.id,quantity:selectedQty});
      document.dispatchEvent(new CustomEvent("rainbow:mobile-toast",{detail:{message:"Added to your bag"}}));
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
      document.dispatchEvent(new CustomEvent("rainbow:mobile-toast",{detail:{message:saved?"Added to saved designs":"Removed from saved designs"}}));
      modalWishlistButton.classList.toggle("is-saved",saved);
      modalWishlistButton.setAttribute("aria-pressed",String(saved));
      const icon=modalWishlistButton.querySelector("span[aria-hidden]");
      const label=modalWishlistButton.querySelector("span:not([aria-hidden])");
      if(icon)icon.textContent=saved?"♥":"♡";
      if(label)label.textContent=saved?"Saved to wishlist":"Save to wishlist";
      render();
    });
    content.querySelector("[data-contact-store]")?.addEventListener("click",()=>{
      const text="Hello Rainbow Gold Covering! I have a question about "+product.product_name+
        " ("+product.product_code+"). Could you help me with this design?";
      const url="https://wa.me/919952436899?text="+encodeURIComponent(text);
      window.open(url,"_blank","noopener,noreferrer");
    });
    updateVariantState();
    if(panel)panel.scrollTop=0;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    document.body.classList.add("modal-open");
    updateProductNavigation();
    modal.querySelector(".product-modal-close")?.focus({preventScroll:true});
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
    stopGalleryRotation();
    const modal=document.getElementById("productModal");if(!modal?.classList.contains("open"))return;
    modal.classList.remove("open");modal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open");activeProductId="";updateProductNavigation();
    const restore=modalReturnFocus;modalReturnFocus=null;
    if(restore?.isConnected)restore.focus({preventScroll:true});
    else document.getElementById("mainContent")?.focus({preventScroll:true});
  }
  function bindProductModal(){
    document.querySelectorAll("[data-close-product]").forEach(el=>el.addEventListener("click",closeProductModal));
    document.querySelector("[data-product-prev]")?.addEventListener("click",()=>navigateProduct(-1));
    document.querySelector("[data-product-next]")?.addEventListener("click",()=>navigateProduct(1));
    document.addEventListener("keydown",e=>{
      const modal=document.getElementById("productModal");
      if(!modal?.classList.contains("open"))return;
      if(e.key==="Escape"){e.preventDefault();closeProductModal();return;}
      if(e.key==="Tab"){trapDialogFocus(e,modal);return;}
      if(["INPUT","TEXTAREA","SELECT"].includes(e.target?.tagName))return;
      if(e.key==="ArrowLeft"){e.preventDefault();navigateProduct(-1);}
      if(e.key==="ArrowRight"){e.preventDefault();navigateProduct(1);}
    });
    let touchStartX=null;
    const modal=document.getElementById("productModal");
    modal?.addEventListener("touchstart",event=>{if(window.matchMedia("(max-width:767px)").matches)return;touchStartX=event.changedTouches?.[0]?.clientX??null;},{passive:true});
    modal?.addEventListener("touchend",event=>{
      if(window.matchMedia("(max-width:767px)").matches)return; // Gallery handles photo swipes on phones.
      const end=event.changedTouches?.[0]?.clientX;
      if(touchStartX===null||end===undefined)return;
      const delta=end-touchStartX;
      if(Math.abs(delta)>70)navigateProduct(delta<0?1:-1);
      touchStartX=null;
    },{passive:true});
  }

  function pageFilters(){
    const selected=catalogueCategories.find(x=>normalizeCategory(x.name)===normalizeCategory(activeCategory));
    return {
      search:visualSearchSignature?"":activeSearch,
      categoryId:activeCategory?(selected?.id||"00000000-0000-0000-0000-000000000000"):null,
      segment:activeSegment,sort:catalogueSort,
      minPrice:filterState.minPrice,maxPrice:filterState.maxPrice,
      color:filterState.color,size:filterState.size,length:filterState.length,
      wishlistIds:wishlistOnly?[...wishlistIds]:undefined,
      searchCategoryIds:activeSearch?catalogueCategories.filter(item=>normalizeCategory(item.name).includes(normalizeCategory(activeSearch))).map(item=>item.id):[]
    };
  }
  function renderPager(categoryLanding=false){
    const pager=document.getElementById("cataloguePager"),status=document.getElementById("cataloguePageStatus");
    const button=document.getElementById("loadMoreProducts");
    if(!pager||!button||!status)return;
    pager.hidden=categoryLanding||(!paging.hasMore&&!paging.error&&!paging.loading&&paging.offset===0);
    if(pager.hidden)return;
    status.textContent=paging.error?"Unable to load designs: "+paging.error
      :paging.loading?"Loading jewellery…"
      :"Showing "+catalogueProducts.length+" of "+paging.total+" available designs.";
    button.hidden=!paging.hasMore&&!paging.error;
    button.disabled=paging.loading;
    button.textContent=paging.error?"Retry loading":paging.loading?"Loading…":"Load more jewellery";
  }
  async function loadMoreProducts(manual=false){
    if(!client||!catalogue||paging.loading||(!paging.hasMore&&!paging.error))return;
    const epoch=paging.epoch;
    paging.loading=true;paging.error="";render();
    let deadline=null;
    try{
      const response=await Promise.race([
        catalogue.page(client,{...pageFilters(),offset:paging.offset,limit:catalogue.PAGE_SIZE}),
        new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error("Catalogue request timed out")),10000);})
      ]);
      if(epoch!==paging.epoch)return;
      const known=new Set(catalogueProducts.map(product=>String(product.id)));
      for(const product of response.items){
        if(!known.has(String(product.id))){catalogueProducts.push(product);known.add(String(product.id));}
      }
      paging.offset+=response.items.length;
      paging.total=response.total;
      paging.hasMore=response.hasMore&&response.items.length>0;
      if(!manual)paging.autoPages++;
      syncShopFilters();
      render();renderPromotion();
      if(activeSearch)showSearchFeedback(""); // The live result count below replaces the temporary search message.
    }catch(error){
      if(epoch!==paging.epoch)return;
      console.warn("Catalogue page failed",error);
      paging.error="Check your connection and try again.";
    }finally{
      if(deadline!==null)clearTimeout(deadline);
      if(epoch===paging.epoch){paging.loading=false;render();renderPager(false);}
    }
  }
  function resetCatalogue(){
    paging.epoch++;paging.offset=0;paging.total=0;paging.loading=false;paging.error="";
    paging.hasMore=true;paging.autoPages=0;
    catalogueProducts=[];visibleProducts=[];
    return loadMoreProducts();
  }
  function bindCataloguePaging(){
    document.getElementById("loadMoreProducts")?.addEventListener("click",()=>loadMoreProducts(true));
    // Delegation survives skeleton/error/grid replacements without duplicate listeners.
    document.getElementById("productGrid")?.addEventListener("click",event=>{
      if(!event.target.closest("#catalogueRetry"))return;
      if(metadataError){void loadProducts();return;}
      if(paging.error&&paging.offset>0)void loadMoreProducts(true);
      else void resetCatalogue();
    });
    const sentinel=document.getElementById("catalogueSentinel");
    if(sentinel&&"IntersectionObserver" in window){
      loaderObserver=new IntersectionObserver(entries=>{
        if(!entries.some(entry=>entry.isIntersecting))return;
        if(paging.autoPages<8&&paging.hasMore&&!paging.loading&&!paging.error&&
           !visualSearchSignature&&!document.getElementById("cataloguePager")?.hidden){
          loadMoreProducts();
        }
      },{rootMargin:"450px 0px",threshold:0});
      loaderObserver.observe(sentinel);
    }
  }
  function scheduleCatalogRefresh(){
    if(document.visibilityState==="hidden")return;
    if(realtimeRefreshTimer)window.clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer=window.setTimeout(()=>{
      realtimeRefreshTimer=null;
      // Keep a scrolled catalogue stable. Checkout always checks the authoritative stock.
      if(paging.offset>catalogue.PAGE_SIZE)return;
      loadProducts();
    },400);
  }
  async function loadProducts(){
    if(metadataLoading)return;
    metadataLoading=true;metadataError=false;
    paging.loading=true;paging.error="";render();
    const status=document.getElementById("productStatus");
    try{
      if(!catalogue)throw new Error("Catalogue discovery module was not loaded.");
      const [categoriesResult,promotionResult]=await Promise.all([
        client.from("categories").select("id,name,storefront_order,show_in_storefront")
          .eq("active",true).order("storefront_order",{ascending:true}).order("name",{ascending:true}),
        client.from("storefront_promotion_items").select("product_id,display_order").order("display_order",{ascending:true}).limit(8)
      ]);
      if(categoriesResult.error)throw categoriesResult.error;
      catalogueCategories=categoriesResult.data||[];
      // Await authoritative counts before drawing the mobile rail: no empty flash.
      await loadCategoryStockCounts();
      promotionProductIds=promotionResult.error?[]:(promotionResult.data||[]).map(p=>String(p.product_id));
      const [latestResult,promotionResultPage]=await Promise.all([
        catalogue.page(client,{sort:"newest",limit:4}),
        promotionProductIds.length?catalogue.page(client,{wishlistIds:promotionProductIds,limit:8})
          :Promise.resolve({items:[]})
      ]);
      newestProducts=latestResult.items;
      promotionProducts=promotionResultPage.items;
      renderMobileCategories();
      renderLatestArrivals();
      renderPromotion();
      paging.loading=false;
      await resetCatalogue();
    }catch(error){
      console.warn("Catalogue metadata unavailable",error);
      metadataError=true;paging.error="Check your connection and try again.";
      paging.loading=false;render();
      if(status)status.textContent="Catalogue unavailable";
      const categoryLoading=document.querySelector("#mobileCategoryTrack .mobile-category-loading");
      if(categoryLoading)categoryLoading.textContent="Collections are temporarily unavailable. Refresh to try again.";
    }finally{metadataLoading=false;}
  }
  function startRealtime(){
    if(!client||realtimeChannel)return;
    realtimeChannel=client.channel("customer-product-catalogue")
      .on("postgres_changes",{event:"*",schema:"public",table:"products"},scheduleCatalogRefresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"product_variants"},scheduleCatalogRefresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"product_images"},scheduleCatalogRefresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"categories"},scheduleCatalogRefresh)
      .subscribe();
  }

  async function init(){
    applyBusinessConfig();
    updateCartCount();
    updateWishlistCount();
    bindProductModal();
    document.getElementById("promotionView")?.addEventListener("click",()=>{
      const current=promotionSlides[promotionActive];
      if(current?.product&&getStock(current.product)>0)openProductModal(current.product);
    });
    document.getElementById("promotionPrevious")?.addEventListener("click",()=>displayPromotionSlide(promotionActive-1));
    document.getElementById("promotionNext")?.addEventListener("click",()=>displayPromotionSlide(promotionActive+1));
    const frame=document.getElementById("promotionCarousel");
    if(frame){
      frame.addEventListener("mouseenter",()=>{promotionPaused=true;});
      frame.addEventListener("mouseleave",()=>{promotionPaused=false;});
      frame.addEventListener("focusin",()=>{promotionPaused=true;});
      frame.addEventListener("focusout",event=>{
        if(!frame.contains(event.relatedTarget))promotionPaused=false;
      });
    }
    bindCollectionFilters();
    bindAdvancedFilters();
    bindCataloguePaging();
    bindHeaderActions();
    document.querySelectorAll("[data-scroll]").forEach(button=>button.addEventListener("click",()=>{
      document.querySelector(button.dataset.scroll)?.scrollIntoView({behavior:scrollBehavior});
    }));
    const year=document.getElementById("year");if(year)year.textContent=new Date().getFullYear();
    if(!window.supabase?.createClient||!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY){
      const status=document.getElementById("productStatus");
      if(status)status.textContent="The product catalogue is temporarily unavailable.";
      const categoryLoading=document.querySelector("#mobileCategoryTrack .mobile-category-loading");
      if(categoryLoading)categoryLoading.textContent="Collections are temporarily unavailable. Refresh to try again.";
      return;
    }
    client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
    await loadProducts();
    startRealtime();
    // Fallback refresh keeps the catalogue current even if realtime is temporarily unavailable.
    refreshInterval=window.setInterval(scheduleCatalogRefresh,120000);
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")scheduleCatalogRefresh();});
    window.addEventListener("pagehide",()=>{
      if(refreshInterval)window.clearInterval(refreshInterval);
      if(promotionTimer)window.clearInterval(promotionTimer);
      stopGalleryRotation();
      if(realtimeRefreshTimer)window.clearTimeout(realtimeRefreshTimer);
      if(client&&realtimeChannel)client.removeChannel(realtimeChannel);
      if(loaderObserver)loaderObserver.disconnect();
      realtimeChannel=null;
    },{once:true});
  }
  init();
})();