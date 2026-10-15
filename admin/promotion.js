/* Admin-only ordered promotional gallery; no stock photos or generic replacements. */
(() => {
  const form=document.getElementById("promotionForm");
  if(!form)return;
  const pick=document.getElementById("promotionProduct");
  const add=document.getElementById("promotionAdd");
  const save=document.getElementById("promotionSave");
  const clear=document.getElementById("promotionClear");
  const list=document.getElementById("promotionItems");
  const current=document.getElementById("promotionCurrent");
  const feedback=document.getElementById("promotionFeedback");
  let products=[],selected=[],saved=[],busy=true;

  const firstImage=p=>(p?.product_images||[]).filter(im=>im?.public_url)
    .sort((a,b)=>Number(Boolean(b.is_primary))-Number(Boolean(a.is_primary))
      ||Number(a.sort_order||0)-Number(b.sort_order||0))[0]?.public_url||"";
  const hasStock=p=>(p.product_variants||[]).some(v=>v.active!==false&&Number(v.stock_quantity)>0);
  const product=id=>products.find(p=>String(p.id)===String(id));
  function feedbackText(text,error=false){
    feedback.textContent=text;feedback.className="promotion-feedback"+(error?" error":text?" success":"");
  }
  function render(){
    list.replaceChildren();
    if(!selected.length){
      const empty=document.createElement("p");empty.className="promotion-empty";
      empty.textContent="No promotional images chosen. Select a product above to begin.";
      list.append(empty);
    }
    selected.forEach((id,index)=>{
      const p=product(id);if(!p)return;
      const row=document.createElement("div");row.className="promotion-item";
      const image=document.createElement("img");
      image.src=firstImage(p);image.alt=p.product_name||"Featured product";image.loading="lazy";
      const name=document.createElement("div");name.className="promotion-item-name";
      const title=document.createElement("strong");title.textContent=p.product_name||"Jewellery";
      const detail=document.createElement("small");detail.textContent=p.product_code||"";
      name.append(title,detail);
      const label=document.createElement("span");label.className="promotion-index";label.textContent=String(index+1).padStart(2,"0");
      const actions=document.createElement("div");actions.className="promotion-item-actions";
      for(const [text,delta] of [["↑",-1],["↓",1]]){
        const button=document.createElement("button");button.type="button";button.textContent=text;
        button.title=delta<0?"Move image earlier":"Move image later";
        button.setAttribute("aria-label",button.title+" for "+p.product_name);
        button.disabled=busy||index+delta<0||index+delta>=selected.length;
        button.addEventListener("click",()=>{
          const next=index+delta;[selected[index],selected[next]]=[selected[next],selected[index]];render();
        });
        actions.append(button);
      }
      const remove=document.createElement("button");remove.type="button";remove.textContent="Remove";
      remove.disabled=busy;remove.setAttribute("aria-label","Remove "+p.product_name);
      remove.addEventListener("click",()=>{selected.splice(index,1);render();});
      actions.append(remove);
      row.append(label,image,name,actions);list.append(row);
    });
    const changed=JSON.stringify(selected)!==JSON.stringify(saved);
    pick.disabled=busy||products.length===0||selected.length>=8;
    add.disabled=pick.disabled||!pick.value||selected.includes(pick.value);
    save.disabled=busy||!changed;
    clear.disabled=busy||!selected.length;
    current.textContent=selected.length+" of 8 product images selected"+
      (changed?" · Unsaved changes":" · Saved to storefront");
  }
  async function load(){
    busy=true;render();feedbackText("Loading eligible products and gallery…");
    try{
      const [items,result]=await Promise.all([
        sb("products?select=id,product_code,product_name,product_variants(stock_quantity,active),product_images(public_url,is_primary,sort_order)&active=eq.true&order=product_name.asc&limit=500"),
        bootSupabase().from("storefront_promotion_items").select("product_id,display_order").order("display_order")
      ]);
      if(result.error)throw result.error;
      products=(items||[]).filter(p=>firstImage(p)&&hasStock(p));
      saved=(result.data||[]).map(r=>String(r.product_id));
      selected=saved.filter(id=>Boolean(product(id)));
      if(saved.some(id=>!product(id)))feedbackText("Some old selections are unavailable. Save to remove them.",true);
      else feedbackText("");
      pick.replaceChildren(new Option(products.length?"Choose a stocked product…":"No eligible product images",""));
      for(const p of products)pick.add(new Option(p.product_code+" · "+p.product_name,String(p.id)));
    }catch(error){
      console.error("Promotion gallery could not load",error?.code||"");
      feedbackText("Unable to load the gallery. Refresh to try again.",true);
    }finally{busy=false;render();}
  }
  pick.addEventListener("change",render);
  add.addEventListener("click",()=>{
    if(!pick.value||selected.includes(pick.value)||selected.length>=8)return;
    selected.push(pick.value);pick.value="";feedbackText("");render();
  });
  clear.addEventListener("click",()=>{selected=[];render();});
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(busy||JSON.stringify(saved)===JSON.stringify(selected))return;
    busy=true;render();feedbackText("Saving image order…");
    try{
      const {error}=await bootSupabase().rpc("set_homepage_promotions",{p_product_ids:selected});
      if(error)throw error;
      saved=[...selected];feedbackText("Gallery saved. The storefront will rotate these images.");
    }catch(error){
      console.error("Promotion gallery update rejected",error?.code||"");
      feedbackText(error.message||"Could not save promotional gallery.",true);
    }finally{busy=false;render();}
  });
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",load,{once:true});
  else load();
})();
