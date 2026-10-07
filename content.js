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
    const images=Array.isArray(product.product_images)?product.product_images:[];
    const main=getImage(product);
    const stock=getStock(product);
    const variants=Array.isArray(product.product_variants)?product.product_variants:[];
    const details=[
      ["Product code",product.product_code],
      ["Category",product.type||"Jewellery"],
      ["Material",product.material],
      ["Plating",product.plating],
      ["Thickness",product.thickness],
      ["Length",product.length],
      ["Gender",product.gender]
    ].filter(x=>x[1]!==null&&x[1]!==undefined&&String(x[1]).trim()!=="");
    content.innerHTML='<div class="product-detail-grid"><div><div class="product-detail-main">'+(main?'<img src="'+esc(main)+'" alt="'+esc(product.product_name)+'">':'<div class="placeholder">RG</div>')+'</div>'+(images.length>1?'<div class="product-detail-thumbs">'+images.map(i=>'<img src="'+esc(i.public_url||"")+'" alt="" loading="lazy">').join("")+'</div>':"")+'</div><div class="product-detail-info"><span class="section-kicker">PRODUCT DETAILS</span><h2 id="modalProductName">'+esc(product.product_name)+'</h2><div class="modal-price">'+money(product.selling_price)+'</div><span class="product-stock '+(stock===0?"out":"in")+'">'+(stock===0?"Out of stock":"Available")+'</span>'+(product.description?'<p class="modal-description">'+esc(product.description)+'</p>':"")+(details.length?'<div class="detail-list">'+details.map(d=>'<div><span>'+esc(d[0])+'</span><strong>'+esc(d[1])+'</strong></div>').join("")+'</div>':"")+'<a class="btn btn-dark modal-instagram" href="https://www.instagram.com/rainbow_kollam_gold_covering/" target="_blank" rel="noopener noreferrer">View more on Instagram →</a></div></div>';
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

  async function loadProducts(){
    const status=document.getElementById("productStatus");
    try{
      const {data,error}=await client.from("products")
        .select("id,product_code,product_name,type,selling_price,description,material,plating,thickness,length,gender,created_at,product_variants(stock_quantity,low_stock_limit),product_images(public_url,is_primary)")
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
    bindProductModal();
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