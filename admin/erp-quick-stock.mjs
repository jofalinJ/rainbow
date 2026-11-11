// ERP-live quick stock entry: add a positive number of pieces at the selected
// physical shop. The server still records a reason, actor and idempotency key.
export function setupErpQuickStockUI({getVariant,getLocationId,onUpdated}){
 const $=id=>document.getElementById(id);
 const client=window.bootSupabase();
 const dialog=$("stockDialog"),form=$("stockAdjustmentForm");
 const amount=$("stockQuantity"),reason=$("stockReason"),direction=$("stockDirection");
 const save=$("stockSave"),message=$("stockMessage"),history=$("stockHistory");
 const current=$("stockCurrent"),after=$("stockAfter"),label=$("stockVariantLabel");
 let variantId="",locationId="",onHand=0,reserved=0,busy=false,epoch=0;
 let operationId="",operationSignature="",focusReturn=null;
 if(!dialog)return {open:()=>{}};
 $("stockDialogTitle").textContent="Add stock";
 form.querySelector("h3").textContent="Increase stock by quantity";
 const grid=direction.closest("label");
 if(grid)grid.hidden=true;
 const reasonLabel=reason.closest("label");
 if(reasonLabel)reasonLabel.hidden=true;
 reason.required=false;
 direction.value="add";
 save.textContent="Add stock";
 const help=form.querySelector(".stock-help");
 if(help)help.textContent="Add existing product stock to the selected shop. The change is logged with your staff account. Online stock must be moved separately by the owner.";
 const balanceLabels=dialog.querySelectorAll(".stock-balances small");
 if(balanceLabels[0])balanceLabels[0].textContent="Available in this shop";
 if(balanceLabels[1])balanceLabels[1].textContent="Available after addition";
 function feedback(text,error=false){message.textContent=text;message.classList.toggle("is-error",error);}
 function validQuantity(){const str=amount.value.trim();return /^\\d+$/.test(str)&&Number.isSafeInteger(Number(str))&&Number(str)>=1&&Number(str)<=100000;}
 function preview(){
   const valid=validQuantity();
   after.textContent=valid?(Math.max(0,onHand-reserved)+Number(amount.value)).toLocaleString("en-IN"):"—";
   save.disabled=busy||!variantId||!locationId||!valid;
 }
 async function readBalance(variant,location,token){
  const {data,error}=await client.from("erp_stock_balances")
   .select("on_hand,reserved").eq("location_id",location).eq("variant_id",variant).maybeSingle();
  if(error)throw error;
  if(token!==epoch)return;
  onHand=Number(data?.on_hand||0);reserved=Number(data?.reserved||0);
  current.textContent=Math.max(0,onHand-reserved).toLocaleString("en-IN");
  preview();
 }
 async function readHistory(variant,location,token){
  const {data,error}=await client.from("erp_stock_events")
   .select("action,quantity_delta,created_at,stock_before,stock_after,reason")
   .eq("location_id",location).eq("variant_id",variant)
   .order("created_at",{ascending:false}).limit(12);
  if(error)throw error;
  if(token!==epoch)return;
  history.replaceChildren();
  if(!data?.length){history.textContent="No stock changes recorded at this shop yet.";return;}
  for(const entry of data){
   const item=document.createElement("article");item.className="stock-history-row";
   const top=document.createElement("div");top.className="stock-history-top";
   const title=document.createElement("strong");
   title.textContent=({adjust:"Stock adjustment",transfer_in:"Received transfer",transfer_out:"Sent transfer",online_sale:"Online sale"})[entry.action]||entry.action;
   const delta=document.createElement("strong");delta.textContent=(entry.quantity_delta>0?"+":"")+entry.quantity_delta+" units";
   top.append(title,delta);
   const details=document.createElement("small");details.className="stock-history-meta";
   details.textContent=new Date(entry.created_at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})+" · "+(entry.reason||"Recorded movement");
   item.append(top,details);history.append(item);
  }
 }
 async function open(id,button){
   if(busy)return;
   const variant=getVariant(id),location=getLocationId();
   if(!variant||!location){feedback("Select a physical shop first.",true);return;}
   const token=++epoch;
   variantId=id;locationId=location;operationId="";operationSignature="";
   onHand=0;reserved=0;amount.value="";reason.value="";
   focusReturn=button||document.activeElement;
   label.textContent=[variant.products?.product_code,variant.products?.product_name,
     variant.length_cm!=null?variant.length_cm+" cm":null].filter(Boolean).join(" · ");
   current.textContent="Loading…";after.textContent="—";history.textContent="Loading stock history…";
   feedback("");busy=true;preview();
   if(!dialog.open)dialog.showModal();
   $("stockClose").focus();
   try{
    await readBalance(id,location,token);
    await readHistory(id,location,token);
   }catch(error){if(token===epoch)feedback("Stock could not be loaded: "+error.message,true);}
   finally{if(token===epoch){busy=false;preview();}}
 }
 function close(){
   if(busy)return;
   epoch++;variantId="";locationId="";operationId="";operationSignature="";
   dialog.close();if(focusReturn?.isConnected)focusReturn.focus({preventScroll:true});
 }
 $("stockClose").addEventListener("click",close);
 dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();else{epoch++;variantId="";locationId="";}});
 amount.addEventListener("input",()=>{operationId="";operationSignature="";preview();});
 form.addEventListener("submit",async event=>{
   event.preventDefault();
   if(busy||!variantId||!locationId||!validQuantity())return;
   if(getLocationId()!==locationId){feedback("Shop selection changed. Close and reopen stock entry.",true);return;}
   const qty=Number(amount.value),sig=locationId+"|"+variantId+"|"+qty;
   if(!operationId||operationSignature!==sig){operationSignature=sig;operationId=crypto.randomUUID();}
   const token=epoch,request=operationId,variant=variantId,location=locationId;
   busy=true;preview();feedback("Adding stock…");
   let applied=false;
   try{
     const {data,error}=await client.rpc("erp_adjust_stock",{
       p_location:location,p_variant:variant,p_delta:qty,
       p_reason:"Shop stock added through Inventory quantity entry",p_request:request
     });
     if(error)throw error;
     applied=true;
     if(token!==epoch)return;
     await readBalance(variant,location,token);
     await readHistory(variant,location,token);
     amount.value="";operationId="";operationSignature="";
     feedback(data?.already_applied?"Already saved; no duplicate stock was added.":"Added "+qty+" pieces successfully.");
     window.dispatchEvent(new Event("erp-stock-changed"));
     await onUpdated();
   }catch(error){
     if(token===epoch){
       feedback((applied?"Stock saved, but refreshing failed. ":"Unable to add stock. ")+error.message+
         (applied?"":" Retry the same quantity without closing to avoid duplicates."),true);
     }
   }finally{if(token===epoch){busy=false;preview();}}
 });
 return {open};
}
