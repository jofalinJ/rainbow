/* Admin-only homepage promotional product selector. */
(() => {
  const form=document.getElementById("promotionForm");
  if(!form)return;
  const select=document.getElementById("promotionProduct");
  const save=document.getElementById("promotionSave");
  const clear=document.getElementById("promotionClear");
  const feedback=document.getElementById("promotionFeedback");
  const current=document.getElementById("promotionCurrent");
  const preview=document.getElementById("promotionPreview");
  const previewImage=document.getElementById("promotionPreviewImage");
  const previewName=document.getElementById("promotionPreviewName");
  const previewDetail=document.getElementById("promotionPreviewDetail");
  let eligibleProducts=[], savedId="", busy=false;

  const firstImage=product=>[...(product.product_images||[])]
    .filter(item=>item?.public_url)
    .sort((a,b)=>Number(Boolean(b.is_primary))-Number(Boolean(a.is_primary))
      ||Number(a.sort_order||0)-Number(b.sort_order||0))[0]?.public_url||"";
  const stockOf=product=>(product.product_variants||[])
    .filter(variant=>variant.active!==false)
    .reduce((sum,variant)=>sum+Math.max(0,Number(variant.stock_quantity||0)),0);
  const money=amount=>"₹"+Number(amount||0).toLocaleString("en-IN",{maximumFractionDigits:2});
  const productFor=id=>eligibleProducts.find(product=>String(product.id)===String(id));

  function message(text,error=false){
    feedback.textContent=text;
    feedback.classList.toggle("error",error);
    feedback.classList.toggle("success",Boolean(text)&&!error);
  }

  function renderPreview(){
    const selected=productFor(select.value);
    const saved=productFor(savedId);
    current.textContent=savedId
      ?saved?"Live banner: "+saved.product_name:"Selected product is no longer eligible. Replace or remove it."
      :"No promotional product is currently published.";
    if(previewImage){
      previewImage.hidden=!selected;
      previewImage.removeAttribute("src");
      if(selected){
        previewImage.src=firstImage(selected);
        previewImage.alt=selected.product_name;
      }
    }
    preview.hidden=!selected;
    previewName.textContent=selected?.product_name||"";
    previewDetail.textContent=selected
      ?selected.product_code+" · "+money(selected.selling_price)+" · "+stockOf(selected)+" in stock":"";
    save.disabled=busy||!selected||String(selected.id)===savedId;
    clear.disabled=busy||!savedId;
  }

  async function loadPromotionEditor(){
    select.disabled=true;save.disabled=true;clear.disabled=true;
    message("Loading products and current promotion…");
    try{
      const [products,setting]=await Promise.all([
        sb("products?select=id,product_code,product_name,selling_price,product_variants(stock_quantity,active),product_images(public_url,is_primary,sort_order)&active=eq.true&order=product_name.asc&limit=500"),
        sb("storefront_promotion?select=product_id&id=eq.1")
      ]);
      if(!Array.isArray(setting)||setting.length!==1)throw new Error("Promotion settings are not configured.");
      eligibleProducts=(products||[]).filter(p=>stockOf(p)>0&&Boolean(firstImage(p)));
      savedId=String(setting[0].product_id||"");
      select.replaceChildren(new Option(eligibleProducts.length?"Choose a product…":"No eligible products found",""));
      for(const product of eligibleProducts){
        select.add(new Option(product.product_code+" · "+product.product_name+" · "+money(product.selling_price),String(product.id)));
      }
      select.value=productFor(savedId)?savedId:"";
      select.disabled=eligibleProducts.length===0;
      message(eligibleProducts.length?"":"Add a product photo and available stock to publish a promotion.",false);
      renderPreview();
    }catch(error){
      console.error("Could not load promotion editor",error);
      current.textContent="Promotion settings unavailable.";
      message("Could not load promotional settings. Refresh after verifying the database migration.",true);
    }
  }

  async function saveSelection(productId){
    if(busy)return;
    if(productId&&!productFor(productId)){message("Choose an in-stock product with a photo.",true);return;}
    busy=true;select.disabled=true;renderPreview();
    message(productId?"Publishing banner…":"Removing banner…");
    try{
      const rows=await sb("storefront_promotion?id=eq.1",{
        method:"PATCH",
        headers:{"Prefer":"return=representation"},
        body:JSON.stringify({product_id:productId||null})
      });
      if(!Array.isArray(rows)||rows.length!==1)throw new Error("Promotion was not saved. Admin access is required.");
      savedId=String(rows[0].product_id||"");
      select.value=productFor(savedId)?savedId:"";
      message(savedId?"Promotion published. It will appear on the storefront shortly.":"Promotion removed from the storefront.");
    }catch(error){
      console.error("Could not save promotion",error);
      message("Unable to save. Check your admin permissions and try again.",true);
    }finally{
      busy=false;select.disabled=eligibleProducts.length===0;renderPreview();
    }
  }

  select.addEventListener("change",()=>{message("");renderPreview();});
  form.addEventListener("submit",event=>{event.preventDefault();saveSelection(select.value);});
  clear.addEventListener("click",()=>saveSelection(null));
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",loadPromotionEditor,{once:true});
  else loadPromotionEditor();
})();
