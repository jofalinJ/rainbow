let productRules=null;
async function getProductRules(){if(!productRules)productRules=await import("../src/domain/productRules.mjs");return productRules;}

const $=id=>document.getElementById(id);let cats=[],items=[];
const escHtml=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])).split(String.fromCharCode(39)).join("&#39;");
const IMAGE_BUCKET="product-images";
const TYPE_OPTIONS={ "Roll Chain":["Roll","Designer","Heavy","Light"],"Thrissur Chain":["Roll","Designer","Heavy","Light"],"Coir Chain":["Roll","Designer","Heavy","Light"],"China Chain":["Roll","Designer","Heavy","Light"],"Bracelet":["Chain","Stone","Plain","Designer"],"Bangle":["Plain","Stone","Designer"],"Ring":["Stone","Plain","Designer"],"Dollar":["Stone","Plain","Designer"],"Earring":["Stone","Plain","Designer","Hoop","Jhumka"],"Anklet":["Plain","Stone","Designer"],"Necklace":["Stone","Plain","Designer"],"Men's Jewellery":["Chain","Bracelet","Bangle","Ring","Pendant","Necklace","Earring","Anklet","Dollar","Roll","Designer","Heavy","Light","Plain","Stone"]};
function setField(id,show){const e=$(id);e.classList.toggle("optional",!show);const input=e.querySelector("input");if(input)input.disabled=!show;}
function updateFields(){const c=cats.find(x=>x.id===$( "category").value);if(!c)return;setField("sizeField",!!c.has_size);setField("colorField",!!c.has_color);setField("lengthField",!!c.has_length);setField("thicknessField",!!c.has_thickness);setField("goldField",!!c.has_gold_amount);$("type").innerHTML=(TYPE_OPTIONS[c.name]||[]).map(x=>'<option value="'+x+'">'+x+"</option>").join("")||'<option value="">Select type</option>';if(!c.has_size)$("size").value="0";if(!c.has_color)$("color").value="0";}
let variantMode=false;
function setupVariantBox(){ $("newProductBtn").onclick=()=>{variantMode=false;$("existingBox").style.display="none";$("form").style.display="block";}; $("existingBtn").onclick=()=>{variantMode=true;$("existingBox").style.display="block";$("form").style.display="none";fillExistingProducts();}; $("existingProduct").onchange=updateExistingVariantFields; $("saveVariantBtn").onclick=saveVariant; }
function fillExistingProducts(){ $("existingProduct").innerHTML=items.map(p=>'<option value="'+p.id+'">'+p.product_code+' — '+p.product_name+'</option>').join(""); updateExistingVariantFields(); }
function updateExistingVariantFields(){const p=items.find(x=>x.id===$("existingProduct").value);const c=p&&cats.find(x=>x.id===p.category_id);if(!c)return;setField("existingColorField",!!c.has_color);setField("existingSizeField",!!c.has_size);setField("existingLengthField",!!c.has_length);if(!c.has_color)$("existingColor").value="0";if(!c.has_size)$("existingSize").value="0";if(c.has_length)$("existingLength").value="";}
async function saveVariant(){
  const p=items.find(x=>x.id===$("existingProduct").value);
  if(!p)return;
  const c=cats.find(x=>x.id===p.category_id);
  if(!c)return;
  const color=c.has_color?($("existingColor").value.trim()||"0"):"0";
  const size=c.has_size?($("existingSize").value.trim()||"0"):"0";
  const length=c.has_length?Number($("existingLength").value):null;
  if(c.has_length&&(!Number.isFinite(length)||length<=0)){$("msg").textContent="Enter a valid length in centimetres.";return;}
  try{
    await sb("product_variants",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({product_id:p.id,color,size,length_cm:length,stock_quantity:Number($("existingStock").value)||0,low_stock_limit:Number($("existingLow").value)||3})});
    $("msg").textContent="Added variant to "+p.product_code+" ("+[color!=="0"?color:"",size!=="0"?"size "+size:"",length?"length "+length+" cm":""].filter(Boolean).join(", ")+")";
    await load();fillExistingProducts();
  }catch(e){$("msg").textContent="Error: "+e.message;console.error(e);}
}
async function init(){cats=await sb("categories?select=*&active=eq.true&order=name");$("category").innerHTML=cats.map(c=>'<option value="'+c.id+'">'+c.name+"</option>").join("");$("category").onchange=updateFields;updateFields();setupVariantBox();await load();fillExistingProducts();}
async function load(){items=await sb("products?select=id,product_code,product_name,type,selling_price,category_id,length_cm,product_variants(id,color,size,length_cm,stock_quantity),product_images(id,public_url,storage_path,is_primary,sort_order)&active=eq.true&order=created_at.desc");render();}
function render(){
  const q=$("search").value.toLowerCase();
  const a=items.filter(p=>[p.product_name,p.product_code,p.type,((cats.find(c=>c.id===p.category_id)||{}).name)].some(x=>(x||"").toLowerCase().includes(q)));
  $("rows").innerHTML=a.map(p=>{
    const selectedCategory=String(p.category_id||"");
    const categoryOptions=cats.map(c=>'<option value="'+escHtml(c.id)+'"'+(String(c.id)===selectedCategory?' selected':'')+'>'+escHtml(c.name)+'</option>').join("");
    const stock=(p.product_variants||[]).reduce((s,v)=>s+Number(v.stock_quantity||0),0);
    const photos=Array.isArray(p.product_images)?p.product_images.length:0;
    return '<tr><td><b>'+escHtml(p.product_code)+'</b></td><td>'+escHtml(p.product_name)+'</td>'+
      '<td><select class="category-editor" id="category-'+escHtml(p.id)+'" aria-label="Category for '+escHtml(p.product_name)+'">'+categoryOptions+'</select></td>'+
      '<td>'+escHtml(p.type)+'</td><td>₹'+Number(p.selling_price).toLocaleString("en-IN")+'</td><td>'+stock+'</td>'+
      '<td><span class="photo-count">'+photos+'/5</span><button class="save-category" type="button" data-add-photos="'+escHtml(p.id)+'" '+(photos>=5?'disabled':'')+'>Add photos</button><input type="file" accept="image/*" multiple hidden data-image-input="'+escHtml(p.id)+'"></td>'+
      '<td><button class="save-category" type="button" data-save-category="'+escHtml(p.id)+'">Save category</button></td></tr>';
  }).join("")||'<tr><td colspan="8">No products found.</td></tr>';
  bindCategoryEditorActions();
  bindImageUploadActions();
}
function bindImageUploadActions(){
  document.querySelectorAll("[data-add-photos]").forEach(button=>{
    button.onclick=()=>{
      const productId=button.dataset.addPhotos;
      const input=document.querySelector('[data-image-input="'+CSS.escape(productId)+'"]');
      if(input)input.click();
    };
  });
  document.querySelectorAll("[data-image-input]").forEach(input=>{
    input.onchange=()=>addPhotosToProduct(input.dataset.imageInput,input);
  });
}
async function addPhotosToProduct(productId,input){
  const product=items.find(p=>String(p.id)===String(productId));
  const files=Array.from(input.files||[]);
  if(!product||!files.length){input.value="";return;}
  const current=Array.isArray(product.product_images)?product.product_images:[];
  const remaining=5-current.length;
  if(files.length>remaining){
    $("msg").textContent="This product has "+current.length+" photos. You can add only "+Math.max(0,remaining)+" more (maximum 5).";
    input.value="";
    return;
  }
  let added=0;
  try{
    for(const file of files){
      const uploaded=await uploadImage(file,product.product_code);
      await sb("product_images",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
        product_id:product.id,
        public_url:uploaded.url,
        storage_path:uploaded.path,
        alt_text:product.product_name,
        is_primary:current.length===0&&added===0,
        sort_order:current.length+added
      })});
      added++;
    }
    await load();fillExistingProducts();
    $("msg").textContent="Added "+added+" photo"+(added===1?"":"s")+" to "+product.product_code+".";
  }catch(error){
    await load().catch(()=>{});
    $("msg").textContent="Added "+added+" photo"+(added===1?"":"s")+"; stopped because: "+error.message;
  }finally{input.value="";}
}
let selectedImages=[];
let previewObjectUrls=[];
function clearImagePreviews(){
  previewObjectUrls.forEach(url=>URL.revokeObjectURL(url));
  previewObjectUrls=[];
}
function showImages(fileList){
  const files=Array.from(fileList||[]);
  const invalid=files.find(file=>!file.type.startsWith("image/")||file.size>5*1024*1024);
  if(files.length>5||invalid){
    selectedImages=[];clearImagePreviews();$("preview").innerHTML="";
    $("cameraFile").value="";$("fileFile").value="";
    $("msg").textContent=files.length>5?"Choose up to 5 product photos.":(!invalid.type.startsWith("image/")?"Please choose image files only.":"Each image must be 5 MB or smaller.");
    return;
  }
  clearImagePreviews();
  selectedImages=files;
  previewObjectUrls=files.map(file=>URL.createObjectURL(file));
  $("preview").innerHTML=previewObjectUrls.map((url,index)=>'<div class="photo-preview-item"><img src="'+url+'" alt="Product photo '+(index+1)+'"><span>'+(index+1)+'</span></div>').join("");
  $("msg").textContent=files.length+" of 5 photos selected.";
}
$("cameraBtn").onclick=()=>$("cameraFile").click();
$("fileBtn").onclick=()=>$("fileFile").click();
$("cameraFile").onchange=()=>showImages($("cameraFile").files);
$("fileFile").onchange=()=>showImages($("fileFile").files);
async function uploadImage(file,productCode){
  if(!file)return null;
  if(!file.type.startsWith("image/"))throw new Error("Please choose an image file.");
  if(file.size>5*1024*1024)throw new Error("Each image must be 5 MB or smaller.");
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const path=productCode+"/"+crypto.randomUUID()+"."+ext;
  const {error}=await sbClient.storage.from(IMAGE_BUCKET).upload(path,file,{contentType:file.type,cacheControl:"31536000",upsert:false});
  if(error)throw error;
  const {data}=sbClient.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return {path,url:data.publicUrl};
}
$("form").onsubmit=async e=>{
  e.preventDefault();
  $("msg").textContent="Saving product...";
  try{
    const c=cats.find(x=>x.id===$("category").value);
    if(!c)throw new Error("Choose a category.");
    const productLength=c.has_length?Number($("length").value):null;
    if(c.has_length&&(!Number.isFinite(productLength)||productLength<=0))throw new Error("Enter the product length in centimetres.");
    if(selectedImages.length>5)throw new Error("Choose no more than 5 product photos.");
    const rules=await getProductRules();
    const draft={categoryId:c.id,name:$("name").value.trim(),type:$("type").value.trim(),sellingPrice:$("price").value};
    const validation=rules.validateProductDraft(draft);
    if(!validation.ok)throw new Error(validation.error);
    const product=(await sb("products",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
      category_id:validation.value.categoryId,product_name:validation.value.name,type:validation.value.type,
      selling_price:validation.value.sellingPrice,description:$("description").value.trim()||null,
      length_cm:productLength,thickness:c.has_thickness?($("thickness").value.trim()||null):null,
      gold_amount_g:c.has_gold_amount?(Number($("gold").value)||null):null
    })}))[0];
    await sb("product_variants",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
      product_id:product.id,color:c.has_color?($("color").value||"0"):"0",
      size:c.has_size?($("size").value||"0"):"0",length_cm:productLength,
      stock_quantity:Number($("stock").value)||0,low_stock_limit:Number($("low").value)||3
    })});
    for(let i=0;i<selectedImages.length;i++){
      const uploaded=await uploadImage(selectedImages[i],product.product_code);
      await sb("product_images",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
        product_id:product.id,public_url:uploaded.url,storage_path:uploaded.path,
        alt_text:product.product_name+(selectedImages.length>1?" — image "+(i+1):""),
        is_primary:i===0,sort_order:i
      })});
    }
    $("msg").textContent="Saved "+product.product_code+(selectedImages.length?" with "+selectedImages.length+" photo"+(selectedImages.length===1?"":"s"):"");
    e.target.reset();
    $("size").value="0";$("color").value="0";$("stock").value=0;$("low").value=3;
    selectedImages=[];clearImagePreviews();
    $("cameraFile").value="";$("fileFile").value="";$("preview").innerHTML="";
    updateFields();await load();fillExistingProducts();
  }catch(error){console.error(error);$("msg").textContent="Error: "+error.message;}
};
$("search").oninput=render;init().catch(x=>{$("msg").textContent="Error: "+x.message;console.error(x);});