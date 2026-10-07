(() => {
  const SUPABASE_URL="https://ajnicsvtymvvkgepjmmk.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY="sb_publishable_8DVJ4VEsYhfq2RwbbElrGw_h-RsKoWj";
  let client=null, realtimeChannel=null;

  const esc=value=>String(value??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  const money=value=>"₹"+Number(value||0).toLocaleString("en-IN",{maximumFractionDigits:2});
  const getImage=product=>{
    const images=Array.isArray(product.product_images)?product.product_images:[];
    return (images.find(x=>x.is_primary)||images[0]||{}).public_url||"";
  };
  const getStock=product=>(Array.isArray(product.product_variants)?product.product_variants:[])
    .reduce((sum,v)=>sum+Number(v.stock_quantity||0),0);

  function applyBusinessConfig(){
    const cfg=window.RAINBOW_CONFIG;
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
      const stock=getStock(p), low=(p.product_variants||[]).some(v=>stock>0&&stock<=Number(v.low_stock_limit||0));
      const stockClass=stock===0?"out":low?"low":"in";
      const stockText=stock===0?"Out of stock":low?"Low stock":"In stock";
      const image=getImage(p);
      return '<article class="product-card">'+
        '<div class="product-image">'+(image?'<img src="'+esc(image)+'" alt="'+esc(p.product_name)+'" loading="lazy">':'<div class="placeholder">RG</div>')+'</div>'+
        '<div class="product-body"><div class="product-code">'+esc(p.product_code)+'</div>'+
        '<h3 class="product-name">'+esc(p.product_name)+'</h3><div class="product-type">'+esc(p.type||"Jewellery")+'</div>'+
        '<div class="product-meta"><strong class="product-price">'+money(p.selling_price)+'</strong><span class="product-stock '+stockClass+'">'+stockText+'</span></div></div></article>';
    }).join(""):'<div class="product-empty">No products are available yet. New products added by our store team will appear here automatically.</div>';
  }

  async function loadProducts(){
    const status=document.getElementById("productStatus");
    try{
      const {data,error}=await client.from("products")
        .select("id,product_code,product_name,type,selling_price,created_at,product_variants(stock_quantity,low_stock_limit),product_images(public_url,is_primary)")
        .eq("active",true).order("created_at",{ascending:false});
      if(error)throw error;
      render(data||[]);
    }catch(error){
      console.error(error);
      if(status)status.textContent="Products are temporarily unavailable.";
    }
  }

  function startRealtime(){
    if(!client||realtimeChannel)return;
    realtimeChannel=client.channel("customer-product-catalogue")
      .on("postgres_changes",{event:"*",schema:"public",table:"products"},loadProducts)
      .on("postgres_changes",{event:"*",schema:"public",table:"product_variants"},loadProducts)
      .on("postgres_changes",{event:"*",schema:"public",table:"product_images"},loadProducts)
      .subscribe();
  }

  async function init(){
    applyBusinessConfig();
    document.querySelectorAll("[data-scroll]").forEach(button=>button.addEventListener("click",()=>{
      document.querySelector(button.dataset.scroll)?.scrollIntoView({behavior:"smooth"});
    }));
    const year=document.getElementById("year");if(year)year.textContent=new Date().getFullYear();
    if(!window.supabase?.createClient)return;
    client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
    await loadProducts();
    startRealtime();
    // Fallback refresh keeps the catalogue current even if realtime is temporarily unavailable.
    window.setInterval(loadProducts,30000);
  }
  init();
})();