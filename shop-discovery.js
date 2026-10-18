/* Pure, client-side catalogue discovery helpers. No API calls, personal data, or payment changes. */
(function(root){
  "use strict";
  const norm=value=>String(value??"").normalize("NFKD").toLowerCase().trim().replace(/[^a-z0-9]+/g," ");
  const number=value=>Number.isFinite(Number(value))?Number(value):0;
  function distance(a,b){
    if(Math.abs(a.length-b.length)>2)return 3;
    let previous=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      const current=[i];
      for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
      previous=current;
    }
    return previous[b.length];
  }
  function matchesText(product,search,category){
    const tokens=norm(search).split(" ").filter(Boolean);
    if(!tokens.length)return true;
    const words=norm([product.product_name,product.product_code,product.description,product.type,category].filter(Boolean).join(" ")).split(" ");
    return tokens.every(token=>words.some(word=>word.includes(token)||(token.length>=4&&distance(word,token)<=Math.min(2,Math.floor(token.length/4)))));
  }
  function inStockVariants(product){return (product.product_variants||[]).filter(v=>v.active!==false&&number(v.stock_quantity)>0);}
  function matchesOptions(product,{minPrice="",maxPrice="",color="",size="",length="",inStock=true}={}){
    const price=number(product.selling_price);
    if(minPrice!==""&&price<Number(minPrice))return false;
    if(maxPrice!==""&&price>Number(maxPrice))return false;
    const variants=inStockVariants(product);
    if(inStock&&!variants.length)return false;
    if(!color&&!size&&!length)return true;
    return variants.some(v=>(!color||norm(v.color)===norm(color))&&(!size||norm(v.size)===norm(size))&&
      (!length||String(v.length_cm??product.length_cm??"")===String(length)));
  }
  function sortProducts(products,sort="featured"){
    const copy=[...products];
    if(sort==="price-low")copy.sort((a,b)=>number(a.selling_price)-number(b.selling_price));
    else if(sort==="price-high")copy.sort((a,b)=>number(b.selling_price)-number(a.selling_price));
    else if(sort==="newest")copy.sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
    else if(sort==="name")copy.sort((a,b)=>String(a.product_name||"").localeCompare(String(b.product_name||""),"en"));
    else copy.sort((a,b)=>number(b.display_priority)-number(a.display_priority)||Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
    return copy;
  }
  root.RainbowDiscovery={matchesText,matchesOptions,sortProducts,inStockVariants};
})(typeof window==="undefined"?globalThis:window);
