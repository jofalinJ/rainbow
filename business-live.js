(() => {
  const cfg=window.RAINBOW_CONFIG||{};
  const esc=v=>String(v??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  async function loadBusiness(){
    if(!window.supabase?.createClient)return;
    if(!cfg.supabaseUrl||!cfg.supabasePublishableKey)return;
    const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
    try{
      const [{data:settings,error:sError},{data:branches,error:bError}]=await Promise.all([
        client.from("business_settings").select("business_name,legal_display_name,tagline,trust_line,instagram_handle,logo_url").eq("id",true).maybeSingle(),
        client.from("branches").select("id,code,name,address,map_url,active").eq("active",true).order("name")
      ]);
      if(sError)throw sError;if(bError)throw bError;
      if(settings){
        const brand=document.querySelector('[data-config="brandName"]');
        const eyebrow=document.querySelector('[data-config="eyebrow"]');
        const footer=document.querySelector('[data-config="footerBrand"]');
        if(brand)brand.textContent=(settings.business_name||"Rainbow").split(" ")[0].toUpperCase();
        if(eyebrow)eyebrow.textContent=(settings.business_name||"Rainbow Gold Covering").toUpperCase()+" · "+(settings.trust_line||"");
        if(footer)footer.textContent=settings.business_name||"Rainbow Gold Covering";
        document.title=(settings.business_name||"Rainbow Gold Covering")+" — Jewellery, Made to Shine";
      }
      const list=document.getElementById("branchList");
      if(list)list.innerHTML=(branches||[]).map(b=>'<div class="branch"><strong>'+esc(b.name)+'</strong><span>'+esc(b.address)+'</span>'+(b.map_url?'<a href="'+esc(b.map_url)+'" target="_blank" rel="noopener noreferrer">Open in Maps →</a>':"")+"</div>").join("");
    }catch(e){console.warn("Live business settings unavailable.",e);}
  }
  function start(){
    loadBusiness();
    setInterval(loadBusiness,30000);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();