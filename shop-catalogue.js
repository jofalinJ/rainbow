/* Read-only, bounded Supabase catalogue queries. The server filters/counts/sorts before pagination. */
(function(root){
 "use strict";
 const PAGE_SIZE=24,MAX_PAGE_SIZE=48;
 const SELECT_FIELDS="id,product_code,product_name,type,gender,display_priority,category_id,categories(name,storefront_order,show_in_storefront),selling_price,description,length_cm,thickness,gold_amount_g,created_at,product_variants!inner(id,stock_quantity,color,size,length_cm,active),product_images(id,public_url,storage_path,is_primary,sort_order)";
 const cleanSearch=value=>String(value||"").trim().replace(/[^\p{L}\p{N}\s-]/gu," ").replace(/\s+/g," ").slice(0,70);
 const clamp=(v,fallback=PAGE_SIZE)=>Number.isInteger(Number(v))?Math.max(1,Math.min(MAX_PAGE_SIZE,Number(v))):fallback;
 const finitePrice=value=>value!==""&&value!==null&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
 function buildQuery(client,filters={}){
   const limit=clamp(filters.limit),offset=Math.max(0,Math.min(100000,Math.floor(Number(filters.offset)||0)));
   let query=client.from("products").select(SELECT_FIELDS,{count:"exact"})
     .eq("active",true).eq("product_variants.active",true).gt("product_variants.stock_quantity",0);
   const search=cleanSearch(filters.search);
   if(search){
     const term=search.replaceAll(" ","%");
     const categoryIds=(filters.searchCategoryIds||[]).filter(id=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)).slice(0,40);
     const alternatives=["product_name","product_code","type","description"].map(col=>col+".ilike.%"+term+"%");
     // Product codes such as RGC/C00004 must remain exact-searchable.
     const exactCode=String(filters.search||"").trim();
     if(/^[a-z0-9][a-z0-9/_-]{1,39}$/i.test(exactCode))
       alternatives.push("product_code.eq."+exactCode);
     // Common jewellery spelling and Tamil transliteration variants. These expand server queries, not local pages.
     const aliases={
       "jimmiki":["jhumka","jimikki","earring"],
       "jimikki":["jhumka","jimmiki","earring"],
       "jumka":["jhumka","earring"],
       "jhumki":["jhumka","earring"],
       "jhumka":["jimikki","earring"],
       "kammal":["earring","stud"],
       "kolusu":["anklet"],
       "mangalsutra":["thali","thali chain"]
     };
     const alternativesFor=aliases[search.toLowerCase()]||[];
     for(const alias of alternativesFor)
       for(const column of ["product_name","type"])
         alternatives.push(column+".ilike.%"+alias.replaceAll(" ","%")+"%");
     if(categoryIds.length)alternatives.push("category_id.in.("+categoryIds.join(",")+")");
     query=query.or(alternatives.join(","));
   }
   if(filters.categoryId)query=query.eq("category_id",filters.categoryId);
   if(filters.segment==="men")query=query.in("gender",["male","unisex"]);
   if(filters.segment==="women")query=query.in("gender",["women","unisex"]);
   const min=finitePrice(filters.minPrice),max=finitePrice(filters.maxPrice);
   if(min!==null)query=query.gte("selling_price",min);
   if(max!==null)query=query.lte("selling_price",max);
   if(filters.color)query=query.ilike("product_variants.color",String(filters.color).replace(/[%_,()]/g,""));
   if(filters.size)query=query.ilike("product_variants.size",String(filters.size).replace(/[%_,()]/g,""));
   if(filters.length!==" "&&filters.length!==""&&filters.length!=null&&Number.isFinite(Number(filters.length))&&Number(filters.length)>0){
     query=query.eq("product_variants.length_cm",Number(filters.length));
   }
   if(Array.isArray(filters.wishlistIds)){
     const ids=filters.wishlistIds.filter(id=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)).slice(0,400);
     if(ids.length)query=query.in("id",ids);
     else return {query:null,limit,offset,empty:true};
   }
   const sort=filters.sort||"featured";
   if(sort==="price-low")query=query.order("selling_price",{ascending:true});
   else if(sort==="price-high")query=query.order("selling_price",{ascending:false});
   else if(sort==="newest")query=query.order("created_at",{ascending:false});
   else if(sort==="name")query=query.order("product_name",{ascending:true});
   else query=query.order("display_priority",{ascending:false}).order("created_at",{ascending:false});
   query=query.order("id",{ascending:true}).range(offset,offset+limit-1);
   return {query,limit,offset,empty:false};
 }
 async function page(client,filters={}){
   const {query,limit,offset,empty}=buildQuery(client,filters);
   if(empty)return {items:[],total:0,hasMore:false,offset,limit};
   const {data,error,count}=await query;
   if(error)throw error;
   const items=Array.isArray(data)?data:[];
   const total=Math.max(0,Number(count||0));
   return {items,total,offset,limit,hasMore:offset+items.length<total};
 }
 // Images uploaded with the new editor follow this naming scheme. Existing JPEG/PNG images remain unchanged.
 function thumbnailUrl(photo){
   const url=String(photo?.public_url||"");
   const path=String(photo?.storage_path||"");
   if(!path.endsWith("-optimized.webp")||!url.includes("/storage/v1/object/public/product-images/"))return url;
   return url.replace(/-optimized\.webp(?=\?|$)/,"-thumb.webp");
 }
 // Single-item Buy now lives only in this tab; ordinary localStorage bag is untouched.
 // Shared zero-photo placeholder: identical card, quick-view and detail content.
 // Static markup only; never includes any untrusted product values.
 function photoUnavailableMarkup(){
   return '<span class="photo-unavailable" role="img" aria-label="Photo unavailable">'+
     '<span class="photo-unavailable-icon" aria-hidden="true">◇</span>'+
     '<span class="photo-unavailable-label" aria-hidden="true">Photo unavailable</span></span>';
 }
 // Formatting works in integer paise. Existing API/pricing contracts supply
 // rupees; conversion is presentation-only and never changes server totals.
 function formatPaise(amountPaise){
   const paise=Number.isFinite(Number(amountPaise))?Math.round(Number(amountPaise)):0;
   const negative=paise<0?"−":"";
   const absolute=Math.abs(paise);
   const rupees=Math.floor(absolute/100).toLocaleString("en-IN");
   const fraction=absolute%100;
   return negative+"₹"+rupees+(fraction?"."+String(fraction).padStart(2,"0"):"");
 }
 function formatINR(amountRupees){
   const rupees=Number(amountRupees);
   return formatPaise(Math.round((Number.isFinite(rupees)?rupees:0)*100));
 }
 const BUY_NOW_KEY="rainbow_buy_now_v1";
 const validSelection=item=>item&&typeof item==="object"&&typeof item.variant_id==="string"&&
   item.product&&Number.isInteger(Number(item.quantity))&&Number(item.quantity)>=1&&Number(item.quantity)<=100;
 function startBuyNow(item){
   if(!validSelection(item))return false;
   try{sessionStorage.setItem(BUY_NOW_KEY,JSON.stringify(item));return true;}catch{return false;}
 }
 function readBuyNow(){
   try{const item=JSON.parse(sessionStorage.getItem(BUY_NOW_KEY)||"null");return validSelection(item)?item:null;}
   catch{return null;}
 }
 function clearBuyNow(){try{sessionStorage.removeItem(BUY_NOW_KEY);}catch{}}
 root.RainbowCatalogue={PAGE_SIZE,MAX_PAGE_SIZE,buildQuery,page,thumbnailUrl,cleanSearch,
   startBuyNow,readBuyNow,clearBuyNow,photoUnavailableMarkup,formatINR,formatPaise};
})(typeof window==="undefined"?globalThis:window);
