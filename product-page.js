/* Dedicated shareable product URLs; uses existing cart format and read-only catalogue. */
(async function(){
 "use strict";
 const $=id=>document.getElementById(id);
 const safeUrl=new URL(location.href),sku=(safeUrl.searchParams.get("sku")||"").trim();
 const cfg=window.RAINBOW_SUPABASE_CONFIG||{};
 const money=n=>"₹"+Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:2});
 const cartKey="rainbow_cart_v1";
 const set=(id,value)=>{if($(id))$(id).textContent=String(value??"");};
 const showError=message=>{$("productLoading").hidden=true;$("productError").hidden=false;set("productError",message);};
 if(!sku||sku.length>100){showError("This design link is incomplete. Browse available jewellery instead.");return;}
 if(!window.supabase?.createClient||!cfg.supabaseUrl||!cfg.supabasePublishableKey){showError("Catalogue temporarily unavailable. Please try again later.");return;}
 const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
 const fields="id,product_code,product_name,type,selling_price,description,active,length_cm,thickness,gold_amount_g,product_images(public_url,storage_path,is_primary,sort_order),product_variants(id,stock_quantity,color,size,length_cm,active)";
 const imagesOf=p=>(p.product_images||[]).filter(i=>i.public_url).sort((a,b)=>Number(Boolean(b.is_primary))-Number(Boolean(a.is_primary))||Number(a.sort_order||0)-Number(b.sort_order||0)).slice(0,5);
 const inStock=p=>(p.product_variants||[]).filter(v=>v.active!==false&&Number(v.stock_quantity)>0);
 const variantLabel=v=>[v.color&&v.color!=="0"?"Colour: "+v.color:"",v.size&&v.size!=="0"?"Size: "+v.size:"",v.length_cm?"Length: "+v.length_cm+" cm":""].filter(Boolean).join(" · ")||"Standard";
 const cart=()=>{try{const items=JSON.parse(localStorage.getItem(cartKey)||"[]");return Array.isArray(items)?items:[];}catch{return[];}};
 function refreshCart(){set("detailCartCount","("+cart().reduce((s,x)=>s+Number(x.quantity||0),0)+")");}
 let product,selected;
 function updateVariant(){
   selected=inStock(product).find(v=>String(v.id)===$("detailVariant").value)||null;
   const stock=selected?Number(selected.stock_quantity):0;
   set("detailStock",stock>0?stock+" available":"Out of stock");
   $("detailQty").max=String(Math.max(1,stock));$("detailQty").value=String(Math.min(stock||1,Math.max(1,Number($("detailQty").value)||1)));
   $("detailAdd").disabled=!selected;$("detailBuy").disabled=!selected;
 }
 function addToCart(buy){
   if(!selected)return;
   const qty=Number($("detailQty").value);
   if(!Number.isInteger(qty)||qty<1||qty>Number(selected.stock_quantity)){set("detailMessage","Choose an available quantity.");return;}
   const items=buy?[]:cart();
   const existing=items.find(item=>String(item.variant_id)===String(selected.id));
   const current=Number(existing?.quantity||0);
   if(current+qty>Number(selected.stock_quantity)){set("detailMessage","Only "+selected.stock_quantity+" available; reduce the quantity.");return;}
   const line={variant_id:selected.id,quantity:current+qty,variant_label:variantLabel(selected),product:{
     id:product.id,product_code:product.product_code,product_name:product.product_name,type:product.type,
     selling_price:Number(product.selling_price),description:product.description||"",image:imagesOf(product)[0]?.public_url||"",
     variant_color:selected.color||null,variant_size:selected.size||null,variant_length_cm:selected.length_cm||null
   }};
   if(existing)Object.assign(existing,line);else items.push(line);
   try{localStorage.setItem(cartKey,JSON.stringify(items));}catch{set("detailMessage","Could not save your bag on this device.");return;}
   window.RainbowAnalytics?.track("add_to_cart",{item_id:product.product_code,quantity:qty});
   refreshCart();set("detailMessage","Added to your bag.");
   if(buy)location.href="order.html";
 }
 function renderRelated(rows){
   const grid=$("detailRelatedGrid");grid.replaceChildren();
   for(const p of rows.filter(p=>inStock(p).length>0).slice(0,4)){
     const a=document.createElement("a");a.className="detail-related-card";a.href="product.html?sku="+encodeURIComponent(p.product_code);
     const first=imagesOf(p)[0];
     if(first){const img=document.createElement("img");img.src=window.RainbowCatalogue?.thumbnailUrl(first)||first.public_url;img.onerror=()=>{img.onerror=null;img.src=first.public_url;};img.loading="lazy";img.alt=p.product_name;img.width=240;img.height=240;a.append(img);}
     const label=document.createElement("strong");label.textContent=p.product_name;
     const price=document.createElement("span");price.textContent=money(p.selling_price);a.append(label,price);grid.append(a);
   }
   $("detailRelated").hidden=grid.children.length===0;
 }
 try{
   const {data,error}=await client.from("products").select(fields).eq("product_code",sku).eq("active",true).maybeSingle();
   if(error)throw error;if(!data){showError("This design is unavailable or no longer listed.");return;}
   product=data;const variants=inStock(product);const images=imagesOf(product);
   set("crumbName",product.product_name);set("detailCategory",product.type||"Jewellery");set("detailName",product.product_name);
   set("detailSku",product.product_code);set("detailPrice",money(product.selling_price));
   set("detailDescription",product.description||"Contact Rainbow Gold Covering for details about this design.");
   document.title=product.product_name+" | Rainbow Gold Covering";
   document.querySelector('meta[name="description"]').content="Explore "+product.product_name+" from Rainbow Gold Covering. Check current availability and options.";
   const img=$("detailMainImage");
   if(images.length){img.src=images[0].public_url;img.alt=product.product_name;}
   else img.hidden=true;
   const thumbs=$("detailThumbnails");thumbs.replaceChildren();
   images.forEach((entry,index)=>{
     const b=document.createElement("button");b.type="button";b.setAttribute("aria-label","View image "+(index+1));
     const t=document.createElement("img");t.src=window.RainbowCatalogue?.thumbnailUrl(entry)||entry.public_url;t.onerror=()=>{t.onerror=null;t.src=entry.public_url;};t.alt="";t.width=80;t.height=80;t.loading="lazy";b.append(t);
     b.addEventListener("click",()=>{img.src=entry.public_url;img.alt=product.product_name+" image "+(index+1);});thumbs.append(b);
   });
   const specs=[["Thickness",product.thickness],["Length",product.length_cm!=null?product.length_cm+" cm":null],["Gold amount (as recorded)",product.gold_amount_g!=null?product.gold_amount_g+" g":null]];
   for(const [label,value] of specs){if(value==null||value==="")continue;const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=value;$("detailSpecs").append(dt,dd);}
   const select=$("detailVariant");select.replaceChildren();
   variants.forEach(v=>select.add(new Option(variantLabel(v)+" · "+v.stock_quantity+" available",String(v.id))));
   if(!variants.length)select.add(new Option("Unavailable",""));
   select.addEventListener("change",updateVariant);updateVariant();
   $("detailAdd").addEventListener("click",()=>addToCart(false));
   $("detailBuy").addEventListener("click",()=>addToCart(true));
   $("detailShare").addEventListener("click",async()=>{
     try{if(navigator.share)await navigator.share({title:product.product_name,url:location.href});
     else if(navigator.clipboard){await navigator.clipboard.writeText(location.href);set("detailMessage","Link copied.");}
     else set("detailMessage","Copy this page address to share the design.");
     window.RainbowAnalytics?.track("share_product",{item_id:product.product_code});
     }catch(e){if(e.name!=="AbortError")set("detailMessage","Use your browser's share menu to copy the link.");}
   });
   $("detailWhatsApp").href="https://wa.me/919952436899?text="+encodeURIComponent("Hello Rainbow Gold Covering, I'd like to know more about "+product.product_name+" ("+product.product_code+").");
   const json=document.createElement("script");json.type="application/ld+json";
   json.textContent=JSON.stringify({"@context":"https://schema.org","@type":"Product",name:product.product_name,sku:product.product_code,description:product.description||"",image:images.map(x=>x.public_url),brand:{"@type":"Brand",name:"Rainbow Gold Covering"},offers:{"@type":"Offer",price:Number(product.selling_price).toFixed(2),priceCurrency:"INR",availability:variants.length?"https://schema.org/InStock":"https://schema.org/OutOfStock",url:location.href}}).replace(/</g,"\\u003c");
   document.head.append(json);
   $("productLoading").hidden=true;$("productDetail").hidden=false;
   refreshCart();window.RainbowAnalytics?.track("view_item",{item_id:product.product_code});
   if(product.type){const related=await client.from("products").select(fields).eq("active",true).eq("type",product.type).neq("id",product.id).limit(8);if(!related.error)renderRelated(related.data||[]);}
 }catch(error){console.error("Product detail fetch failed",error);showError("We couldn't load this design. Please check your connection and try again.");}
})();
