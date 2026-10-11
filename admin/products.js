let productRules=null;
async function getProductRules(){if(!productRules)productRules=await import("../src/domain/productRules.mjs");return productRules;}
const $=id=>document.getElementById(id);
let cats=[],items=[],editingProductId=null,variantMode=false,selectedImages=[],previewObjectUrls=[],editPhotoFiles=[],editPhotoPreviewUrls=[];
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
  const current=editingProductId?items.find(x=>String(x.id)===String(editingProductId)):null;
  setField("sizeField",!!c.has_size&&!editingProductId);setField("colorField",!!c.has_color&&!editingProductId);
  setField("lengthField",!!c.has_length);setField("thicknessField",!!c.has_thickness);setField("goldField",!!c.has_gold_amount);
  const baseTypes=TYPE_OPTIONS[c.name]||[];
  const typeOptions=Array.from(new Set([...baseTypes,...(current&&current.type?[current.type]:[])]));
  $("type").innerHTML=typeOptions.map(x=>'<option value="'+escHtml(x)+'">'+escHtml(x)+"</option>").join("")||'<option value="">Select type</option>';
  if(current&&current.type)$("type").value=current.type;
  if(!c.has_size)$("size").value="0";if(!c.has_color)$("color").value="0";
  setField("stockField",!editingProductId);setField("lowField",!editingProductId);
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
  $("form").style.display="block";$("existingBox").style.display="none";updateFields();
}
function setupVariantBox(){
  $("newProductBtn").onclick=()=>{resetEditor();$("msg").textContent="";};
  $("existingBtn").onclick=()=>{resetEditor();variantMode=true;$("existingBox").style.display="block";$("form").style.display="none";fillExistingProducts();};
  $("cancelEditBtn").onclick=()=>{resetEditor();$("msg").textContent="Edit canceled.";};
  $("existingProduct").onchange=updateExistingVariantFields;$("saveVariantBtn").onclick=saveVariant;$("category").onchange=updateFields;
  $("editPhotoBtn").onclick=()=>$("editPhotoFiles").click();$("editPhotoFiles").onchange=handleEditPhotoSelection;
}
function fillExistingProducts(){
  $("existingProduct").innerHTML=items.map(p=>'<option value="'+escHtml(p.id)+'">'+escHtml(p.product_code)+' — '+escHtml(p.product_name)+'</option>').join("")||'<option value="">No active products</option>';
  updateExistingVariantFields();
}
function updateExistingVariantFields(){
  const p=items.find(x=>String(x.id)===String($("existingProduct").value)),c=p&&cats.find(x=>String(x.id)===String(p.category_id));
  ["existingColorField","existingSizeField","existingLengthField"].forEach(id=>setField(id,false));if(!c)return;
  setField("existingColorField",!!c.has_color);setField("existingSizeField",!!c.has_size);setField("existingLengthField",!!c.has_length);
  if(!c.has_color)$("existingColor").value="0";if(!c.has_size)$("existingSize").value="0";if(c.has_length)$("existingLength").value="";
}
async function saveVariant(){
  const p=items.find(x=>String(x.id)===String($("existingProduct").value));if(!p)return;
  const c=cats.find(x=>String(x.id)===String(p.category_id));if(!c)return;
  const color=c.has_color?($("existingColor").value.trim()||"0"):"0",size=c.has_size?($("existingSize").value.trim()||"0"):"0";
  const length=c.has_length?Number($("existingLength").value):null;
  if(c.has_length&&(!Number.isFinite(length)||length<=0)){$("msg").textContent="Enter a valid length in centimetres.";return;}
  try{
    await sb("product_variants",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({product_id:p.id,color,size,length_cm:length,stock_quantity:Number($("existingStock").value)||0,low_stock_limit:Number($("existingLow").value)||3})});
    $("msg").textContent="Added variant to "+p.product_code+" ("+[color!=="0"?color:"",size!=="0"?"size "+size:"",length?"length "+length+" cm":""].filter(Boolean).join(", ")+")";
    await load();fillExistingProducts();
  }catch(e){$("msg").textContent="Error: "+e.message;console.error(e);}
}

function renderStorefrontCategorySettings(){
  const root=$("storefrontCategoryRows");if(!root)return;
  cats=cats.slice().sort((a,b)=>Number(a.storefront_order||0)-Number(b.storefront_order||0)||a.name.localeCompare(b.name));
  root.innerHTML=cats.map((category,index)=>{
    const count=items.filter(product=>String(product.category_id)===String(category.id)&&product.active!==false&&(product.product_variants||[]).some(variant=>variant.active!==false&&Number(variant.stock_quantity)>0)).length;
    return '<div class="storefront-category-row" data-category-row="'+escHtml(category.id)+'">'+
      '<div class="storefront-category-order"><button type="button" data-category-up="'+escHtml(category.id)+'" aria-label="Move '+escHtml(category.name)+' up" '+(index===0?'disabled':'')+'>↑</button>'+
      '<button type="button" data-category-down="'+escHtml(category.id)+'" aria-label="Move '+escHtml(category.name)+' down" '+(index===cats.length-1?'disabled':'')+'>↓</button></div>'+
      '<div class="storefront-category-name">'+escHtml(category.name)+'<small>'+count+' active product'+(count===1?'':'s')+(count===0?' · hidden from the shop menu':'')+'</small></div>'+
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
async function init(){
  cats=await sb("categories?select=*&active=eq.true&order=storefront_order.asc,name.asc");
  $("category").innerHTML=cats.map(c=>'<option value="'+escHtml(c.id)+'">'+escHtml(c.name)+"</option>").join("");
  updateFields();setupVariantBox();await load();fillExistingProducts();
}
async function load(){
  items=await sb("products?select=id,product_code,product_name,type,gender,display_priority,active,selling_price,category_id,length_cm,description,thickness,gold_amount_g,product_variants(id,color,size,length_cm,stock_quantity,active),product_images(id,public_url,storage_path,is_primary,sort_order)&order=active.desc,created_at.desc");
  render();
}
function render(){
  const q=$("search").value.toLowerCase();
  const a=items.filter(p=>[p.product_name,p.product_code,p.type,((cats.find(c=>String(c.id)===String(p.category_id))||{}).name)].some(x=>(x||"").toLowerCase().includes(q)));
  $("rows").innerHTML=a.map(p=>{
    const stock=(p.product_variants||[]).filter(v=>v.active!==false).reduce((sum,v)=>sum+Number(v.stock_quantity||0),0),photos=photoRows(p).length;
    return '<tr><td><b>'+escHtml(p.product_code)+'</b></td><td>'+escHtml(p.product_name)+'</td>'+
      '<td>'+escHtml((cats.find(c=>String(c.id)===String(p.category_id))||{}).name||"")+'</td>'+
      '<td>'+escHtml(p.type)+'</td><td>'+escHtml(p.gender||"women")+'</td><td>'+(p.active===false?"Draft":"Published")+'</td><td>₹'+Number(p.selling_price).toLocaleString("en-IN")+'</td><td>'+stock+'</td>'+
      '<td><span class="photo-count">'+photos+'/5</span><button class="save-category" type="button" data-add-photos="'+escHtml(p.id)+'" '+(photos>=5?'disabled':'')+'>Add photos</button><input type="file" accept="image/*" multiple hidden data-image-input="'+escHtml(p.id)+'"></td>'+
      '<td><button class="save-category" type="button" data-edit-product="'+escHtml(p.id)+'">Edit product</button></td></tr>';
  }).join("")||'<tr><td colspan="10">No products found.</td></tr>';
  bindProductActions();bindImageUploadActions();renderStorefrontCategorySettings();
}
function bindProductActions(){document.querySelectorAll("[data-edit-product]").forEach(button=>{button.onclick=()=>startEditProduct(button.dataset.editProduct);});}
function bindImageUploadActions(){
  document.querySelectorAll("[data-add-photos]").forEach(button=>{button.onclick=()=>{const input=button.closest("td")?.querySelector("[data-image-input]");if(input)input.click();};});
  document.querySelectorAll("[data-image-input]").forEach(input=>{input.onchange=()=>addPhotosToProduct(input.dataset.imageInput,input);});
}
async function uploadImage(file,productCode){
  if(!file)throw new Error("Choose an image first.");
  if(!file.type.startsWith("image/"))throw new Error("Please choose an image file.");
  if(file.size>5*1024*1024)throw new Error("Each image must be 5 MB or smaller.");
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg",path=productCode+"/"+crypto.randomUUID()+"."+ext;
  const {error}=await sbClient.storage.from(IMAGE_BUCKET).upload(path,file,{contentType:file.type,cacheControl:"31536000",upsert:false});
  if(error)throw error;
  const {data}=sbClient.storage.from(IMAGE_BUCKET).getPublicUrl(path);return {path,url:data.publicUrl};
}
async function uploadAdditionalPhotos(product,files){
  const current=photoRows(product);if(current.length+files.length>5)throw new Error("Only "+Math.max(0,5-current.length)+" more photo(s) can be added. Maximum 5 per product.");
  let added=0;
  try{
    for(const file of files){
      const uploaded=await uploadImage(file,product.product_code);
      await sb("product_images",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({product_id:product.id,public_url:uploaded.url,storage_path:uploaded.path,alt_text:product.product_name,is_primary:current.length===0&&added===0,sort_order:current.length+added})});
      added++;
    }
  }catch(error){error.photosAdded=added;throw error;}
  return added;
}
async function addPhotosToProduct(productId,input){
  const product=items.find(p=>String(p.id)===String(productId)),files=Array.from(input.files||[]);
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
$("form").onsubmit=async e=>{
  e.preventDefault();$("msg").textContent=editingProductId?"Updating product...":"Saving product...";
  try{
    const c=cats.find(x=>String(x.id)===String($("category").value));if(!c)throw new Error("Choose a category.");
    const productLength=c.has_length?Number($("length").value):null;
    if(c.has_length&&(!Number.isFinite(productLength)||productLength<=0))throw new Error("Enter the product length in centimetres.");
    if(!editingProductId&&selectedImages.length>5)throw new Error("Choose no more than 5 product photos.");
    const rules=await getProductRules(),draft={categoryId:c.id,name:$("name").value.trim(),type:$("type").value.trim(),sellingPrice:$("price").value};
    const validation=rules.validateProductDraft(draft);if(!validation.ok)throw new Error(validation.error);
    if(editingProductId){
      const product=items.find(x=>String(x.id)===String(editingProductId));if(!product)throw new Error("That product could not be found. Refresh the page and try again.");
      if(photoRows(product).length+editPhotoFiles.length>5)throw new Error("A product can have no more than five photos.");
      await saveExistingProduct(product,c,validation,productLength);return;
    }
    const product=(await sb("products",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
      category_id:validation.value.categoryId,product_name:validation.value.name,type:validation.value.type,
      gender:$("gender").value,active:$("active").checked,selling_price:validation.value.sellingPrice,description:$("description").value.trim()||null,length_cm:productLength,
      thickness:c.has_thickness?($("thickness").value.trim()||null):null,gold_amount_g:c.has_gold_amount?(Number($("gold").value)||null):null
    })}))[0];
    await sb("product_variants",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
      product_id:product.id,color:c.has_color?($("color").value||"0"):"0",size:c.has_size?($("size").value||"0"):"0",length_cm:productLength,
      stock_quantity:Number($("stock").value)||0,low_stock_limit:Number($("low").value)||3
    })});
    let uploadedCount=0;
    for(let i=0;i<selectedImages.length;i++){
      const uploaded=await uploadImage(selectedImages[i],product.product_code);
      await sb("product_images",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
        product_id:product.id,public_url:uploaded.url,storage_path:uploaded.path,alt_text:product.product_name+(selectedImages.length>1?" — image "+(i+1):""),is_primary:i===0,sort_order:i
      })});uploadedCount++;
    }
    const success="Saved "+product.product_code+(uploadedCount?" with "+uploadedCount+" photo"+(uploadedCount===1?"":"s"):"");
    await load();fillExistingProducts();resetEditor();$("msg").textContent=success;
  }catch(error){console.error(error);$("msg").textContent="Error: "+error.message;}
};
$("search").oninput=render;
$("saveStorefrontCategories").onclick=saveStorefrontCategories;
init().catch(error=>{$("msg").textContent="Error: "+error.message;console.error(error);});