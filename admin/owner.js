/* Shared shop staff catalogue. Supabase Auth, RLS and ERP RPCs remain authoritative. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const BUCKET = "product-images";
const MAX_IMAGES = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const money = amount => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(amount)||0);
const id = () => crypto.randomUUID();
const state = {client:null,user:null,role:null,categories:[],locations:[],online:null,products:[],balances:[],screen:"dashboard",editorId:null,gallery:[],deleted:[],receivedNew:false,busy:false,limit:24,categoryLimit:48,visibilityProductId:null,selected:new Set()};
const safeURL = value => {try{const u=new URL(value);return u.protocol==="https:"?u.href:"";}catch{return"";}};
const friendly = error => {
 const message=String(error?.message||error||"Unknown error");
 if(/insufficient|no stock|unreserved/i.test(message))return "Not enough available stock at the chosen shop. Check Inventory and try again.";
 if(/reserved|in.transit/i.test(message))return "Some stock belongs to a pending order or transfer. Finish that in Inventory first.";
 if(/permission|not authorized|policy|42501/i.test(message))return "Your account cannot perform this action. Ask the owner for approval.";
 if(/duplicate|unique/i.test(message))return "That product code or category already exists.";
 return message.length>220?message.slice(0,220)+"…":message;
};
function toast(message,sku="",draft=false){
 const box=$("ownerToast");box.replaceChildren();
 const title=document.createElement("strong");title.textContent=message;box.append(title);
 if(sku){
  const actions=document.createElement("div");actions.className="toast-actions";
  const link=document.createElement("a");link.href="../product.html?sku="+encodeURIComponent(sku);link.textContent="View on store";link.target="_blank";link.rel="noopener";
  const another=document.createElement("button");another.type="button";another.textContent="Add another";
  another.onclick=()=>{const category=$("ownerCategory").value;resetEditor(category);show("editor");box.hidden=true;};
  if(!draft)actions.append(link);
  actions.append(another);box.append(actions);
 }
 box.hidden=false;
}
function message(text,error=false){const el=$("editMessage");el.textContent=text;el.style.color=error?"#a40000":"#27683d";}
async function result(promise){const {data,error}=await promise;if(error)throw new Error(error.message||"Database request failed");return data;}
function operationKey(type,parts){return "rainbow-owner-"+type+"-"+parts.map(String).join("-");}
function stableOperationId(key){
 try{let request=sessionStorage.getItem(key);if(!request){request=id();sessionStorage.setItem(key,request);}return request;}
 catch{return id();}
}
function clearOperation(key){try{sessionStorage.removeItem(key);}catch{ /* Storage may be disabled. */ }}
const canEdit=()=>["admin","inventory_staff","cashier"].includes(state.role);
const canPublish=()=>state.role==="admin";
async function verifyOwner(permission="view"){
 const {data,error}=await state.client.auth.getUser();
 if(error||!data?.user)throw new Error("Please sign in.");
 const profile=await result(state.client.from("staff_profiles").select("role,active,archived_at").eq("user_id",data.user.id).maybeSingle());
 if(!profile||!profile.active||profile.archived_at||!["admin","inventory_staff","cashier"].includes(profile.role))
   throw new Error("An active shop staff account is required.");
 state.user=data.user;state.role=profile.role;
 if(permission==="catalog_write"&&!canEdit())throw new Error("Only active staff can change product drafts.");
 if(permission==="publish"&&!canPublish())throw new Error("Only the owner can publish or allocate online stock.");
 return data.user;
}
async function mutate(action,permission="catalog_write"){await verifyOwner(permission);return action();}
function closeMenu(){const menu=$("ownerMenu");menu.classList.remove("is-open");$("drawerBackdrop").hidden=true;$("menuToggle").setAttribute("aria-expanded","false");}
function show(screen){
 state.screen=screen;
 document.querySelectorAll(".screen").forEach(el=>el.hidden=el.id!=="screen-"+screen);
 document.querySelectorAll("[data-screen]").forEach(el=>{el.classList.toggle("active",el.dataset.screen===screen);if(el.classList.contains("active"))el.setAttribute("aria-current","page");else el.removeAttribute("aria-current");});
 closeMenu();window.scrollTo({top:0,behavior:"auto"});
 if(screen==="products")renderProducts();
 if(screen==="categories"){renderCategories();renderCategoryCatalogue();}
 if(screen==="dashboard")renderDashboard();
}
function categoryById(value){return state.categories.find(c=>c.id===value);}
function variantOf(p){return (p.product_variants||[]).find(v=>v.active!==false)||(p.product_variants||[])[0];}
function variantsOf(p){return (p.product_variants||[]).filter(v=>v.active!==false);}
function photosOf(p){return (p.product_images||[]).slice().sort((a,b)=>Number(!!b.is_primary)-Number(!!a.is_primary)||Number(a.sort_order)-Number(b.sort_order));}
function listingOf(p){const raw=p.erp_online_listings;return Array.isArray(raw)?raw[0]:raw;}
function published(p){return !p.archived_at&&p.active!==false&&listingOf(p)?.published===true;}
function onlineStock(p){
 return variantsOf(p).reduce((sum,v)=>{
  // Non-admin staff cannot read the online ERP balance. The stock_quantity
  // mirror is the customer-visible online availability and is read-only here.
  if(!canPublish())return sum+Math.max(0,Number(v.stock_quantity||0));
  const b=state.balances.find(row=>row.variant_id===v.id);
  return sum+Math.max(0,Number(b?.on_hand||0)-Number(b?.reserved||0));
 },0);
}
function visibleOnStorefront(p){return published(p)&&variantsOf(p).some(v=>Number(v.stock_quantity)>0)&&Number(p.selling_price)>0&&photosOf(p).length>0;}
function onlineHeld(p){return variantsOf(p).reduce((sum,v)=>sum+Number(state.balances.find(row=>row.variant_id===v.id)?.reserved||0),0);}
function badge(p){
 if(p.archived_at)return ["Archived","archived"];
 if(published(p))return [onlineStock(p)>0?"Published":"Published · out of stock","published"];
 return ["Draft","draft"];
}
async function fetchAll(table,select,configure){
 let rows=[],offset=0;
 while(true){
  let query=state.client.from(table).select(select);
  if(configure)query=configure(query);
  const batch=await result(query.range(offset,offset+199));
  rows=rows.concat(batch||[]);
  if(!batch||batch.length<200||rows.length>=5000)break;
  offset+=200;
 }
 return rows;
}
async function refresh(){
 const [categories,locations,products]=await Promise.all([
  fetchAll("categories","id,name,code_prefix,has_color,has_size,has_length,active,storefront_order,show_in_storefront",q=>q.order("storefront_order").order("name")),
  result(state.client.from("erp_locations").select("id,name,kind,active").eq("active",true).order("name")),
  fetchAll("products","id,product_code,product_name,description,selling_price,category_id,type,gender,active,archived_at,created_at,product_images(id,public_url,storage_path,is_primary,sort_order),product_variants(id,product_id,stock_quantity,color,size,length_cm,active),erp_online_listings(published,online_price)",q=>q.order("created_at",{ascending:false}))
 ]);
 state.categories=categories||[];state.locations=locations||[];
 const categorySelect=$("categoryCatalogueFilter"),selectedCategory=categorySelect.value;
 categorySelect.replaceChildren(new Option("All categories","all"));
 for(const cat of state.categories)categorySelect.add(new Option(cat.name,cat.id));
 categorySelect.value=state.categories.some(c=>c.id===selectedCategory)?selectedCategory:"all";
 state.online=state.locations.find(x=>x.kind==="online")||null;
 if(!state.online&&canPublish())throw new Error("Online Store inventory location is not configured.");
 state.products=products||[];
 state.balances=canPublish()&&state.online
  ?await fetchAll("erp_stock_balances","location_id,variant_id,on_hand,reserved",q=>q.eq("location_id",state.online.id))
  :[];
 const cats=$("ownerCategory");const previous=cats.value;
 cats.replaceChildren(new Option("Select a category",""));
 for(const c of state.categories.filter(c=>c.active))cats.add(new Option(c.name,c.id));
 if(state.categories.some(c=>c.id===previous))cats.value=previous;
 const source=$("ownerSource");const old=source.value;source.replaceChildren(new Option("Select the physical shop",""));
 for(const shop of state.locations.filter(x=>x.kind==="branch"))source.add(new Option(shop.name,shop.id));
 if(state.locations.some(x=>x.id===old&&x.kind==="branch"))source.value=old;
 else if(source.options.length===2)source.selectedIndex=1;
 const drafts=state.products.filter(p=>!p.archived_at&&!published(p)).length;
 $("draftBadge").textContent=drafts+" drafts";
 renderDashboard();renderProducts();renderCategories();renderCategoryCatalogue();renderExtras();
}
function renderDashboard(){
 const live=state.products.filter(p=>published(p));
 $("statPublished").textContent=live.length;
 $("statDraft").textContent=state.products.filter(p=>!p.archived_at&&!published(p)).length;
 $("statOut").textContent=live.filter(p=>onlineStock(p)===0).length;
 $("statLow").textContent=live.filter(p=>onlineStock(p)>0&&onlineStock(p)<=2).length;
 const attention=state.products.filter(p=>!p.archived_at&&photosOf(p).length===0).slice(0,12);
 const el=$("needsAttention");el.replaceChildren();
 if(!attention.length){el.textContent="All products have photos.";return;}
 attention.forEach(p=>{
  const article=document.createElement("div");article.className="attention-item";
  const name=document.createElement("span");name.textContent=p.product_name+" — missing photos";
  const button=document.createElement("button");button.type="button";button.textContent=canEdit()?"Add photos":"Owner review";button.disabled=!canEdit();button.onclick=()=>edit(p.id);
  article.append(name,button);el.append(article);
 });
}
function filtered(){
 const q=$("ownerSearch").value.toLowerCase().trim(),filter=$("ownerFilter").value;
 return state.products.filter(p=>{
  const match=(p.product_name+" "+p.product_code).toLowerCase().includes(q);
  if(!match)return false;
  if(filter==="published")return published(p);
  if(filter==="draft")return !p.archived_at&&!published(p);
  if(filter==="archived")return !!p.archived_at;
  if(filter==="out")return published(p)&&onlineStock(p)===0;
  if(filter==="photos")return !p.archived_at&&photosOf(p).length===0;
  return !p.archived_at;
 });
}
function renderProducts(){
 const host=$("ownerProducts");host.replaceChildren();
 $("ownerBulkBar").hidden=!canPublish();
 const rows=filtered().slice(0,state.limit);
 $("loadMore").hidden=filtered().length<=state.limit;
 $("bulkCount").textContent=state.selected.size+" selected";
 $("selectAll").checked=rows.length>0&&rows.every(p=>state.selected.has(p.id));
 if(!rows.length){const empty=document.createElement("p");empty.className="empty-list";empty.textContent="No matching products. Change the filter or add a product.";host.append(empty);return;}
 rows.forEach(p=>{
  const article=document.createElement("article");article.className="product-card";
  const check=document.createElement("input");check.type="checkbox";check.hidden=!canPublish();check.checked=state.selected.has(p.id);check.setAttribute("aria-label","Select "+p.product_name);check.onchange=()=>{check.checked?state.selected.add(p.id):state.selected.delete(p.id);renderProducts();};
  const cover=document.createElement("div");cover.className="product-cover";
  const src=safeURL(photosOf(p)[0]?.public_url);
  if(src){const img=document.createElement("img");img.className="product-cover";img.src=src;img.alt="";img.loading="lazy";cover.append(img);}else cover.textContent="No photo";
  const info=document.createElement("div");info.className="product-info";
  const name=document.createElement("strong");name.textContent=p.product_name;
  const details=document.createElement("small");details.textContent=p.product_code+" · "+(categoryById(p.category_id)?.name||"Category")+" · "+money(p.selling_price);
  const status=document.createElement("span");status.className="status "+badge(p)[1];status.textContent=badge(p)[0];
  const stock=document.createElement("small");stock.textContent=onlineStock(p)+" available online"+(onlineHeld(p)?" · "+onlineHeld(p)+" reserved":"");
  info.append(name,details,status,stock);
  const quick=document.createElement("div");quick.className="product-quick";
  const priceLabel=document.createElement("label");priceLabel.textContent="Price ₹";
  const price=document.createElement("input");price.type="number";price.min="0.01";price.step="0.01";price.disabled=!canPublish();price.value=Number(p.selling_price);price.setAttribute("aria-label","Price for "+p.product_name);priceLabel.append(price);
  const stockLabel=document.createElement("label");stockLabel.textContent="Online stock";
  const target=document.createElement("input");target.type="number";target.min="0";target.step="1";target.max="100000";target.value=String(onlineStock(p));target.disabled=!canPublish()||variantsOf(p).length!==1||!published(p);target.title=!published(p)?"Publish before allocating online stock.":target.disabled?"Use Inventory for multi-variant products":"";stockLabel.append(target);
  quick.append(priceLabel,stockLabel);
  const actions=document.createElement("div");actions.className="product-actions";
  const addButton=(text,handler)=>{const btn=document.createElement("button");btn.type="button";btn.textContent=text;btn.onclick=()=>safeAction(handler);actions.append(btn);};
  if(canPublish())addButton("Save price/stock",async()=>{
   const priceValue=Number(price.value),qty=Number(target.value);
   if(!Number.isFinite(priceValue)||priceValue<=0)throw new Error("Price must be greater than zero.");
   if(!target.disabled&&(!Number.isSafeInteger(qty)||qty<0))throw new Error("Stock must be zero or more.");
   await mutate(async()=>{await result(state.client.from("products").update({selling_price:priceValue}).eq("id",p.id));if(!target.disabled)await setOnlineQuantity(p,qty);});
   toast("Price and online stock saved.");await refresh();
  });
  if(canEdit()&&(canPublish()||!published(p))&&!p.archived_at)addButton("Edit",()=>edit(p.id));
  if(canPublish())addButton(visibleOnStorefront(p)?"Hide Online":"Show Online",async()=>{
   if(visibleOnStorefront(p)){await mutate(()=>unpublish(p),"publish");toast("Hidden from online shop.");await refresh();}
   else await prepareShowOnline(p);
  });
  if(p.archived_at&&canPublish()){
   addButton("Restore as draft",async()=>{
    await mutate(async()=>{
     await result(state.client.from("products").update({archived_at:null,active:true}).eq("id",p.id));
     await publication(p,false);
    },"publish");
    toast("Restored as a draft.");await refresh();
   });
  }else if(!p.archived_at){
   if(canEdit())addButton("Duplicate",async()=>{await mutate(()=>duplicateProduct(p));await refresh();});
   if(canPublish())addButton("Archive",async()=>{
    if(!confirm("Archive "+p.product_name+"? It will disappear from the website, but its history remains."))return;
    await mutate(async()=>{await unpublish(p);await result(state.client.from("products").update({active:false,archived_at:new Date().toISOString()}).eq("id",p.id));},"publish");
    toast("Product archived.");await refresh();
   });
  }
  article.append(check,cover,info,quick,actions);host.append(article);
 });
}
async function safeAction(work){
 if(state.busy)return;
 state.busy=true;
 try{await work();}catch(error){toast(friendly(error));console.error(error);}
 finally{state.busy=false;}
}
function clearErrors(){["Photos","Name","Category","Price","Stock"].forEach(key=>{$("error"+key).textContent="";});}
function fieldError(key,error){$("error"+key).textContent=error;}
function renderExtras(){
 const c=categoryById($("ownerCategory").value),host=$("variantExtras");host.replaceChildren();
 if(!c)return;
 const options=[["has_color","ownerColor","Colour","e.g. Gold"],["has_size","ownerSize","Size","e.g. 08"],["has_length","ownerLength","Length (cm)","e.g. 60"]];
 options.filter(([key])=>c[key]).forEach(([,field,name,hint])=>{
  const label=document.createElement("label");label.textContent=name;
  const input=document.createElement("input");input.id=field;input.placeholder=hint;
  if(field==="ownerLength"){input.type="number";input.min="0.01";input.step="0.01";input.inputMode="decimal";}
  else input.maxLength=40;
  label.append(input);host.append(label);
 });
}
function cleanupPreviews(){state.gallery.filter(g=>!g.existing&&g.url?.startsWith("blob:")).forEach(g=>URL.revokeObjectURL(g.url));}
function resetEditor(category=""){
 cleanupPreviews();state.editorId=null;state.gallery=[];state.deleted=[];state.receivedNew=false;
 $("ownerProductForm").reset();$("productPhotos").value="";$("ownerStock").value="0";$("ownerStock").disabled=!canEdit();$("ownerSku").disabled=!canEdit();
 $("ownerMoreDetails").open=false;
 if(category)$("ownerCategory").value=category;
 else if($("ownerCategory").options.length===2)$("ownerCategory").selectedIndex=1;
 $("ownerStockConfirm").checked=false;$("ownerStockConfirm").disabled=false;
 $("editorTitle").textContent="Add a product";clearErrors();message("");renderExtras();renderGallery();$("publishNow").disabled=!canPublish();
}
function edit(productId){
 const p=state.products.find(x=>x.id===productId);if(!p)return;
 if(!canEdit()||(!canPublish()&&published(p))){toast("Only the owner can edit published products.");return;}
 resetEditor(p.category_id);state.editorId=p.id;
 $("editorTitle").textContent="Edit "+p.product_name;
 $("ownerName").value=p.product_name;
 $("ownerDescription").value=p.description||"";
 $("ownerPrice").value=p.selling_price;
 $("ownerSku").value=p.product_code;$("ownerSku").disabled=true;
 renderExtras();const v=variantOf(p);
 if($("ownerColor"))$("ownerColor").value=v?.color==="0"?"":v?.color||"";
 if($("ownerSize"))$("ownerSize").value=v?.size==="0"?"":v?.size||"";
 if($("ownerLength"))$("ownerLength").value=v?.length_cm||"";
 $("ownerStock").value=String(onlineStock(p));
 if(variantsOf(p).length!==1||!canPublish()){$("ownerStock").disabled=true;message("Use Inventory to update existing stock. Owner permission is required for online allocation.",true);}else $("ownerStock").disabled=false;
 $("ownerStockConfirm").checked=true;$("ownerStockConfirm").disabled=true;
 state.gallery=photosOf(p).map(row=>({existing:true,id:row.id,url:safeURL(row.public_url),path:row.storage_path}));
 renderGallery();show("editor");
}
function renderGallery(){
 const host=$("photoGallery");host.replaceChildren();
 state.gallery.forEach((image,index)=>{
  const tile=document.createElement("div");tile.className="photo-tile";
  const img=document.createElement("img");img.src=image.url;img.alt="Product photo "+(index+1);tile.append(img);
  const label=document.createElement("small");label.textContent=index===0?"Cover photo":"Photo "+(index+1);tile.append(label);
  const buttons=document.createElement("div");buttons.className="photo-buttons";
  const make=(name,handler,disabled)=>{const b=document.createElement("button");b.type="button";b.textContent=name;b.disabled=disabled;b.onclick=handler;buttons.append(b);};
  make("←",()=>{[state.gallery[index-1],state.gallery[index]]=[state.gallery[index],state.gallery[index-1]];renderGallery();},index===0);
  make("→",()=>{[state.gallery[index+1],state.gallery[index]]=[state.gallery[index],state.gallery[index+1]];renderGallery();},index===state.gallery.length-1);
  make("×",()=>{const entry=state.gallery.splice(index,1)[0];if(entry.existing)state.deleted.push(entry);else URL.revokeObjectURL(entry.url);renderGallery();},false);
  tile.append(buttons);host.append(tile);
 });
}
function acceptPhotos(fileList){
 const files=Array.from(fileList||[]);
 if(state.gallery.length+files.length>MAX_IMAGES){fieldError("Photos","Maximum "+MAX_IMAGES+" photos per product.");return;}
 for(const file of files){
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>MAX_BYTES||file.size===0){fieldError("Photos","Choose JPG, PNG or WebP photos smaller than 5 MB.");return;}
 }
 for(const file of files)state.gallery.push({existing:false,file,url:URL.createObjectURL(file)});
 fieldError("Photos","");renderGallery();$("productPhotos").value="";
}
function readInput(publish){
 clearErrors();
 const cat=categoryById($("ownerCategory").value);
 const name=$("ownerName").value.trim();
 const priceRaw=$("ownerPrice").value.trim(),price=$("ownerPrice").value.trim()===""?0:Number($("ownerPrice").value.trim());
 const stockRaw=$("ownerStock").value.trim(),stock=Number(stockRaw);
 const code=$("ownerSku").disabled?"":$("ownerSku").value.trim();
 let ok=true;
 if(!name){fieldError("Name","Enter the product name.");ok=false;}
 if(!cat){fieldError("Category","Choose a category.");ok=false;}
 const validPrice=priceRaw===""||(/^\d+(\.\d{1,2})?$/.test(priceRaw)&&Number.isFinite(price)&&price>=0&&price<=10000000);
 if(!validPrice||!priceRaw||price<=0){fieldError("Price","Enter a selling price above ₹0.");ok=false;}
 if(!/^\d+$/.test(stockRaw)||!Number.isSafeInteger(stock)||stock>100000){fieldError("Stock","Enter zero or a whole number up to 100,000.");ok=false;}
 if(code&&!/^[a-z0-9][a-z0-9/_-]{1,39}$/i.test(code)){fieldError("Name","Product code must be 2–40 letters, digits, /, - or _.");ok=false;}
 if(publish&&state.gallery.length===0){fieldError("Photos","Add at least one photo to publish.");ok=false;}
 const length=$("ownerLength")&&$("ownerLength").value.trim()?Number($("ownerLength").value):null;
 if(cat?.has_length&&((publish&&(!Number.isFinite(length)||length<=0))||(length!==null&&(!Number.isFinite(length)||length<=0)))){message("Open More options and enter a valid length in centimetres.",true);$("ownerMoreDetails").open=true;ok=false;}
 if(!state.editorId&&stock>0&&!$("ownerStockConfirm").checked){fieldError("Stock","Confirm that this new stock was counted.");$("ownerMoreDetails").open=true;ok=false;}
 if(stock>0&&!$("ownerSource").value){fieldError("Stock","Choose the shop holding this stock.");$("ownerMoreDetails").open=true;ok=false;}
 return ok?{cat,name,price,stock,code,length,color:$("ownerColor")?.value.trim()||"0",size:$("ownerSize")?.value.trim()||"0",description:$("ownerDescription").value.trim()||null,source:$("ownerSource").value}:null;
}
async function uploadPhoto(file,code){
 const prepared=await window.RainbowImagePrep?.prepare(file);
 const folder=code.replace(/[^a-z0-9-]/gi,"-");
 const path=folder+"/"+id()+"-optimized.webp";
 const thumb=path.replace(/-optimized.webp$/,"-thumb.webp");
 const bucket=state.client.storage.from(BUCKET);
 const uploads=prepared?[{path,blob:prepared.main,type:"image/webp"},{path:thumb,blob:prepared.thumb,type:"image/webp"}]:
 [{path:folder+"/"+id()+"."+file.name.split(".").pop().toLowerCase(),blob:file,type:file.type}];
 const created=[];
 try{
  for(const entry of uploads){
   // Creation of this short-lived token is authorized by the existing Supabase Storage RLS.
   const signed=await result(bucket.createSignedUploadUrl(entry.path));
   const put=await bucket.uploadToSignedUrl(entry.path,signed.token,entry.blob,{contentType:entry.type,cacheControl:"31536000"});
   if(put.error)throw put.error;
   created.push(entry.path);
  }
  return {path:uploads[0].path,url:bucket.getPublicUrl(uploads[0].path).data.publicUrl};
 }catch(error){if(created.length)await bucket.remove(created);throw error;}
}
async function saveGallery(product){
 const desired=state.gallery.slice();
 // Remove unwanted records first, so replacing a photo at the six-image limit is valid.
 for(const photo of state.deleted){await result(state.client.from("product_images").delete().eq("id",photo.id).eq("product_id",product.id));}
 for(const photo of desired){
  if(photo.existing)continue;
  const upload=await uploadPhoto(photo.file,product.product_code);
  try{
   const added=await result(state.client.from("product_images").insert({product_id:product.id,storage_path:upload.path,public_url:upload.url,alt_text:product.product_name,is_primary:false,sort_order:99}).select("id").single());
   photo.id=added.id;photo.path=upload.path;photo.url=upload.url;photo.existing=true;
  }catch(error){await state.client.storage.from(BUCKET).remove([upload.path]);throw error;}
 }
 const keep=desired.filter(p=>p.existing);
 for(const image of keep)await result(state.client.from("product_images").update({is_primary:false}).eq("id",image.id).eq("product_id",product.id));
 for(let i=0;i<keep.length;i++){
  await result(state.client.from("product_images").update({sort_order:i,is_primary:i===0}).eq("id",keep[i].id).eq("product_id",product.id));
 }
 // Storage objects may be shared by duplicated products; remove metadata only.
 state.deleted=[];
}
async function createVariant(product,data){
 const row={product_id:product.id,color:data.cat.has_color?data.color:"0",size:data.cat.has_size?data.size:"0",length_cm:data.cat.has_length?data.length:null,stock_quantity:0,low_stock_limit:2,active:true};
 return result(state.client.from("product_variants").insert(row).select("id,product_id,stock_quantity,color,size,length_cm,active").single());
}
async function receiveInitialStock(product,variant,data){
 if(state.receivedNew||data.stock===0)return;
 const key=operationKey("receive",[product.id,variant.id,data.source,data.stock]);
 const params={p_location:data.source,p_variant:variant.id,p_delta:data.stock,p_reason:"Owner confirmed new stock for online catalogue",p_request:stableOperationId(key)};
 await result(state.client.rpc("erp_adjust_stock",params));
 state.receivedNew=true;
 clearOperation(key);
}
async function freshBalance(variant,location){
 const row=await result(state.client.from("erp_stock_balances").select("on_hand,reserved").eq("location_id",location).eq("variant_id",variant).maybeSingle());
 return {onHand:Number(row?.on_hand||0),reserved:Number(row?.reserved||0)};
}
async function transfer(from,to,variant,qty,reason){
 if(qty<=0)return;
 const key=operationKey("transfer",[from,to,variant,qty]);
 const dispatch=await result(state.client.rpc("erp_dispatch_transfer",{p_from:from,p_to:to,p_variant:variant,p_quantity:qty,p_reason:reason,p_request:stableOperationId(key)}));
 if(dispatch.state!=="received")await result(state.client.rpc("erp_receive_transfer",{p_transfer:dispatch.transfer_id}));
 clearOperation(key);
}
async function setOnlineQuantity(product,target){
 const list=variantsOf(product);
 if(list.length!==1){if(target!==onlineStock(product))throw new Error("Use Inventory to manage each variant separately.");return;}
 const v=list[0];
 const current=await freshBalance(v.id,state.online.id);
 const available=current.onHand-current.reserved;
 if(target===available)return;
 const branch=$("ownerSource").value||state.locations.find(x=>x.kind==="branch")?.id;
 if(!branch)throw new Error("Choose a source shop first.");
 if(target>available)await transfer(branch,state.online.id,v.id,target-available,"Owner allocated stock to online store");
 else await transfer(state.online.id,branch,v.id,available-target,"Owner returned stock from online store");
}
async function publication(product,flag){
 await result(state.client.from("erp_online_listings").upsert({product_id:product.id,published:flag,online_price:null,updated_by:state.user.id,updated_at:new Date().toISOString()},{onConflict:"product_id"}));
}
async function unpublish(product){
 if(!published(product))return;
 const branch=$("ownerSource").value||state.locations.find(x=>x.kind==="branch")?.id;
 const balances=await Promise.all(variantsOf(product).map(async v=>({variant:v,balance:await freshBalance(v.id,state.online.id)})));
 if(balances.some(({balance})=>balance.reserved>0))
  throw new Error("An online checkout has reserved this product. Resolve the reservation before hiding it.");
 if(balances.some(({balance})=>balance.onHand>0)&&!branch)
  throw new Error("Choose a physical shop to return the online stock.");
 // Hide the product before returning available pieces to the physical shop.
 await publication(product,false);
 for(const {variant,balance} of balances){
  if(balance.onHand>0)await transfer(state.online.id,branch,variant.id,balance.onHand,"Owner returned stock after hiding product");
 }
}
function validateOnlineProduct(product){
 if(!product||product.archived_at)throw new Error("This product is archived. Restore it first.");
 if(!product.active)throw new Error("This product is inactive. Edit it before publishing.");
 if(!product.product_name?.trim()||Number(product.selling_price)<=0||photosOf(product).length===0)
  throw new Error("Add a product name, positive price and at least one photo before showing it online.");
 if(!variantsOf(product).length)throw new Error("Add an active product variant in Advanced Products.");
 const category=categoryById(product.category_id);
 if(!category?.active)throw new Error("The selected category is inactive. Enable it before publishing.");
}
async function publishExisting(product){
 validateOnlineProduct(product);
 if(!state.online)throw new Error("Online Store location is not configured.");
 const balances=await Promise.all(variantsOf(product).map(v=>freshBalance(v.id,state.online.id)));
 if(!balances.some(b=>b.onHand>b.reserved))
  throw new Error("Allocate existing stock to the Online Store before publishing this product.");
 await publication(product,true);
}
async function prepareShowOnline(product){
 await verifyOwner("publish");validateOnlineProduct(product);
 if(!state.online)throw new Error("Online Store location is not configured.");
 const onlineBalances=await Promise.all(variantsOf(product).map(v=>freshBalance(v.id,state.online.id)));
 if(onlineBalances.some(b=>b.onHand>b.reserved)){
  await publication(product,true);await refresh();
  toast("Product is now visible online.",product.product_code);return;
 }
 const dialog=$("onlineVisibilityDialog");
 state.visibilityProductId=product.id;
 $("onlineVisibilityTitle").textContent="Show "+product.product_name+" online";
 $("onlineVisibilityProduct").textContent=product.product_code+" · "+money(product.selling_price);
 $("onlineVisibilityFeedback").textContent="";
 $("onlineVisibilityQty").value="1";
 const source=$("onlineVisibilitySource");
 source.replaceChildren(new Option("Select shop stock",""));
 for(const loc of state.locations.filter(loc=>loc.active&&loc.kind==="branch"))
  source.add(new Option(loc.name,loc.id));
 if(source.options.length===2)source.selectedIndex=1;
 const variants=$("onlineVisibilityVariant");variants.replaceChildren();
 for(const variant of variantsOf(product))
  variants.add(new Option([variant.color,variant.size,variant.length_cm?variant.length_cm+" cm":""].filter(x=>x&&x!=="0").join(" · ")||"Standard",variant.id));
 if(!source.value)$("onlineVisibilityFeedback").textContent="Set up a physical shop with recorded stock in Inventory first.";
 dialog.showModal();
}
async function confirmOnlineVisibility(){
 const product=state.products.find(p=>p.id===state.visibilityProductId);
 await verifyOwner("publish");validateOnlineProduct(product);
 const source=$("onlineVisibilitySource").value,variantId=$("onlineVisibilityVariant").value;
 const qty=Number($("onlineVisibilityQty").value);
 if(!state.locations.some(loc=>loc.id===source&&loc.kind==="branch"))
  throw new Error("Choose a physical source shop.");
 if(!variantsOf(product).some(v=>v.id===variantId))
  throw new Error("Choose a valid product variant.");
 if(!Number.isSafeInteger(qty)||qty<1||qty>100000)
  throw new Error("Enter a whole number of pieces between 1 and 100,000.");
 const current=await freshBalance(variantId,source);
 if(qty>current.onHand-current.reserved)
  throw new Error("That shop has only "+Math.max(0,current.onHand-current.reserved)+" available pieces. Check Inventory.");
 await transfer(source,state.online.id,variantId,qty,"Owner allocated recorded shop stock to online storefront");
 const now=await freshBalance(variantId,state.online.id);
 if(now.onHand<=now.reserved)
  throw new Error("The transfer has not finished. Check Inventory before publishing.");
 await publication(product,true);
 $("onlineVisibilityDialog").close();state.visibilityProductId=null;
 await refresh();toast("Product is now visible online.",product.product_code);
}
async function saveProduct(mode){
 const publish=mode==="publish",data=readInput(publish);
 if(!data)return;
 if(state.busy)return;
 state.busy=true;const buttons=[$("saveDraft"),$("publishNow")];buttons.forEach(b=>b.disabled=true);
 message(publish?"Publishing product…":"Saving draft…");
 try{
  await verifyOwner(publish?"publish":"catalog_write");
  // A previous save may have created the DB row before a photo transfer failed.
  // Recover it instead of inserting the product a second time.
  let previous=state.products.find(p=>p.id===state.editorId);
  if(state.editorId&&!previous){
   previous=await result(state.client.from("products").select("id,product_code,product_name,category_id,active,selling_price,product_variants(id,product_id,stock_quantity,color,size,length_cm,active),product_images(id,public_url,storage_path,is_primary,sort_order),erp_online_listings(published)").eq("id",state.editorId).maybeSingle());
   if(!previous)throw new Error("The previously created product was not found. Refresh the catalogue before trying again.");
  }
  if(previous&&!canPublish()&&published(previous))throw new Error("Only the owner can edit published products.");
  let product=previous,variant=previous?variantOf(previous):null;
  const payload={category_id:data.cat.id,product_name:data.name,type:previous?.type||data.cat.name,gender:previous?.gender||"women",description:data.description,selling_price:data.price,length_cm:data.cat.has_length?data.length:null};
  if(!product){
   const record=await result(state.client.from("products").insert({...payload,...(data.code?{product_code:data.code}:{}),active:true}).select("id,product_code,product_name,category_id,active,selling_price").single());
   product=record;state.editorId=record.id;
   $("ownerSku").value=record.product_code;$("ownerSku").disabled=true;
   $("editorTitle").textContent="Edit "+record.product_name;
  }else{
   await result(state.client.from("products").update({...payload,active:true,archived_at:null}).eq("id",product.id));
  }
  if(!variant){
   variant=await createVariant(product,data);
   // A failed save can be retried in this tab without creating a second variant.
   product.product_variants=[variant];
  }else if(data.cat.has_length&&data.length>0&&Number(variant.length_cm)!==data.length){
   await result(state.client.from("product_variants").update({length_cm:data.length}).eq("id",variant.id));
   variant.length_cm=data.length;
  }
  await saveGallery({...product,product_name:data.name});
  if(data.stock>0&&!state.receivedNew&&state.editorId&&(!previous||state.products.every(p=>p.id!==state.editorId)))await receiveInitialStock(product,variant,data);
  if(publish){
   // Unpublished items remain invisible until the actual online transfer completes.
   await publication(product,true);
   if(!$("ownerStock").disabled)await setOnlineQuantity({...product,product_variants:[variant]},data.stock);
  }else if(published(previous||{})){
   await unpublish(previous);
  }else if(!previous&&canPublish())await publication(product,false);
  await refresh();
  const saved=state.products.find(p=>p.id===product.id);
  if(publish){
   const available=onlineStock(saved||{product_variants:[variant]});
   if(available===0)message("Published, but no online stock was allocated. It will appear once stock is transferred.",true);
   else message("Published successfully. This product is now on the website.");
   toast(available>0?"Product published to the store.":"Published but out of stock online.",product.product_code);
  }else{
   $("categoryCatalogueFilter").value=data.cat.id;state.categoryLimit=48;show("categories");
   message("Saved for owner approval. The product is not online yet.");
   toast("Product saved under "+data.cat.name+".",product.product_code,true);
  }
  state.gallery=photosOf(saved||{}).map(photo=>({existing:true,id:photo.id,url:safeURL(photo.public_url),path:photo.storage_path}));
  renderGallery();
 }catch(error){
  console.error("Owner save failed",error);
  message("Could not complete: "+friendly(error)+". Check the product list before retrying.",true);
  // Preserve the editor and selected photos for a safe retry.
 }finally{state.busy=false;$("saveDraft").disabled=!canEdit();$("publishNow").disabled=!canPublish();}
}
async function duplicateProduct(p){
 const created=await result(state.client.from("products").insert({category_id:p.category_id,product_name:p.product_name+" (Copy)",type:p.type,selling_price:p.selling_price,description:p.description,gender:p.gender,active:true}).select("id,product_code").single());
 for(const v of variantsOf(p))await result(state.client.from("product_variants").insert({product_id:created.id,color:v.color,size:v.size,length_cm:v.length_cm,stock_quantity:0,active:true}));
 for(const photo of photosOf(p))await result(state.client.from("product_images").insert({product_id:created.id,storage_path:photo.storage_path,public_url:photo.public_url,alt_text:p.product_name,is_primary:photo.is_primary,sort_order:photo.sort_order}));
 if(canPublish())await publication(created,false);
 toast("Duplicated as a draft. Stock was not copied.");
}
function renderCategoryCatalogue(){
 const host=$("categoryCatalogueList");host.replaceChildren();
 const categoryFilter=$("categoryCatalogueFilter").value;
 const search=$("categoryCatalogueSearch").value.toLowerCase().trim();
 const filteredProducts=state.products.filter(p=>
  (categoryFilter==="all"||p.category_id===categoryFilter)&&
  (!search||(p.product_name+" "+p.product_code).toLowerCase().includes(search)));
 filteredProducts.sort((a,b)=>{
  const aCat=categoryById(a.category_id),bCat=categoryById(b.category_id);
  return Number(aCat?.storefront_order||9999)-Number(bCat?.storefront_order||9999)
   ||String(aCat?.name||"Other").localeCompare(String(bCat?.name||"Other"))
   ||String(a.product_name).localeCompare(String(b.product_name));
 });
 const visible=filteredProducts.slice(0,state.categoryLimit);
 $("categoryLoadMore").hidden=visible.length===filteredProducts.length;
 if(!visible.length){
  const empty=document.createElement("p");empty.className="empty-list";
  empty.textContent="No products in this category yet. Add one using Quick Add.";
  host.append(empty);return;
 }
 let lastCategoryId=null,group=null;
 for(const product of visible){
  if(product.category_id!==lastCategoryId||group===null){
   lastCategoryId=product.category_id;
   const category=categoryById(product.category_id);
   const container=document.createElement("section");container.className="category-product-group";
   const heading=document.createElement("h3");heading.textContent=category?.name||"Uncategorized";
   const count=document.createElement("small");count.textContent=" · "+filteredProducts.filter(p=>p.category_id===product.category_id).length+" products";
   heading.append(count);container.append(heading);host.append(container);group=container;
  }
  const card=document.createElement("div");card.className="category-product-row";
  const imgSrc=safeURL(photosOf(product)[0]?.public_url);
  const image=document.createElement("div");image.className="category-product-cover";
  if(imgSrc){const img=document.createElement("img");img.src=imgSrc;img.alt="";img.loading="lazy";image.append(img);}
  else image.textContent="No photo";
  const info=document.createElement("div");info.className="category-product-info";
  const title=document.createElement("strong");title.textContent=product.product_name;
  const meta=document.createElement("small");meta.textContent=product.product_code+" · "+money(product.selling_price);
  const status=document.createElement("span");status.className="status "+(visibleOnStorefront(product)?"published":product.archived_at?"archived":"draft");
  status.textContent=product.archived_at?"Archived":visibleOnStorefront(product)?"Visible online":published(product)?"Published · needs online stock":"Not online";
  const help=document.createElement("small");help.className="category-product-help";
  if(!photosOf(product).length)help.textContent="Add a photo before publishing.";
  else if(published(product)&&!visibleOnStorefront(product))help.textContent="Online stock required to appear on the store.";
  else if(!published(product))help.textContent="Saved in catalogue · not displayed to customers.";
  info.append(title,meta,status,help);
  const actions=document.createElement("div");actions.className="category-product-actions";
  if(canPublish()){
   const button=document.createElement("button");button.type="button";
   const online=visibleOnStorefront(product);
   button.textContent=online?"Hide Online":"Show Online";button.className=online?"secondary":"primary";
   button.disabled=!!product.archived_at||!product.active;
   button.setAttribute("aria-label",button.textContent+" for "+product.product_name);
   button.onclick=()=>safeAction(async()=>{
    if(online){
     await mutate(()=>unpublish(product),"publish");
     await refresh();toast("Product hidden from online store.");
    }else await prepareShowOnline(product);
   });
   actions.append(button);
  }else{
   const note=document.createElement("small");note.className="owner-approval-label";
   note.textContent=visibleOnStorefront(product)?"Visible online":"Owner controls online visibility";actions.append(note);
  }
  if(canEdit()&&!product.archived_at&&(canPublish()||!published(product))){
   const editButton=document.createElement("button");editButton.type="button";editButton.textContent="Edit";
   editButton.onclick=()=>edit(product.id);actions.append(editButton);
  }
  if(visibleOnStorefront(product)){
   const link=document.createElement("a");link.href="../product.html?sku="+encodeURIComponent(product.product_code);
   link.textContent="View in store";link.target="_blank";link.rel="noopener";actions.append(link);
  }
  card.append(image,info,actions);group.append(card);
 }
}
function renderCategories(){
 const host=$("categoryList");host.replaceChildren();
 state.categories.forEach((cat,index)=>{
  const row=document.createElement("div");row.className="category-row";
  const name=document.createElement("strong");name.textContent=cat.name;
  const count=state.products.filter(p=>p.category_id===cat.id).length;
  const detail=document.createElement("small");detail.textContent=count+" products";
  const add=(text,disabled,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=text;b.disabled=disabled;b.onclick=()=>safeAction(fn);row.append(b);};
  row.append(name,detail);
  add("↑",!canPublish()||index===0,()=>moveCategory(index,-1));
  add("↓",!canPublish()||index===state.categories.length-1,()=>moveCategory(index,1));
  add("Rename",!canPublish(),async()=>{const changed=prompt("New category name",cat.name)?.trim();if(!changed||changed===cat.name)return;await mutate(()=>result(state.client.from("categories").update({name:changed}).eq("id",cat.id)),"publish");await refresh();});
  add("Delete",!canPublish()||count>0,async()=>{if(!confirm("Delete unused category "+cat.name+"?"))return;await mutate(()=>result(state.client.from("categories").delete().eq("id",cat.id)),"publish");await refresh();});
  host.append(row);
 });
}
async function moveCategory(index,delta){
 const a=state.categories[index],b=state.categories[index+delta];if(!a||!b)return;
 await mutate(async()=>{
  const indexA=Number(a.storefront_order),indexB=Number(b.storefront_order);
  if(indexA===indexB){await result(state.client.from("categories").update({storefront_order:indexA-1}).eq("id",a.id));}
  else{
   await result(state.client.from("categories").update({storefront_order:indexB}).eq("id",a.id));
   await result(state.client.from("categories").update({storefront_order:indexA}).eq("id",b.id));
  }
 },"publish");
 await refresh();
}
async function addCategory(name){
 if(!name||name.length>70)throw new Error("Enter a category name up to 70 characters.");
 const prefix="RG"+name.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3)+String(Math.floor(Math.random()*900)+100);
 const created=await mutate(()=>result(state.client.from("categories").insert({name,code_prefix:prefix,has_color:false,has_size:false,has_length:false,has_thickness:false,has_gold_amount:false,active:true,storefront_order:(Math.max(0,...state.categories.map(c=>Number(c.storefront_order)||0))+10),show_in_storefront:true}).select("id").single()),"publish");
 await refresh();$("ownerCategory").value=created.id;renderExtras();return created;
}
async function applyBulk(){
 const ids=[...state.selected],action=$("bulkAction").value;
 if(!ids.length||!action){toast("Select products and an action first.");return;}
 let target=null;
 if(action==="category"){
  const name=prompt("Enter the new category name (exactly as listed):");
  target=state.categories.find(c=>c.name.toLowerCase()===String(name||"").trim().toLowerCase());
  if(!target){toast("Category not found.");return;}
 }
 if(!confirm("Apply "+action+" to "+ids.length+" products?"))return;
 await safeAction(async()=>{
  let completed=0,errors=[];
  for(const idValue of ids){
   const p=state.products.find(x=>x.id===idValue);
   if(!p)continue;
   try{
    await mutate(async()=>{
     if(action==="publish")await publishExisting(p);
     else if(action==="unpublish")await unpublish(p);
     else if(action==="category")await result(state.client.from("products").update({category_id:target.id}).eq("id",p.id));
    },"publish");
    completed++;
   }catch(error){errors.push(p.product_code+": "+friendly(error));}
  }
  state.selected.clear();await refresh();
  toast(completed+" updated."+ (errors.length?" "+errors.length+" failed: "+errors.slice(0,2).join("; "):""));
 });
}
async function init(){
 const cfg=window.RAINBOW_SUPABASE_CONFIG;
 if(!cfg?.supabaseUrl||!cfg?.supabasePublishableKey||!window.supabase?.createClient)throw new Error("Supabase login is not configured. Contact your site administrator.");
 state.client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
 try{await verifyOwner();}catch(error){
  if(/Please sign in/i.test(error.message)){location.replace("login.html?next=owner.html");return;}
  throw error;
 }
 await refresh();
 $("startup").hidden=true;$("ownerApp").hidden=false;
 applyRoleUI();
 document.querySelectorAll("[data-screen]").forEach(button=>button.addEventListener("click",()=>{if(button.dataset.screen==="editor"&&state.screen!=="editor")resetEditor($("ownerCategory").value);show(button.dataset.screen);}));
 $("ownerLogout").onclick=async()=>{await state.client.auth.signOut();location.replace("login.html");};
 $("menuToggle").onclick=()=>{const open=$("ownerMenu").classList.toggle("is-open");$("drawerBackdrop").hidden=!open;$("menuToggle").setAttribute("aria-expanded",String(open));};
 $("drawerBackdrop").onclick=closeMenu;
 $("ownerSearch").oninput=()=>{state.limit=24;renderProducts();};
 $("ownerFilter").onchange=()=>{state.limit=24;state.selected.clear();renderProducts();};
 $("categoryCatalogueFilter").onchange=()=>{state.categoryLimit=48;renderCategoryCatalogue();};
 $("categoryCatalogueSearch").oninput=()=>{state.categoryLimit=48;renderCategoryCatalogue();};
 $("categoryLoadMore").onclick=()=>{state.categoryLimit+=48;renderCategoryCatalogue();};
 $("loadMore").onclick=()=>{state.limit+=24;renderProducts();};
 $("selectAll").onchange=event=>{filtered().slice(0,state.limit).forEach(p=>{if(event.target.checked)state.selected.add(p.id);else state.selected.delete(p.id);});renderProducts();};
 $("bulkApply").onclick=applyBulk;
 $("ownerCategory").onchange=renderExtras;
 $("clearEditor").onclick=()=>resetEditor();
 $("productPhotos").onchange=event=>acceptPhotos(event.target.files);
 const drop=$("dropZone");
 drop.ondragover=event=>{event.preventDefault();drop.classList.add("dragging");};
 drop.ondragleave=()=>drop.classList.remove("dragging");
 drop.ondrop=event=>{event.preventDefault();drop.classList.remove("dragging");acceptPhotos(event.dataTransfer.files);};
 $("ownerProductForm").onsubmit=event=>{event.preventDefault();saveProduct(event.submitter?.dataset.save||"draft");};
 $("categoryForm").onsubmit=event=>{event.preventDefault();safeAction(async()=>{const created=await addCategory($("categoryName").value.trim());$("categoryName").value="";toast("Category created.");if(state.screen==="editor")$("ownerCategory").value=created.id;});};
 $("inlineCategory").onclick=()=>{const name=prompt("New category name")?.trim();if(!name)return;safeAction(async()=>{await addCategory(name);toast("Category created and selected.");});};
 $("onlineVisibilityCancel").onclick=()=>{$("onlineVisibilityDialog").close();state.visibilityProductId=null;};
 $("onlineVisibilityForm").onsubmit=event=>{
  event.preventDefault();
  if(state.busy)return;
  $("onlineVisibilityFeedback").textContent="";
  safeAction(async()=>{
   const button=$("onlineVisibilityConfirm");button.disabled=true;
   try{await confirmOnlineVisibility();}
   catch(error){$("onlineVisibilityFeedback").textContent=friendly(error);throw error;}
   finally{button.disabled=false;}
  });
 };

 resetEditor();show("editor");
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>init().catch(fatal),{once:true});
else init().catch(fatal);
function applyRoleUI(){
 const editor=canEdit(),owner=canPublish();
 $("roleAccessNote").textContent=owner?"Owner account: save drafts or publish with online stock."
  :editor?"Staff: add a photo, name, category and price. Save for the owner to publish."
  :"Staff product access is unavailable.";
 $("ownerBulkBar").hidden=!owner;
 $("categoryForm").hidden=!owner;
 $("inlineCategory").hidden=!owner;
 $("saveDraft").disabled=!editor;
 $("saveDraft").textContent=owner?"Save as draft":"Save product for approval";
 $("saveDraft").classList.toggle("primary",!owner);
 $("saveDraft").classList.toggle("secondary",owner);
 $("saveDraft").style.gridColumn=owner?"auto":"1/-1";
 $("publishNow").disabled=!owner;
 $("publishNow").title=owner?"Publish to the online store":"Only the owner can publish products.";
 $("ownerName").disabled=!editor;$("ownerCategory").disabled=!editor;
 $("ownerDescription").disabled=!editor;$("ownerPrice").disabled=!editor;
 $("ownerStock").disabled=!editor;$("ownerSource").disabled=!editor;
 $("ownerSku").disabled=!editor;$("productPhotos").disabled=!editor;
 $("ownerStockConfirm").disabled=!editor;
 document.querySelectorAll("[data-screen='editor']").forEach(button=>button.hidden=!editor);
 document.querySelectorAll("[data-admin-only]").forEach(node=>node.hidden=!owner);
 document.querySelectorAll("[data-non-admin]").forEach(node=>node.hidden=owner);
 if(!owner){
  $("ownerStockLabel").firstChild.textContent="Shop opening stock (optional) ";
  $("ownerStockHint").textContent="New products stay as drafts. Stock goes to your assigned shop; the owner later allocates it online.";
 }
}
function fatal(error){console.error(error);$("startup").textContent="Staff catalogue unavailable: "+friendly(error);}
})();