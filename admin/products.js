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
function updateExistingVariantFields(){const p=items.find(x=>x.id===$("existingProduct").value);const c=p&&cats.find(x=>x.id===p.category_id);if(!c)return;setField("existingColorField",!!c.has_color);setField("existingSizeField",!!c.has_size);if(!c.has_color)$("existingColor").value="0";if(!c.has_size)$("existingSize").value="0";}
async function saveVariant(){const p=items.find(x=>x.id===$("existingProduct").value);if(!p)return;const c=cats.find(x=>x.id===p.category_id);const color=c.has_color?($("existingColor").value.trim()||"0"):"0";const size=c.has_size?($("existingSize").value.trim()||"0"):"0";try{await sb("product_variants",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({product_id:p.id,color,size,stock_quantity:Number($("existingStock").value)||0,low_stock_limit:Number($("existingLow").value)||3})});$("msg").textContent="Added variant to "+p.product_code+" ("+color+(c.has_size?", size "+size:"")+")";await load();fillExistingProducts();}catch(e){$("msg").textContent="Error: "+e.message;console.error(e);}}
async function init(){cats=await sb("categories?select=*&active=eq.true&order=name");$("category").innerHTML=cats.map(c=>'<option value="'+c.id+'">'+c.name+"</option>").join("");$("category").onchange=updateFields;updateFields();setupVariantBox();await load();fillExistingProducts();}
async function load(){items=await sb("products?select=id,product_code,product_name,type,selling_price,category_id,product_variants(stock_quantity)&active=eq.true&order=created_at.desc");render();}
function render(){
  const q=$("search").value.toLowerCase();
  const a=items.filter(p=>[p.product_name,p.product_code,p.type,((cats.find(c=>c.id===p.category_id)||{}).name)].some(x=>(x||"").toLowerCase().includes(q)));
  $("rows").innerHTML=a.map(p=>{
    const selectedCategory=String(p.category_id||"");
    const categoryOptions=cats.map(c=>'<option value="'+escHtml(c.id)+'"'+(String(c.id)===selectedCategory?' selected':'')+'>'+escHtml(c.name)+'</option>').join("");
    const stock=(p.product_variants||[]).reduce((s,v)=>s+Number(v.stock_quantity||0),0);
    return '<tr><td><b>'+escHtml(p.product_code)+'</b></td><td>'+escHtml(p.product_name)+'</td><td><select class="category-editor" id="category-'+escHtml(p.id)+'" aria-label="Category for '+escHtml(p.product_name)+'">'+categoryOptions+'</select></td><td>'+escHtml(p.type)+'</td><td>₹'+Number(p.selling_price).toLocaleString("en-IN")+'</td><td>'+stock+'</td><td><button class="save-category" type="button" data-save-category="'+escHtml(p.id)+'">Save category</button></td></tr>';
  }).join("")||'<tr><td colspan="7">No products found.</td></tr>';
  bindCategoryEditorActions();
}
function bindCategoryEditorActions(){
  document.querySelectorAll("[data-save-category]").forEach(button=>{
    button.onclick=async()=>{
      const productId=button.dataset.saveCategory;
      const product=items.find(p=>String(p.id)===String(productId));
      const select=$("category-"+productId);
      if(!product||!select)return;
      const nextCategoryId=String(select.value||"");
      if(nextCategoryId===String(product.category_id)){
        $("msg").textContent="No category change for "+product.product_code+".";
        return;
      }
      const nextCategory=cats.find(c=>String(c.id)===nextCategoryId);
      if(!nextCategory){$("msg").textContent="Choose a valid category.";return;}
      button.disabled=true;
      select.disabled=true;
      $("msg").textContent="Updating category for "+product.product_code+"...";
      try{
        await sb("products?id=eq."+encodeURIComponent(product.id),{method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({category_id:nextCategoryId})});
        product.category_id=nextCategoryId;
        render();
        $("msg").textContent="Updated "+product.product_code+" to category "+nextCategory.name+". Product code was kept unchanged.";
      }catch(error){
        button.disabled=false;
        select.disabled=false;
        $("msg").textContent="Could not update category for "+product.product_code+": "+error.message;
      }
    };
  });
}
let selectedImage=null;let previewObjectUrl=null;
function showImage(file){
  if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl=file?URL.createObjectURL(file):null;
  selectedImage=file;
  $("preview").innerHTML=file?'<img src="'+previewObjectUrl+'" alt="Product preview">':"";
}
$("cameraBtn").onclick=()=>$("cameraFile").click();
$("fileBtn").onclick=()=>$("fileFile").click();
$("cameraFile").onchange=()=>showImage($("cameraFile").files[0]);
$("fileFile").onchange=()=>showImage($("fileFile").files[0]);
async function uploadImage(file,productCode){if(!file)return null;if(!file.type.startsWith("image/"))throw new Error("Please choose an image file.");if(file.size>5*1024*1024)throw new Error("Image must be 5 MB or smaller.");const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";const path=productCode+"/"+crypto.randomUUID()+"."+ext;const{error}=await sbClient.storage.from(IMAGE_BUCKET).upload(path,file,{contentType:file.type,cacheControl:"31536000",upsert:false});if(error)throw error;const{data}=sbClient.storage.from(IMAGE_BUCKET).getPublicUrl(path);return{path,url:data.publicUrl};}
$("form").onsubmit=async e=>{e.preventDefault();$("msg").textContent="Saving product...";try{let c=cats.find(x=>x.id===$( "category").value);if(!c)throw new Error("Choose a category.");const rules=await getProductRules();const draft={categoryId:c.id,name:$("name").value.trim(),type:$("type").value.trim(),sellingPrice:$("price").value};const validation=rules.validateProductDraft(draft);if(!validation.ok)throw new Error(validation.error);let p=(await sb("products",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({category_id:validation.value.categoryId,product_name:validation.value.name,type:validation.value.type,selling_price:validation.value.sellingPrice,description:$("description").value.trim()||null,length_cm:c.has_length?(Number($("length").value)||null):null,thickness:c.has_thickness?($("thickness").value.trim()||null):null,gold_amount_g:c.has_gold_amount?(Number($("gold").value)||null):null})}))[0];const file=selectedImage;const uploaded=await uploadImage(file,p.product_code);await sb("product_variants",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({product_id:p.id,color:c.has_color?($("color").value||"0"):"0",size:c.has_size?($("size").value||"0"):"0",stock_quantity:Number($("stock").value)||0,low_stock_limit:Number($("low").value)||3})});if(uploaded)await sb("product_images",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({product_id:p.id,public_url:uploaded.url,storage_path:uploaded.path,alt_text:p.product_name,is_primary:true})});$("msg").textContent="Saved "+p.product_code+(uploaded?" with photo":"");e.target.reset();$("size").value="0";$("color").value="0";$("stock").value=0;$("low").value=3;selectedImage=null;if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=null;}$("cameraFile").value="";$("fileFile").value="";$("preview").innerHTML="";updateFields();await load();}catch(x){console.error(x);$("msg").textContent="Error: "+x.message;}}
$("search").oninput=render;init().catch(x=>{$("msg").textContent="Error: "+x.message;console.error(x);});