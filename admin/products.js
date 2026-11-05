let productRules=null;
async function getProductRules(){if(!productRules)productRules=await import("../src/domain/productRules.mjs");return productRules;}
const $=id=>document.getElementById(id);
let cats=[],items=[],editingProductId=null,variantMode=false,selectedImages=[],previewObjectUrls=[],editPhotoFiles=[],editPhotoPreviewUrls=[];
let cataloguePage=0,cataloguePages=0,catalogueTotal=0,catalogueRevision=0,catalogueBusy=false,catalogueTimer=null,pinnedProduct=null,lastListMs=0;
let variantSaving=false,productSaving=false,stockLocations=[],openingStockTools=null,pendingOpeningStock=null,openingStockKey="",receivingOpeningStock=false;
let pendingProductInsert=null,productInsertKey="",verifyingProductInsert=false,insertRecoveryInvalid=false;
const multiShop=()=>window.RAINBOW_MULTI_SHOP_ENABLED===true;
async function getOpeningStockTools(){if(!openingStockTools)openingStockTools=await import("./product-opening-stock.mjs");return openingStockTools;}
function insertRecoveryBlocksSave(){return Boolean(pendingProductInsert)||insertRecoveryInvalid||verifyingProductInsert;}
function restoreProductInsert(record){
  const fields={products:["id","category_id","product_name","type","gender","active","selling_price","description","length_cm","thickness","gold_amount_g"],
    product_variants:["id","product_id","color","size","length_cm","stock_quantity","low_stock_limit"]};
  const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if(!record||!fields[record.table]||!record.body||Array.isArray(record.body)
    ||!uuid.test(record.body.id)||Object.keys(record.body).some(key=>!fields[record.table].includes(key))
    ||(record.table==="product_variants"&&!uuid.test(record.body.product_id)))throw new Error("Saved product recovery is invalid.");
  return {table:record.table,body:JSON.parse(JSON.stringify(record.body))};
}
function showPendingProductInsert(error=""){
  const blocked=insertRecoveryBlocksSave(),card=$("productInsertRecovery");card.hidden=!blocked;
  if(blocked){
    $("productInsertMessage").textContent=insertRecoveryInvalid?"A previous save could not be read. Check the product list before reloading or creating another product.":
      "A product or variant save needs confirmation. Verify the original save before creating another. Stock and photos will not be added by this recovery. "+error;
    $("verifyProductInsert").disabled=verifyingProductInsert||productSaving||variantSaving||insertRecoveryInvalid;
    $("saveVariantBtn").disabled=true;
  }
  $("saveProductBtn").disabled=productSaving||blocked;
}
async function setupProductInsertRecovery(){
  const user=await getAuthUser();productInsertKey="rainbow_product_insert_v1:"+user.id;
  $("verifyProductInsert").onclick=retryProductInsert;
  try{const saved=JSON.parse(sessionStorage.getItem(productInsertKey)||"null");if(saved)pendingProductInsert=restoreProductInsert(saved);}
  catch{insertRecoveryInvalid=true;}
  showPendingProductInsert();
}
function clearPendingProductInsert(){
  // Do not permit another insertion if the unresolved marker cannot be cleared.
  sessionStorage.removeItem(productInsertKey);pendingProductInsert=null;showPendingProductInsert();
}
async function submitPendingProductInsert(){
  const record=pendingProductInsert;if(!record)throw new Error("No saved product request is available.");
  if(!productInsertKey)throw new Error("Product recovery is not ready. Reload this page before saving.");
  sessionStorage.setItem(productInsertKey,JSON.stringify(record));
  let originalError;
  try{
    const response=await sb(record.table,{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(record.body)});
    if(response?.length===1&&String(response[0].id)===record.body.id){clearPendingProductInsert();return response[0];}
    originalError=new Error("The save response could not be verified.");
  }catch(error){originalError=error;}
  try{
    const rows=await sb(record.table+"?id=eq."+encodeURIComponent(record.body.id)+"&select=*");
    if(rows?.length===1&&String(rows[0].id)===record.body.id){clearPendingProductInsert();return rows[0];}
    // A structured database rejection plus a successful empty read confirms that
    // this insertion failed. Network failures keep the original identifier.
    let serverCode="";try{serverCode=JSON.parse(originalError.message)?.code||"";}catch{/* Network errors have no database code. */}
    if(Array.isArray(rows)&&rows.length===0&&/^[0-9A-Z]{5}$/.test(serverCode)&&serverCode!=="23505")clearPendingProductInsert();
  }catch{/* Keep the marker until the same record can be verified. */}
  showPendingProductInsert(originalError.message);
  throw new Error(originalError.message+(pendingProductInsert?" Use Verify saved record before another save.":""));
}
async function retryProductInsert(){
  if(!pendingProductInsert||verifyingProductInsert||productSaving||variantSaving||insertRecoveryInvalid)return false;
  verifyingProductInsert=true;showPendingProductInsert();
  try{
    const record=pendingProductInsert;
    // Reuse the exact original ID and payload; a committed insert is recovered
    // through its primary-key conflict and the read that follows it.
    const saved=await submitPendingProductInsert();
    resetEditor();await load();fillExistingProducts();
    variantMessage((record.table==="products"?"Product "+(saved.product_code||""):"Variant")+
      " save confirmed. Finish any variant, stock or photos from the existing product; do not create it again.");
    return true;
  }catch(error){showPendingProductInsert(error.message);variantMessage(error.message,true);return false;}
  finally{verifyingProductInsert=false;showPendingProductInsert();if(!insertRecoveryBlocksSave())updateExistingVariantFields();}
}
function showPendingStock(error=""){
  const card=$("openingStockRecovery");card.hidden=!pendingOpeningStock;if(!pendingOpeningStock)return;
  const op=pendingOpeningStock;
  $("openingStockMessage").textContent=op.productCode+" is saved. Confirm "+op.quantity+" opening units at "+op.locationName+". "+
    (error?error+" Retry here to check the same request without adding stock twice.":"Retry checks the same stock request without creating another product.");
  $("openingStockInventory").href="inventory.html?lookup="+encodeURIComponent(op.productCode);
  $("retryOpeningStock").disabled=receivingOpeningStock;
}
async function retryOpeningStock(){
  if(!pendingOpeningStock||receivingOpeningStock)return false;
  receivingOpeningStock=true;showPendingStock();
  try{
    sessionStorage.setItem(openingStockKey,JSON.stringify(pendingOpeningStock));
    const tools=await getOpeningStockTools();await tools.receiveOpeningStock(bootSupabase(),pendingOpeningStock);
    const op=pendingOpeningStock;
    // The request remains safe to replay if clearing session storage fails.
    try{sessionStorage.removeItem(openingStockKey);}catch{/* Server request is idempotent. */}
    pendingOpeningStock=null;showPendingStock();
    variantMessage("Opening stock confirmed: "+op.quantity+" units at "+op.locationName+" for "+op.productCode+".");
    return true;
  }catch(error){showPendingStock(error.message);return false;}
  finally{receivingOpeningStock=false;$("retryOpeningStock").disabled=false;}
}
async function setupOpeningStock(){
  if(!multiShop())return;
  $("retryOpeningStock").onclick=retryOpeningStock;
  const user=await getAuthUser();openingStockKey="rainbow_opening_stock_v1:"+user.id;
  try{
    const saved=JSON.parse(sessionStorage.getItem(openingStockKey)||"null");
    if(saved)pendingOpeningStock=(await getOpeningStockTools()).restoreOpeningStockOperation(saved);
  }catch{pendingOpeningStock=null;variantMessage("Previous stock recovery could not be read. Check Inventory before receiving the same stock again.",true);}
  showPendingStock();
  let errorMessage="";
  try{
    const {data,error}=await bootSupabase().from("erp_locations").select("id,name,kind,active").eq("kind","branch").eq("active",true).order("name");
    if(error)throw error;stockLocations=data||[];
  }catch(error){errorMessage="Shop list unavailable. Save with zero stock and add it later in Inventory. "+error.message;}
  for(const [inputId,selectId,fieldId,helpId] of [["stock","stockLocation","stockLocationField","stockHelp"],["existingStock","existingStockLocation","existingStockLocationField","existingStockHelp"]]){
    const select=$(selectId);select.replaceChildren(new Option("Choose receiving shop",""));
    stockLocations.forEach(shop=>select.add(new Option(shop.name,shop.id)));
    $(fieldId).hidden=false;$(inputId).readOnly=!stockLocations.length;$(inputId).max="100000";
    $(inputId).title="";
    $(helpId).textContent=errorMessage||(!stockLocations.length?"No assigned shop. Ask an admin for shop access, or save with zero stock.":"Enter the quantity received at your chosen shop. Online stock is allocated separately in Inventory.");
  }
}
async function readOpeningStock(inputId,selectId,active){
  if(!multiShop())return null;
  const tools=await getOpeningStockTools();
  const plan=tools.validateOpeningStock({quantity:$(inputId).value,locationId:$(selectId).value,locations:stockLocations,active});
  if(plan.quantity&&pendingOpeningStock)throw new Error("Confirm the previous opening stock request below before adding more stock.");
  return plan;
}
async function recordOpeningStock(product,variantId,plan){
  if(!plan?.quantity)return "";
  const tools=await getOpeningStockTools();
  pendingOpeningStock=tools.makeOpeningStockOperation({product,variantId,quantity:plan.quantity,location:plan.location,requestId:crypto.randomUUID()});
  try{sessionStorage.setItem(openingStockKey,JSON.stringify(pendingOpeningStock));}
  catch{showPendingStock("Stock was not sent because recovery could not be saved in this browser.");return " Opening stock is pending; use the recovery panel below.";}
  showPendingStock();
  const ok=await retryOpeningStock();
  return ok?" Opening stock: "+plan.quantity+" units at "+plan.location.name+".":" Opening stock needs confirmation in the recovery panel below.";
}
const findCurrentProduct=id=>items.find(x=>String(x.id)===String(id))||(pinnedProduct&&String(pinnedProduct.id)===String(id)?pinnedProduct:null);
const escHtml=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])).split(String.fromCharCode(39)).join("&#39;");
const IMAGE_BUCKET="product-images";
const TYPE_OPTIONS={"Roll Chain":["Roll","Designer","Heavy","Light"],"Thrissur Chain":["Roll","Designer","Heavy","Light"],"Coir Chain":["Roll","Designer","Heavy","Light"],"China Chain":["Roll","Designer","Heavy","Light"],"Bracelet":["Chain","Stone","Plain","Designer"],"Bangle":["Plain","Stone","Designer"],"Ring":["Stone","Plain","Designer"],"Dollar":["Stone","Plain","Designer"],"Earring":["Stone","Plain","Designer","Hoop","Jhumka"],"Anklet":["Plain","Stone","Designer"],"Necklace":["Stone","Plain","Designer"],"Thali Chain":["Chain","Thali","Designer","Heavy","Light","Plain"],"Men's Jewellery":["Chain","Bracelet","Bangle","Ring","Pendant","Necklace","Earring","Anklet","Dollar","Roll","Designer","Heavy","Light","Plain","Stone"]};
function setField(id,show){
  const wrapper=$(id);if(!wrapper)return;
  wrapper.classList.toggle("optional",!show);
  wrapper.querySelectorAll("input,select,textarea,button").forEach(control=>{control.disabled=!show;});
}
function updateFields(){
  const c=cats.find(x=>String(x.id)===String($("category").value));if(!c)return;
  const current=editingProductId?findCurrentProduct(editingProductId):null;
  setField("sizeField",!!c.has_size&&!editingProductId);setField("colorField",!!c.has_color&&!editingProductId);
  setField("lengthField",!!c.has_length);setField("thicknessField",!!c.has_thickness);setField("goldField",!!c.has_gold_amount);
  const baseTypes=TYPE_OPTIONS[c.name]||[];
  const typeOptions=Array.from(new Set([...baseTypes,...(current&&current.type?[current.type]:[])]));
  $("type").innerHTML=typeOptions.map(x=>'<option value="'+escHtml(x)+'">'+escHtml(x)+"</option>").join("")||'<option value="">Select type</option>';
  if(current&&current.type)$("type").value=current.type;
  if(!c.has_size)$("size").value="0";if(!c.has_color)$("color").value="0";
  setField("stockField",!editingProductId);setField("lowField",!editingProductId);
  if(multiShop())$("stockLocationField").hidden=Boolean(editingProductId);
  setField("createPhotosField",!editingProductId);setField("editPhotosField",!!editingProductId);
}
function orderedPhotos(product){
  const rows=Array.isArray(product&&product.product_images)?product.product_images.filter(Boolean):[];
  return rows.slice().sort((a,b)=>{
    if(Boolean(a.is_primary)!==Boolean(b.is_primary))return a.is_primary?-1:1;
    return Number(a.sort_order||0)-Number(b.sort_order||0);
  });
}
function photoRows(product){return Array.isArray(product&&product.product_images)?product.product_images.filter(Boolean):[];}
function clearImagePreviews(){previewObjectUrls.forEach(url=>URL.revokeObjectURL(url));previewObjectUrls=[];}
function clearEditPhotoPreviews(){editPhotoPreviewUrls.forEach(url=>URL.revokeObjectURL(url));editPhotoPreviewUrls=[];if($("editPhotoPreview"))$("editPhotoPreview").innerHTML="";}
function showImages(fileList){
  const files=Array.from(fileList||[]),invalid=files.find(file=>!file.type.startsWith("image/")||file.size>5*1024*1024);
  if(files.length>5){selectedImages=[];clearImagePreviews();$("preview").innerHTML="";$("cameraFile").value="";$("fileFile").value="";$("msg").textContent="Choose up to 5 product photos.";return;}
  if(invalid){selectedImages=[];clearImagePreviews();$("preview").innerHTML="";$("cameraFile").value="";$("fileFile").value="";$("msg").textContent=!invalid.type.startsWith("image/")?"Please choose image files only.":"Each image must be 5 MB or smaller.";return;}
  clearImagePreviews();selectedImages=files;previewObjectUrls=files.map(file=>URL.createObjectURL(file));
  $("preview").innerHTML=previewObjectUrls.map((url,index)=>'<div class="photo-preview-item"><img src="'+url+'" alt="Product photo '+(index+1)+'"><span>'+(index+1)+'</span></div>').join("");
  $("msg").textContent=files.length+" of 5 photos selected.";
}
function resetEditor(){
  editingProductId=null;variantMode=false;selectedImages=[];editPhotoFiles=[];clearImagePreviews();clearEditPhotoPreviews();
  $("form").reset();$("gender").value="women";$("active").checked=true;$("cameraFile").value="";$("fileFile").value="";$("preview").innerHTML="";
  $("editPhotoFiles").value="";$("editCurrentPhotos").innerHTML="";$("size").value="0";$("color").value="0";$("stock").value=0;$("low").value=3;
  $("editorHeading").textContent="Add Product";$("saveProductBtn").textContent="Save Product";$("cancelEditBtn").hidden=true;
  $("existingBtn").setAttribute("aria-pressed","false");$("newProductBtn").setAttribute("aria-pressed","true");
  $("form").style.display="block";$("existingBox").style.display="none";updateFields();
}
let variantRules=null;
async function getVariantRules(){
  if(!variantRules)variantRules=await import("../src/domain/variantRules.mjs");
  return variantRules;
}
function variantMessage(text,error=false){
  const node=$("msg");if(!node)return;
  node.textContent=text;
  node.classList.toggle("is-error",error);
}
function setupVariantBox(){
  $("newProductBtn").onclick=()=>{resetEditor();variantMessage("");$("name").focus();};
  $("existingBtn").onclick=()=>{
    resetEditor();variantMode=true;
    $("editorHeading").textContent="Add Product Variant";
    $("existingBox").style.display="block";$("form").style.display="none";
    $("existingBtn").setAttribute("aria-pressed","true");
    $("newProductBtn").setAttribute("aria-pressed","false");
    fillExistingProducts();
    variantMessage("Select a product, then enter new variant details.");
    $("existingProduct").focus();
  };
  $("cancelEditBtn").onclick=()=>{resetEditor();variantMessage("Edit cancelled.");};
  $("existingProduct").onchange=()=>{updateExistingVariantFields();variantMessage("");};
  $("saveVariantBtn").onclick=saveVariant;
  $("category").onchange=updateFields;
  $("editPhotoBtn").onclick=()=>$("editPhotoFiles").click();
  $("editPhotoFiles").onchange=handleEditPhotoSelection;
}
function fillExistingProducts(preferredId=""){
  const select=$("existingProduct");
  const previous=preferredId||select.value;
  select.replaceChildren(new Option("Choose an existing product…",""));
  for(const p of [...items,...(pinnedProduct&&!items.some(x=>x.id===pinnedProduct.id)?[pinnedProduct]:[])]){
    select.add(new Option(p.product_code+" — "+p.product_name+(p.active===false?" (draft)":""),String(p.id)));
  }
  select.value=items.some(p=>String(p.id)===String(previous))||
  (pinnedProduct&&String(pinnedProduct.id)===String(previous))?String(previous):"";
  updateExistingVariantFields();
}
function displayExistingVariants(product,category){
  const container=$("existingVariants");container.replaceChildren();
  const variants=Array.isArray(product?.product_variants)?product.product_variants:[];
  if(!variants.length){
    const p=document.createElement("p");p.className="variant-empty";
    p.textContent=product?"No variants saved yet. Your new variant will be the first.":"Select a product to see its existing variations.";
    container.append(p);return;
  }
  const title=document.createElement("small");title.className="variant-empty";
  title.textContent=variants.length+" existing variant"+(variants.length===1?"":"s")+":";
  container.append(title);
  for(const variant of variants){
    const attributes=[];
    if(category?.has_color)attributes.push("Color: "+(variant.color||"0"));
    if(category?.has_size)attributes.push("Size: "+(variant.size||"0"));
    if(category?.has_length)attributes.push("Length: "+(variant.length_cm??"—")+" cm");
    attributes.push("Stock: "+Number(variant.stock_quantity||0));
    const chip=document.createElement("span");chip.className="variant-chip"+(variant.active===false?" is-inactive":"");
    chip.textContent=attributes.join(" · ")+(variant.active===false?" · Inactive":"");
    container.append(chip);
  }
}
function updateExistingVariantFields(){
  const product=findCurrentProduct($("existingProduct").value);
  const category=product&&cats.find(c=>String(c.id)===String(product.category_id));
  for(const id of ["existingColorField","existingSizeField","existingLengthField"])setField(id,false);
  if(category){
    setField("existingColorField",Boolean(category.has_color));
    setField("existingSizeField",Boolean(category.has_size));
    setField("existingLengthField",Boolean(category.has_length));
  }
  $("existingColor").value="0";$("existingSize").value="0";$("existingLength").value="";
  $("existingStock").value="0";$("existingLow").value="3";
  const canDifferentiate=Boolean(category&&(category.has_color||category.has_size||category.has_length));
  $("saveVariantBtn").disabled=variantSaving||insertRecoveryBlocksSave()||!product||!category||(!canDifferentiate&&(product.product_variants||[]).length>0);
  const details=$("existingVariantHelp");
  if(details){
    details.textContent=!product?"Choose a product to add its variant."
      :!category?"This product category is no longer available."
      :!canDifferentiate&&product.product_variants?.length
        ?"This category has no variant attributes. Use Inventory to update the existing stock."
        :"New variants must have a distinct color, size or length. Existing variants are listed below.";
  }
  displayExistingVariants(product,category);
}
async function saveVariant(){
  if(variantSaving)return;
  if(insertRecoveryBlocksSave()){showPendingProductInsert();variantMessage("Verify the previous saved record before saving a variant.",true);return;}
  const product=findCurrentProduct($("existingProduct").value);
  if(!product){variantMessage("Choose an existing product before saving.",true);return;}
  const category=cats.find(c=>String(c.id)===String(product.category_id));
  if(!category){variantMessage("The selected product category is unavailable.",true);return;}
  let draft,openingPlan,savedVariant=null;
  variantSaving=true;$("saveVariantBtn").disabled=true;
  try{
    const rules=await getVariantRules();
    draft=rules.buildVariantDraft(category,{
      color:$("existingColor").value,size:$("existingSize").value,
      length:$("existingLength").value,stock:$("existingStock").value,low:$("existingLow").value
    });
    const duplicate=(product.product_variants||[]).find(v=>rules.sameVariant(v,draft));
    if(duplicate)throw new Error("This exact variant already exists. Choose a different color, size or length; use Inventory to update existing stock.");
    openingPlan=await readOpeningStock("existingStock","existingStockLocation",product.active!==false);
  }catch(error){variantSaving=false;$("saveVariantBtn").disabled=insertRecoveryBlocksSave();variantMessage(error.message,true);return;}
  variantSaving=true;
  $("saveVariantBtn").disabled=true;
  $("saveVariantBtn").textContent="Saving variant…";
  variantMessage("Saving new variant…");
  try{
    savedVariant=await insertProductRecord("product_variants",{id:crypto.randomUUID(),product_id:product.id,...draft,stock_quantity:multiShop()?0:draft.stock_quantity});
    const stockResult=await recordOpeningStock(product,savedVariant.id,openingPlan);
    await load();
    fillExistingProducts(product.id);
    const attrs=[category.has_color?"color "+draft.color:null,category.has_size?"size "+draft.size:null,
      category.has_length?"length "+draft.length_cm+" cm":null].filter(Boolean).join(" · ");
    variantMessage("Saved a new variant for "+product.product_code+(attrs?" ("+attrs+")":"")+"."+
      (multiShop()?(stockResult||" No opening stock added."):" Stock: "+draft.stock_quantity+"."));
  }catch(error){
    console.error("Variant save failed",error?.code||"");
    variantMessage(savedVariant?"Variant saved for "+product.product_code+". Refresh the product list and check the opening stock panel; do not add the variant again. "+error.message
      :error?.code==="23505"?"This variant already exists. Choose a different color, size or length."
      :"Could not save variant: "+(error?.message||"Unknown error"),true);
  }finally{
    variantSaving=false;
    $("saveVariantBtn").textContent="Save Variant";
    const selected=findCurrentProduct($("existingProduct").value);
    const c=selected&&cats.find(x=>String(x.id)===String(selected.category_id));
    $("saveVariantBtn").disabled=insertRecoveryBlocksSave()||!selected||!c||
      (!c.has_color&&!c.has_size&&!c.has_length&&(selected.product_variants||[]).length>0);
    showPendingProductInsert();
  }
}

function renderStorefrontCategorySettings(){
  const root=$("storefrontCategoryRows");if(!root)return;
  cats=cats.slice().sort((a,b)=>Number(a.storefront_order||0)-Number(b.storefront_order||0)||a.name.localeCompare(b.name));
  root.innerHTML=cats.map((category,index)=>{
    const count=items.filter(product=>String(product.category_id)===String(category.id)).length;
    return '<div class="storefront-category-row" data-category-row="'+escHtml(category.id)+'">'+
      '<div class="storefront-category-order"><button type="button" data-category-up="'+escHtml(category.id)+'" aria-label="Move '+escHtml(category.name)+' up" '+(index===0?'disabled':'')+'>↑</button>'+
      '<button type="button" data-category-down="'+escHtml(category.id)+'" aria-label="Move '+escHtml(category.name)+' down" '+(index===cats.length-1?'disabled':'')+'>↓</button></div>'+
      '<div class="storefront-category-name">'+escHtml(category.name)+'<small>'+count +' product'+(count===1?'':'s')+' on the current admin page' +'</small></div>'+
      '<label class="storefront-category-visible"><input type="checkbox" data-category-visible="'+escHtml(category.id)+'" '+(category.show_in_storefront===false?'':'checked')+'> Show in storefront</label></div>';
  }).join("")||'<p>No active categories.</p>';
  root.querySelectorAll("[data-category-up]").forEach(button=>button.onclick=()=>moveStorefrontCategory(button.dataset.categoryUp,-1));
  root.querySelectorAll("[data-category-down]").forEach(button=>button.onclick=()=>moveStorefrontCategory(button.dataset.categoryDown,1));
  root.querySelectorAll("[data-category-visible]").forEach(input=>input.onchange=()=>{
    const category=cats.find(item=>String(item.id)===String(input.dataset.categoryVisible));
    if(category)category.show_in_storefront=input.checked;
  });
}
function moveStorefrontCategory(id,delta){
  const index=cats.findIndex(category=>String(category.id)===String(id)),next=index+delta;
  if(index<0||next<0||next>=cats.length)return;
  [cats[index],cats[next]]=[cats[next],cats[index]];
  renderStorefrontCategorySettings();
}
async function saveStorefrontCategories(){
  const status=$("storefrontCategoryMessage");if(status)status.textContent="Saving…";
  try{
    for(let index=0;index<cats.length;index++){
      const category=cats[index];
      await sb("categories?id=eq."+encodeURIComponent(category.id),{
        method:"PATCH",headers:{"Prefer":"return=minimal"},
        body:JSON.stringify({storefront_order:(index+1)*10,show_in_storefront:category.show_in_storefront!==false})
      });
      category.storefront_order=(index+1)*10;
    }
    if(status)status.textContent="Storefront category order saved.";
    cats.sort((a,b)=>Number(a.storefront_order)-Number(b.storefront_order));
    renderStorefrontCategorySettings();
  }catch(error){if(status)status.textContent="Could not save storefront order: "+error.message;}
}
async function lookupProductByCode(code){
  const value=String(code||"").trim(),message=$("lookupProductStatus");
  if(message)message.textContent="Finding product…";
  if(!value||value.length>80){if(message)message.textContent="Enter an exact product code.";return null;}
  try{
    const {data,error}=await bootSupabase().from("products")
      .select(RainbowAdminCatalogue.SELECT||"id,product_code,product_name,type,gender,display_priority,active,selling_price,category_id,length_cm,description,thickness,gold_amount_g,product_variants(id,color,size,length_cm,stock_quantity,active),product_images(id,public_url,storage_path,is_primary,sort_order)")
      .eq("product_code",value).maybeSingle();
    if(error)throw error;
    if(!data){if(message)message.textContent="No product found for this code.";return null;}
    pinnedProduct=data;
    fillExistingProducts(data.id);
    if(message)message.textContent="Found "+data.product_code+" — "+data.product_name+".";
    return data;
  }catch(error){if(message)message.textContent="Lookup failed: "+error.message;return null;}
}

let sharedProductTimer=null,sharedSearchRevision=0,onlineSelectedId=null;
async function findSharedProducts(value){
 const term=String(value||"").trim().replace(/[^\p{L}\p{N}\s/_-]/gu," ").replace(/\s+/g," ").slice(0,70);
 const target=$("sharedProductResults"),seq=++sharedSearchRevision;
 target.replaceChildren();
 if(term.length<2){target.textContent="Enter at least two characters.";return;}
 target.textContent="Searching shared product catalogue…";
 try{
  const [a,b]=await Promise.all([
   bootSupabase().from("products").select("id,product_code,product_name,product_images(public_url,is_primary,sort_order)")
    .or("product_code.ilike.%"+term+"%,product_name.ilike.%"+term+"%")
    .limit(15),
   bootSupabase().from("product_variants").select("product_id").ilike("barcode","%"+term+"%").limit(15)
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;
  let found=a.data||[];
  const missing=(b.data||[]).map(x=>x.product_id).filter(id=>!found.some(p=>p.id===id));
  if(missing.length){
   const c=await bootSupabase().from("products").select("id,product_code,product_name,product_images(public_url,is_primary,sort_order)").in("id",[...new Set(missing)].slice(0,15));
   if(c.error)throw c.error;
   found=[...found,...(c.data||[])];
  }
  if(seq!==sharedSearchRevision)return;
  target.replaceChildren();
  if(!found.length){target.textContent="No product found. Create a new product only if it really doesn't exist.";return;}
  for(const p of found.slice(0,20)){
   const wrap=document.createElement("div");wrap.className="variant-chip";wrap.style.cssText="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0";
   const description=document.createElement("span");description.textContent=p.product_code+" · "+p.product_name;
   const photos=(p.product_images||[]).filter(x=>x.public_url).sort((a,b)=>Number(b.is_primary)-Number(a.is_primary));
   const href=photos[0]?.public_url;
   try{const url=new URL(href);if(url.protocol==="https:"){const img=document.createElement("img");img.src=url.href;img.alt="";img.loading="lazy";img.style.cssText="height:42px;width:42px;object-fit:contain;border-radius:8px";wrap.append(img);}}catch{/* No remote image preview for missing or invalid URLs. */}
   const button=document.createElement("button");button.type="button";button.textContent="Reuse product";button.className="save-category";
   button.addEventListener("click",async()=>{
    if(!variantMode)$("existingBtn").click();
    const matched=await lookupProductByCode(p.product_code);
    if(matched){$("existingProduct").value=matched.id;updateExistingVariantFields();$("sharedProductResults").textContent="Selected "+p.product_code+"; existing variants and images are reused.";}
   });
   const manage=document.createElement("a");manage.href="inventory.html?lookup="+encodeURIComponent(p.product_code);
   manage.textContent="Manage shop stock";
   wrap.append(description,button,manage);target.append(wrap);
  }
 }catch(error){if(seq===sharedSearchRevision)target.textContent="Search unavailable: "+error.message;}
}
async function openOnlineListing(productId){
 const profile=await getMyProfile();if(!profile.active)return;
 const isAdmin=profile.role==="admin";
 const p=items.find(x=>String(x.id)===String(productId))||
 (pinnedProduct?.id===productId?pinnedProduct:null);
 if(!p)return;
 onlineSelectedId=isAdmin?p.id:null;
 $("onlineListingTitle").textContent="Online display";
 $("onlineListingProduct").textContent=p.product_code+" · "+p.product_name;
 $("onlineListingStock").href="inventory.html?lookup="+encodeURIComponent(p.product_code);
 $("onlineListingVisible").disabled=true;$("saveOnlineListing").hidden=!isAdmin;
 $("onlineListingVisible").closest("label").hidden=!isAdmin;
 $("onlineListingPrice").closest("label").hidden=!isAdmin;
 $("onlineListingPrice").disabled=true;
 const onlineStock=(p.product_variants||[]).filter(v=>v.active!==false).reduce((n,v)=>n+Number(v.stock_quantity||0),0);
 const category=cats.find(c=>String(c.id)===String(p.category_id));
 const summary="Product "+(p.active===false?"disabled":"enabled")+" · Online stock: "+onlineStock+" · Category "+(category?.show_in_storefront===false?"hidden":"visible")+". ";
 const dialog=$("onlineListingDialog");dialog.hidden=false;dialog.showModal();
 if(!isAdmin){
   $("onlineListingVisible").checked=false;$("onlineListingPrice").value="";
   $("onlineListingFeedback").textContent=summary+"An admin publishes the product online and allocates stock from a shop in Inventory. Shop stock alone does not display it online.";
   return;
 }
 $("onlineListingFeedback").textContent="Loading online settings…";
 const {data,error}=await bootSupabase().from("erp_online_listings")
 .select("published,online_price").eq("product_id",p.id).maybeSingle();
 if(error){$("onlineListingFeedback").textContent="ERP listings aren't available in this environment: "+error.message;}
 else{$("onlineListingFeedback").textContent=summary+"Publish here, then allocate online stock in Inventory.";$("onlineListingVisible").checked=Boolean(data?.published);$("onlineListingPrice").value=data?.online_price??"";}
 $("saveOnlineListing").disabled=Boolean(error);
 $("onlineListingVisible").disabled=Boolean(error);
}
async function saveOnlineListing(){
 if(!onlineSelectedId)return;
 const raw=$("onlineListingPrice").value.trim();
 if(raw!==""&&(!/^\d+(\.\d{1,2})?$/.test(raw)||!Number.isFinite(Number(raw)))){
  $("onlineListingFeedback").textContent="Enter a valid price.";return;
 }
 const button=$("saveOnlineListing");button.disabled=true;
 try{
  const user=await getAuthUser();
  const {error}=await bootSupabase().from("erp_online_listings").upsert({
   product_id:onlineSelectedId,published:$("onlineListingVisible").checked,
   online_price:null,updated_by:user.id,updated_at:new Date().toISOString()
  },{onConflict:"product_id"});
  if(error)throw error;
  $("onlineListingFeedback").textContent="Online listing saved. To appear in the shop, the product must be enabled, its category visible and online stock allocated in Inventory.";
 }catch(error){$("onlineListingFeedback").textContent="Could not save: "+error.message;}
 finally{button.disabled=false;}
}
function bindSharedProductSearch(){
 $("sharedProductSearchButton")?.addEventListener("click",()=>findSharedProducts($("sharedProductSearch").value));
 $("sharedProductSearch")?.addEventListener("input",()=>{
  clearTimeout(sharedProductTimer);
  sharedProductTimer=setTimeout(()=>findSharedProducts($("sharedProductSearch").value),350);
 });
 $("closeOnlineListing")?.addEventListener("click",()=>$("onlineListingDialog").close());
 $("saveOnlineListing")?.addEventListener("click",saveOnlineListing);
}

async function init(){
  const profile=await getMyProfile();
  if(!profile.active||!["admin","cashier","inventory_staff"].includes(profile.role))throw new Error("You do not have product-management permission.");
  cats=await sb("categories?select=*&active=eq.true&order=storefront_order.asc,name.asc");
  $("category").innerHTML=cats.map(cat=>'<option value="'+escHtml(cat.id)+'">'+escHtml(cat.name)+"</option>").join("");
  updateFields();setupVariantBox();
  await setupProductInsertRecovery();
  if(window.RAINBOW_MULTI_SHOP_ENABLED===true){
    for(const id of ["stock","existingStock"]){$(id).readOnly=false;}
    $("catalogueStockHeading").textContent="Online stock";
    await setupOpeningStock();
  }
  const openCategoryDisplay=()=>{if(location.hash==="#categoryDisplay")$("categoryDisplay").open=true;};
  window.addEventListener("hashchange",openCategoryDisplay);openCategoryDisplay();
  document.querySelectorAll('a[href="#categoryDisplay"]').forEach(link=>link.addEventListener("click",()=>{$("categoryDisplay").open=true;}));
  if(window.RAINBOW_MULTI_SHOP_ENABLED===true)$("sharedProductLookupSection").hidden=false;
  bindSharedProductSearch();
  $("lookupProductButton")?.addEventListener("click",()=>lookupProductByCode($("lookupProductCode").value));
  $("lookupProductCode")?.addEventListener("keydown",event=>{
    if(event.key==="Enter"){event.preventDefault();lookupProductByCode(event.currentTarget.value);}
  });
  const search=$("search");
  search.addEventListener("input",()=>{
    clearTimeout(catalogueTimer);
    catalogueTimer=setTimeout(()=>load({reset:true}),300);
  });
  $("adminProductStatus")?.addEventListener("change",()=>load({reset:true}));
  $("catalogPrev")?.addEventListener("click",()=>{if(cataloguePage>0){cataloguePage--;load();}});
  $("catalogNext")?.addEventListener("click",()=>{if(cataloguePage+1<cataloguePages){cataloguePage++;load();}});
  await load({reset:true});fillExistingProducts();
}
async function load({reset=false}={}){
  if(reset)cataloguePage=0;
  const request=++catalogueRevision;
  catalogueBusy=true;
  if($("adminCatalogMessage"))$("adminCatalogMessage").textContent="Loading products…";
  $("catalogPrev").disabled=true;$("catalogNext").disabled=true;
  const started=performance.now();
  try{
    const result=await RainbowAdminCatalogue.list(bootSupabase(),{
      page:cataloguePage,search:$("search").value,
      status:$("adminProductStatus")?.value||"all",categories:cats
    });
    if(request!==catalogueRevision)return;
    if(result.pages>0&&cataloguePage>=result.pages){cataloguePage=result.pages-1;return load();}
    items=result.rows;catalogueTotal=result.count;cataloguePages=result.pages;
    lastListMs=Math.round(performance.now()-started);
    if($("adminCatalogMessage"))$("adminCatalogMessage").textContent=
      "Database search • "+catalogueTotal.toLocaleString("en-IN")+" matching products • "+lastListMs+" ms response";
    render();fillExistingProducts();
  }catch(error){
    if(request!==catalogueRevision)return;
    console.warn("Admin catalogue read failed",error);
    if($("adminCatalogMessage"))$("adminCatalogMessage").textContent="Could not load products: "+error.message;
  }finally{
    if(request===catalogueRevision){
      catalogueBusy=false;
      const prev=$("catalogPrev"),next=$("catalogNext"),info=$("catalogPageInfo");
      prev.disabled=cataloguePage<=0;next.disabled=cataloguePage+1>=cataloguePages;
      info.textContent=catalogueTotal?
        "Page "+(cataloguePage+1)+" of "+cataloguePages+" • "+catalogueTotal.toLocaleString("en-IN")+" products":"No matching products";
    }
  }
}
function render(){
  const a=items; // Already filtered, counted and paginated on Supabase.
  $("rows").innerHTML=a.map(p=>{
    const stock=(p.product_variants||[]).filter(v=>v.active!==false).reduce((sum,v)=>sum+Number(v.stock_quantity||0),0),photos=photoRows(p).length;
    return '<tr><td><b>'+escHtml(p.product_code)+'</b></td><td>'+escHtml(p.product_name)+'</td>'+
      '<td>'+escHtml((cats.find(c=>String(c.id)===String(p.category_id))||{}).name||"")+'</td>'+
      '<td>'+escHtml(p.type)+'</td><td>'+escHtml(p.gender||"women")+'</td><td>'+(p.active===false?"Disabled":"Enabled")+'</td><td>₹'+Number(p.selling_price).toLocaleString("en-IN")+'</td><td>'+stock+'</td>'+
      '<td><span class="photo-count">'+photos+'/5</span><button class="save-category" type="button" data-add-photos="'+escHtml(p.id)+'" '+(photos>=5?'disabled':'')+'>Add photos</button><input type="file" accept="image/*" multiple hidden data-image-input="'+escHtml(p.id)+'"></td>'+
      '<td><button class="save-category" type="button" data-edit-product="'+escHtml(p.id)+'">Edit product</button> <a class="save-category" href="inventory.html?lookup='+encodeURIComponent(p.product_code)+'">Manage stock</a> '+
      (window.RAINBOW_MULTI_SHOP_ENABLED===true?'<button class="save-category" type="button" data-online-product="'+escHtml(p.id)+'">Online display</button>':'')+'</td></tr>';
  }).join("")||'<tr><td colspan="10">No products found for the current database filters.</td></tr>';
  bindProductActions();bindImageUploadActions();renderStorefrontCategorySettings();
}
function bindProductActions(){
 document.querySelectorAll("[data-edit-product]").forEach(button=>{button.onclick=()=>startEditProduct(button.dataset.editProduct);});
 document.querySelectorAll("[data-online-product]").forEach(button=>{button.onclick=()=>openOnlineListing(button.dataset.onlineProduct).catch(error=>console.warn("Online listing unavailable",error));});
}
function bindImageUploadActions(){
  document.querySelectorAll("[data-add-photos]").forEach(button=>{button.onclick=()=>{const input=button.closest("td")?.querySelector("[data-image-input]");if(input)input.click();};});
  document.querySelectorAll("[data-image-input]").forEach(input=>{input.onchange=()=>addPhotosToProduct(input.dataset.imageInput,input);});
}
async function uploadImage(file,productCode){
  if(!file)throw new Error("Choose an image first.");
  if(!file.type.startsWith("image/"))throw new Error("Please choose an image file.");
  if(file.size>5*1024*1024)throw new Error("Each image must be 5 MB or smaller.");
  const prepared=await window.RainbowImagePrep?.prepare(file);
  // The -optimized.webp suffix signals that a separate -thumb.webp asset exists.
  const uuid=crypto.randomUUID();
  const folder=productCode.replace(/[^a-zA-Z0-9-]/g,"-");
  const mainPath=folder+"/"+uuid+"-optimized.webp";
  const thumbPath=folder+"/"+uuid+"-thumb.webp";
  const bucket=sbClient.storage.from(IMAGE_BUCKET);
  if(prepared){
    const paths=[];
    try{
      const main=await bucket.upload(mainPath,prepared.main,{contentType:"image/webp",cacheControl:"31536000",upsert:false});
      if(main.error)throw main.error;
      paths.push(mainPath);
      const thumb=await bucket.upload(thumbPath,prepared.thumb,{contentType:"image/webp",cacheControl:"31536000",upsert:false});
      if(thumb.error)throw thumb.error;
      paths.push(thumbPath);
    }catch(error){
      if(paths.length)await bucket.remove(paths).catch(()=>{});
      throw error;
    }
    return {path:mainPath,thumbPath,url:bucket.getPublicUrl(mainPath).data.publicUrl};
  }
  // Fallback for older browsers; existing product photos are never changed.
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const path=folder+"/"+uuid+"."+ext;
  const result=await bucket.upload(path,file,{contentType:file.type,cacheControl:"31536000",upsert:false});
  if(result.error)throw result.error;
  return {path,url:bucket.getPublicUrl(path).data.publicUrl};
}


async function uploadAndSavePhoto(file,product,attributes){
  const uploaded=await uploadImage(file,product.product_code);
  try{
    await sb("product_images",{
      method:"POST",headers:{"Prefer":"return=minimal"},
      body:JSON.stringify({product_id:product.id,public_url:uploaded.url,storage_path:uploaded.path,...attributes})
    });
  }catch(error){
    const names=[uploaded.path,uploaded.thumbPath].filter(Boolean);
    await sbClient.storage.from(IMAGE_BUCKET).remove(names).catch(cleanupError=>{
      console.warn("Storage cleanup after a failed photo record must be reviewed.",cleanupError);
    });
    throw error;
  }
  return uploaded;
}

async function uploadAdditionalPhotos(product,files){
  const current=photoRows(product);if(current.length+files.length>5)throw new Error("Only "+Math.max(0,5-current.length)+" more photo(s) can be added. Maximum 5 per product.");
  let added=0;
  try{
    for(const file of files){
      await uploadAndSavePhoto(file,product,{alt_text:product.product_name,is_primary:current.length===0&&added===0,sort_order:current.length+added});
      added++;
    }
  }catch(error){error.photosAdded=added;throw error;}
  return added;
}
async function addPhotosToProduct(productId,input){
  const product=findCurrentProduct(productId),files=Array.from(input.files||[]);
  if(!product||!files.length){input.value="";return;}
  const remaining=5-photoRows(product).length;
  if(files.length>remaining){$("msg").textContent="This product has "+photoRows(product).length+" photos. You can add only "+Math.max(0,remaining)+" more (maximum 5).";input.value="";return;}
  try{
    const added=await uploadAdditionalPhotos(product,files);await load();fillExistingProducts();
    $("msg").textContent="Added "+added+" photo"+(added===1?"":"s")+" to "+product.product_code+".";
  }catch(error){await load().catch(()=>{});$("msg").textContent="Photo upload stopped after "+Number(error.photosAdded||0)+" new photo(s): "+error.message;}
  finally{input.value="";}
}
function startEditProduct(productId){
  const product=items.find(p=>String(p.id)===String(productId));if(!product)return;
  editingProductId=String(product.id);variantMode=false;selectedImages=[];editPhotoFiles=[];clearImagePreviews();clearEditPhotoPreviews();
  $("cameraFile").value="";$("fileFile").value="";$("preview").innerHTML="";$("editPhotoFiles").value="";$("form").reset();
  $("category").value=String(product.category_id||"");updateFields();
  $("gender").value=product.gender||"women";$("active").checked=product.active!==false;
  $("name").value=product.product_name||"";$("type").value=product.type||"";$("price").value=product.selling_price??"";
  $("description").value=product.description||"";$("length").value=product.length_cm??"";$("thickness").value=product.thickness??"";$("gold").value=product.gold_amount_g??"";
  const photos=orderedPhotos(product);
  $("editCurrentPhotos").innerHTML=photos.map((photo,index)=>photo.public_url?'<img src="'+escHtml(photo.public_url)+'" alt="'+escHtml(product.product_name+' current photo '+(index+1))+'" loading="lazy">':'<span class="photo-count">Photo '+(index+1)+'</span>').join("")||'<small>No photos added yet.</small>';
  $("editPhotoHelp").textContent=photos.length+" of 5 photos currently saved. You can add "+Math.max(0,5-photos.length)+" more; each image must be 5 MB or smaller. New photos upload when you press Update Product.";
  $("editorHeading").textContent="Edit Product — "+product.product_code;$("saveProductBtn").textContent="Update Product";$("cancelEditBtn").hidden=false;
  $("existingBox").style.display="none";$("form").style.display="block";$("msg").textContent="";
  $("form").scrollIntoView({behavior:"smooth",block:"start"});
}
function handleEditPhotoSelection(){
  const product=items.find(p=>String(p.id)===String(editingProductId)),files=Array.from($("editPhotoFiles").files||[]);
  const bad=files.find(file=>!file.type.startsWith("image/")||file.size>5*1024*1024),remaining=product?Math.max(0,5-photoRows(product).length):0;
  if(!product){$("msg").textContent="Open a product before adding photos.";return;}
  if(bad){editPhotoFiles=[];clearEditPhotoPreviews();$("editPhotoFiles").value="";$("msg").textContent=!bad.type.startsWith("image/")?"Please choose image files only.":"Each image must be 5 MB or smaller.";return;}
  if(files.length>remaining){editPhotoFiles=[];clearEditPhotoPreviews();$("editPhotoFiles").value="";$("msg").textContent="This product has "+photoRows(product).length+" photos. You can add only "+remaining+" more (maximum 5).";return;}
  clearEditPhotoPreviews();editPhotoFiles=files;editPhotoPreviewUrls=files.map(file=>URL.createObjectURL(file));
  $("editPhotoPreview").innerHTML=editPhotoPreviewUrls.map((url,index)=>'<div class="photo-preview-item"><img src="'+url+'" alt="New product photo '+(index+1)+'"><span>'+(index+1)+'</span></div>').join("");
  $("editPhotoHelp").textContent=photoRows(product).length+" existing photo(s) + "+files.length+" selected = "+(photoRows(product).length+files.length)+" of 5 maximum. Press Update Product to save.";
  $("msg").textContent=files.length+" additional photo"+(files.length===1?"":"s")+" selected.";
}
$("cameraBtn").onclick=()=>$("cameraFile").click();$("fileBtn").onclick=()=>$("fileFile").click();
$("cameraFile").onchange=()=>showImages($("cameraFile").files);$("fileFile").onchange=()=>showImages($("fileFile").files);

async function saveExistingProduct(product,c,validation,productLength){
  const body={category_id:validation.value.categoryId,product_name:validation.value.name,type:validation.value.type,selling_price:validation.value.sellingPrice,
    gender:$("gender").value,active:$("active").checked,description:$("description").value.trim()||null,length_cm:productLength,
    thickness:c.has_thickness?($("thickness").value.trim()||null):null,gold_amount_g:c.has_gold_amount?(Number($("gold").value)||null):null};
  const updated=await sb("products?id=eq."+encodeURIComponent(product.id),{method:"PATCH",headers:{"Prefer":"return=representation"},body:JSON.stringify(body)});
  if(!updated||!updated.length)throw new Error("No product was updated. Check that your staff account has edit permission.");
  let photoResult="";
  if(editPhotoFiles.length){
    try{
      const added=await uploadAdditionalPhotos({...product,product_name:validation.value.name},editPhotoFiles);
      photoResult=" Added "+added+" photo"+(added===1?"":"s")+".";
    }catch(error){photoResult=" Photo upload stopped after "+Number(error.photosAdded||0)+" new photo(s): "+error.message;}
  }
  const success="Updated "+product.product_code+". Product details saved."+photoResult;
  await load();fillExistingProducts();resetEditor();$("msg").textContent=success;
}
async function insertProductRecord(table,body){
  if(insertRecoveryBlocksSave())throw new Error("Verify the previous saved record before creating another.");
  pendingProductInsert=restoreProductInsert({table,body});showPendingProductInsert();
  return submitPendingProductInsert();
}
$("form").onsubmit=async e=>{
  e.preventDefault();if(productSaving)return;
  if(insertRecoveryBlocksSave()){showPendingProductInsert();variantMessage("Verify the previous saved record before saving another product.",true);return;}
  productSaving=true;$("saveProductBtn").disabled=true;
  $("msg").textContent=editingProductId?"Updating product...":"Saving product...";
  let createdProduct=null;
  try{
    const c=cats.find(x=>String(x.id)===String($("category").value));if(!c)throw new Error("Choose a category.");
    const productLength=c.has_length?Number($("length").value):null;
    if(c.has_length&&(!Number.isFinite(productLength)||productLength<=0))throw new Error("Enter the product length in centimetres.");
    if(!editingProductId&&selectedImages.length>5)throw new Error("Choose no more than 5 product photos.");
    const rules=await getProductRules(),draft={categoryId:c.id,name:$("name").value.trim(),type:$("type").value.trim(),sellingPrice:$("price").value};
    const validation=rules.validateProductDraft(draft);if(!validation.ok)throw new Error(validation.error);
    if(editingProductId){
      const product=findCurrentProduct(editingProductId);if(!product)throw new Error("That product could not be found. Refresh the page and try again.");
      if(photoRows(product).length+editPhotoFiles.length>5)throw new Error("A product can have no more than five photos.");
      await saveExistingProduct(product,c,validation,productLength);return;
    }
    const openingPlan=await readOpeningStock("stock","stockLocation",$("active").checked);
    const variantRules=await getVariantRules();
    const variantDraft=variantRules.buildVariantDraft(c,{color:$("color").value,size:$("size").value,length:$("length").value,stock:$("stock").value,low:$("low").value});
    const product=await insertProductRecord("products",{
      id:crypto.randomUUID(),category_id:validation.value.categoryId,product_name:validation.value.name,type:validation.value.type,
      gender:$("gender").value,active:$("active").checked,selling_price:validation.value.sellingPrice,description:$("description").value.trim()||null,length_cm:productLength,
      thickness:c.has_thickness?($("thickness").value.trim()||null):null,gold_amount_g:c.has_gold_amount?(Number($("gold").value)||null):null
    });
    createdProduct=product;
    const variant=await insertProductRecord("product_variants",{
      id:crypto.randomUUID(),product_id:product.id,...variantDraft,
      stock_quantity:multiShop()?0:variantDraft.stock_quantity,low_stock_limit:Number($("low").value??3)
    });
    const stockResult=await recordOpeningStock(product,variant.id,openingPlan);
    let uploadedCount=0,photoResult="";
    try{
      for(let i=0;i<selectedImages.length;i++){
        await uploadAndSavePhoto(selectedImages[i],product,{
          alt_text:product.product_name+(selectedImages.length>1?" — image "+(i+1):""),
          is_primary:i===0,sort_order:i
        });uploadedCount++;
      }
    }catch(error){photoResult=" Photo upload stopped after "+uploadedCount+" photo(s): "+error.message+". Use Add photos in the product list to finish.";}
    const success="Saved "+product.product_code+(uploadedCount?" with "+uploadedCount+" photo"+(uploadedCount===1?"":"s"):"")+"."+stockResult;
    resetEditor();
    try{await load();fillExistingProducts();}catch{photoResult=" Refresh the product list to see the saved product.";}
    $("msg").textContent=success+photoResult;
  }catch(error){
    console.error("Product save failed",error?.code||"");
    if(insertRecoveryBlocksSave()){
      showPendingProductInsert(error.message);variantMessage("Save needs confirmation. Use Verify saved record below; do not submit another product.",true);
    }else if(createdProduct){
      resetEditor();await load().catch(()=>{});fillExistingProducts();
      variantMessage("Product "+createdProduct.product_code+" is saved, but setup is incomplete: "+error.message+". Find it in the product list and finish its variant or photos; do not create it again.",true);
    }else variantMessage("Error: "+error.message,true);
  }finally{productSaving=false;showPendingProductInsert();}
};
$("saveStorefrontCategories").onclick=saveStorefrontCategories;
init().catch(error=>{$("msg").textContent="Error: "+error.message;console.error(error);});
