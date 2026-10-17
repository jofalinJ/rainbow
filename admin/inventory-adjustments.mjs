import {validateStockAdjustment,movementDelta} from "../src/domain/stockAdjustmentRules.mjs";

export function setupInventoryAdjustmentUI({getVariant,onUpdated}){
  const client=window.bootSupabase();
  const dialog=document.getElementById("stockDialog");
  if(!dialog)return {open:()=>{}};
  const $=id=>document.getElementById(id);
  const label=$("stockVariantLabel"),stockCurrent=$("stockCurrent"),after=$("stockAfter");
  const form=$("stockAdjustmentForm"),direction=$("stockDirection"),amount=$("stockQuantity"),reason=$("stockReason");
  const save=$("stockSave"),message=$("stockMessage"),history=$("stockHistory"),observed=$("stockObserved");
  let currentId="",currentStock=null,busy=false,serial=0,restoreFocus=null;
  function feedback(text,isError=false){
    message.textContent=text;
    message.classList.toggle("is-error",Boolean(isError));
  }
  function refreshPreview(){
    let result=null;
    try{result=validateStockAdjustment(direction.value,amount.value,reason.value,currentStock);}
    catch{/* Form stays editable until required fields are complete. */}
    after.textContent=result?result.after.toLocaleString("en-IN"):"—";
    save.disabled=busy||!result||!currentId;
  }
  function historyText(tx){
    const kinds={adjustment:"Manual adjustment",sale_local:"Store sale",sale_online:"Online order stock allocation",
      stock_in:"Stock received",return:"Return",damage:"Damaged",loss:"Stock loss"};
    return kinds[tx.transaction_type]||"Stock transaction";
  }
  function renderHistory(rows){
    history.replaceChildren();
    if(!rows.length){
      const p=document.createElement("p");
      p.className="stock-history-empty";
      p.textContent="No transaction records yet. Older stock changes may predate this history.";
      history.append(p);return;
    }
    for(const tx of rows){
      const article=document.createElement("article");
      article.className="stock-history-row";
      const top=document.createElement("div");top.className="stock-history-top";
      const title=document.createElement("strong");title.textContent=historyText(tx);
      const delta=movementDelta(tx);
      const value=document.createElement("strong");
      value.className="stock-history-delta"+(delta<0?" is-negative":"");
      value.textContent=delta===null?"—":(delta>0?"+":"")+delta+" units";
      top.append(title,value);
      const meta=document.createElement("small");meta.className="stock-history-meta";
      const when=new Date(tx.created_at);
      const formatted=Number.isNaN(when.getTime())?"Time unavailable":when.toLocaleString("en-IN",{timeZone:"Asia/Kolkata"});
      meta.textContent=formatted+(tx.created_by?" · Actor ID "+String(tx.created_by).slice(0,8):" · Automated/system")+
        (tx.reference_order_id?" · Order ref "+String(tx.reference_order_id).slice(0,8):"");
      const detail=document.createElement("p");detail.className="stock-history-detail";
      detail.textContent=tx.reason||"No reason recorded";
      article.append(top,meta,detail);
      if(tx.stock_before!==null&&tx.stock_after!==null){
        const balance=document.createElement("small");balance.className="stock-history-balance";
        balance.textContent="Balance: "+tx.stock_before+" → "+tx.stock_after;
        article.append(balance);
      }
      history.append(article);
    }
  }
  function renderObserved(rows){
    if(!observed)return;
    observed.replaceChildren();
    if(!rows.length){
      const p=document.createElement("p");
      p.className="stock-history-empty";
      p.textContent="No database-observed stock changes yet. The staging journal must be installed to capture future activity.";
      observed.append(p);
      return;
    }
    const kinds={BASELINE:"Migration baseline (not historical movement)",
      INSERT:"Variant created",UPDATE:"Quantity changed",DELETE:"Variant deleted"};
    for(const entry of rows){
      const item=document.createElement("article");
      item.className="stock-history-row";
      const row=document.createElement("div");row.className="stock-history-top";
      const label=document.createElement("strong");label.textContent=kinds[entry.event_kind]||"Database stock event";
      const quantity=document.createElement("strong");
      const delta=Number(entry.quantity_delta);
      quantity.className="stock-history-delta"+(delta<0?" is-negative":"");
      quantity.textContent=(delta>0?"+":"")+delta+" units";
      row.append(label,quantity);
      const meta=document.createElement("small");meta.className="stock-history-meta";
      const when=new Date(entry.occurred_at);
      meta.textContent=(Number.isNaN(when.getTime())?"Time unavailable":when.toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}))+
        (entry.actor_user_id?" · Actor ID "+String(entry.actor_user_id).slice(0,8):" · Unknown/system actor");
      const details=document.createElement("p");details.className="stock-history-detail";
      details.textContent="Recorded automatically by the database; business reason and source document may be unavailable.";
      item.append(row,meta,details);
      if(entry.stock_before!==null&&entry.stock_after!==null){
        const balance=document.createElement("small");balance.className="stock-history-balance";
        balance.textContent="Balance: "+entry.stock_before+" → "+entry.stock_after;
        item.append(balance);
      }
      observed.append(item);
    }
  }
  async function fetchObserved(id,token){
    if(!observed)return;
    observed.textContent="Loading database-observed stock changes…";
    const {data,error}=await client.rpc("get_variant_stock_events",{
      p_variant_id:id,p_limit:30
    });
    if(token!==serial)return;
    if(error){
      console.warn("Stock audit journal is not yet available",error.code||"");
      observed.textContent="Database stock journal is unavailable; install and verify its staging migration first.";
      return;
    }
    renderObserved(data||[]);
  }
  async function fetchHistory(id,token){
    history.textContent="Loading recent stock transactions…";
    const {data,error}=await client.from("inventory_transactions")
      .select("id,transaction_type,quantity,quantity_delta,stock_before,stock_after,reason,created_at,created_by,reference_order_id")
      .eq("variant_id",id).order("created_at",{ascending:false}).limit(30);
    if(token!==serial)return;
    if(error)throw error;
    renderHistory(data||[]);
  }
  async function open(id,button){
    if(busy)return;
    const variant=getVariant(id);
    if(!variant)return;
    restoreFocus=button||document.activeElement;
    currentId=id;currentStock=null;const token=++serial;
    label.textContent=[variant.products?.product_code,variant.products?.product_name,
      variant.color&&variant.color!=="0"?"Color "+variant.color:null,
      variant.size&&variant.size!=="0"?"Size "+variant.size:null,
      variant.length_cm!=null?"Length "+variant.length_cm+" cm":null].filter(Boolean).join(" · ");
    direction.value="add";amount.value="";reason.value="";
    stockCurrent.textContent="Checking…";feedback("");
    busy=true;refreshPreview();
    if(!dialog.open)dialog.showModal();
    $("stockClose").focus();
    try{
      const {data,error}=await client.from("product_variants").select("stock_quantity")
        .eq("id",id).single();
      if(token!==serial)return;
      if(error)throw error;
      currentStock=Number(data.stock_quantity);
      stockCurrent.textContent=currentStock.toLocaleString("en-IN");
      await Promise.all([fetchHistory(id,token),fetchObserved(id,token)]);
    }catch(error){
      if(token===serial){
        console.warn("Cannot fetch current inventory",error?.code||"");
        feedback("Unable to load current stock or history. Close and retry.",true);
        currentStock=null;
      }
    }finally{
      if(token===serial){busy=false;refreshPreview();}
    }
  }
  function close(){
    if(busy)return;
    serial++;currentId="";currentStock=null;
    dialog.close();
    if(restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});
    restoreFocus=null;
  }
  $("stockClose").addEventListener("click",close);
  dialog.addEventListener("cancel",event=>{
    if(busy)event.preventDefault();else{serial++;currentId="";currentStock=null;}
  });
  for(const field of [direction,amount,reason])field.addEventListener("input",refreshPreview);
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(busy||!currentId)return;
    let validated;
    try{validated=validateStockAdjustment(direction.value,amount.value,reason.value,currentStock);}
    catch(error){feedback(error.message,true);refreshPreview();return;}
    busy=true;refreshPreview();feedback("Saving stock change…");
    const id=currentId,token=++serial;
    let saved=false;
    try{
      const {data,error}=await client.rpc("adjust_variant_stock",{
        p_variant_id:id,p_quantity_change:validated.change,p_reason:validated.reason
      });
      if(error)throw error;
      saved=true;
      if(token!==serial)return;
      currentStock=Number(data.new_stock);
      stockCurrent.textContent=currentStock.toLocaleString("en-IN");
      reason.value="";amount.value="";
      feedback("Saved "+(validated.change>0?"+":"")+validated.change+
        " units. Current stock: "+currentStock+".");
      await Promise.all([fetchHistory(id,token),fetchObserved(id,token),onUpdated()]);
    }catch(error){
      if(token!==serial)return;
      console.warn("Stock adjustment rejected",error?.code||"");
      feedback(saved
        ?"Stock saved, but the history refresh failed. Refresh Inventory to see the latest records."
        :(error.message||"Stock adjustment failed. No stock was changed."),true);
      // Refresh authoritative stock if another session modified it.
      try{
        const {data}=await client.from("product_variants").select("stock_quantity").eq("id",id).single();
        if(token===serial&&data){currentStock=Number(data.stock_quantity);stockCurrent.textContent=String(currentStock);}
      }catch{/* Keep the server error visible. */}
    }finally{if(token===serial){busy=false;refreshPreview();}}
  });
  return {open};
}
