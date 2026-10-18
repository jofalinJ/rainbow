/* Staff-only bulk product and photo operations. No production fixtures or payment writes. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id),api=window.RainbowAdminCatalogue;
 const message=(id,text)=>{if($(id))$(id).textContent=text;};
 let draftRows=[],photoJobs=[],uploadCancelled=false,importCancelled=false,importBusy=false,photoBusy=false,productPreviewEpoch=0,photoPreviewEpoch=0;
 function downloadText(name,text,mime="text/csv;charset=utf-8"){
   const blob=new Blob([text],{type:mime});
   const url=URL.createObjectURL(blob);
   const anchor=document.createElement("a");anchor.href=url;anchor.download=name;
   document.body.append(anchor);anchor.click();anchor.remove();
   setTimeout(()=>URL.revokeObjectURL(url),500);
 }
 async function assertEditor(){
   const profile=await getMyProfile();
   if(!profile.active||!["admin","cashier","inventory_staff"].includes(profile.role))
     throw Error("Only active administrators or staff can manage catalogue imports.");
   await requireSession();
   return bootSupabase();
 }
 async function existingCodes(client,codes){
   const existing=new Set();
   for(let offset=0;offset<codes.length;offset+=50){
     const group=codes.slice(offset,offset+50);
     if(!group.length)continue;
     const {data,error}=await client.from("products").select("product_code").in("product_code",group);
     if(error)throw error;
     for(const row of data||[])existing.add(String(row.product_code).toLowerCase());
   }
   return existing;
 }
 const rowPreview=(rows,max=10)=>rows.slice(0,max).map(r=>
   "Row "+r.number+" | "+r.raw.product_code+" | "+r.raw.product_name+
   (r.issues.length?" | ⚠ "+r.issues.join("; "):" | Valid")).join("\n");
 async function previewCsv(){
   if(importBusy)return;
   const epoch=++productPreviewEpoch;
   const file=$("bulkProductCsv")?.files?.[0];
   draftRows=[];$("bulkProductsStart").disabled=true;$("bulkProductsConfirm").checked=false;
   if(!file)return;
   if(file.size>2*1024*1024){message("bulkPreview","CSV limit is 2 MB. Split this file.");return;}
   try{
     const client=await assertEditor();
     const rows=api.resolveImport(api.parseImport(await file.text()),cats);
     const found=await existingCodes(client,rows.map(r=>r.raw.product_code));
     if(epoch!==productPreviewEpoch)return;
     for(const row of rows)if(found.has(row.raw.product_code.toLowerCase()))row.issues.push("Product code already exists");
     draftRows=rows;
     const invalid=rows.filter(row=>row.issues.length);
     message("bulkPreview",rows.length+" product rows validated; "+invalid.length+" blocked.\n"+
       rowPreview(invalid.length?invalid:rows,12)+(rows.length>12?"\n…":"")+
       "\nAll successful imports are unpublished drafts with zero initial stock.");
     $("bulkProductsStart").disabled=invalid.length>0||rows.length===0;
   }catch(error){message("bulkPreview","Validation failed: "+error.message);}
 }
 async function importDrafts(){
   if(importBusy||!draftRows.length||draftRows.some(row=>row.issues.length)||
      !$("bulkProductsConfirm").checked)return;
   importBusy=true;importCancelled=false;
   const workingRows=draftRows.slice();
   $("bulkProductCsv").disabled=true;
   $("bulkProductsStart").disabled=true;$("bulkProductsCancel").disabled=false;
   let created=0,variantCount=0;
   try{
     const client=await assertEditor();
     for(let i=0;i<workingRows.length;i+=20){
       if(importCancelled)break;
       const rows=workingRows.slice(i,i+20);
       const found=await existingCodes(client,rows.map(r=>r.raw.product_code));
       if(found.size)throw Error("Code conflict detected in batch starting at row "+rows[0].number+
         ". Stop and revalidate; successful earlier rows remain unpublished.");
       const products=rows.map(r=>r.product);
       const {data:newProducts,error}=await client.from("products")
         .insert(products).select("id,product_code");
       if(error)throw error;
       if(!newProducts||newProducts.length!==rows.length)
         throw Error("Product batch insert count mismatch. Check drafts before retrying.");
       created+=newProducts.length;
       const byCode=new Map(newProducts.map(p=>[p.product_code,p.id]));
       const variants=rows.map(r=>({product_id:byCode.get(r.raw.product_code),...r.variant}));
       if(variants.some(v=>!v.product_id))
         throw Error("Could not match imported product identifiers. Inspect drafts.");
       const result=await client.from("product_variants").insert(variants);
       if(result.error)throw Error("Drafts imported, but initial zero-stock variants were not created: "+result.error.message+
         ". Correct the drafts before retrying.");
       variantCount+=variants.length;
       message("bulkProgress","Imported "+created+"/"+workingRows.length+" unpublished drafts and "+
         variantCount+" zero-stock variants. You can stop after this batch.");
     }
     message("bulkProgress",(importCancelled?"Stopped safely. ":"Import completed. ")+
       created+" products and "+variantCount+" variants created. Verify before publishing.");
     // No automatic publication or stock increase.
     await load({reset:true});
     draftRows=[];$("bulkProductCsv").value="";$("bulkProductsConfirm").checked=false;
   }catch(error){
     message("bulkProgress","Import stopped after "+created+" products: "+error.message+
       " No existing product was overwritten. Refresh and re-preview the file.");
     draftRows=[];
   }finally{
     importBusy=false;$("bulkProductCsv").disabled=false;$("bulkProductsCancel").disabled=true;$("bulkProductsStart").disabled=true;
   }
 }
 async function previewPhotos(){
   if(photoBusy)return;
   const epoch=++photoPreviewEpoch;
   photoJobs=[];$("bulkPhotosStart").disabled=true;$("bulkPhotosConfirm").checked=false;
   const files=[...($("bulkPhotoFiles")?.files||[])];
   if(!files.length)return;
   if(files.length>api.IMAGE_MAX){
     message("bulkPhotoPreview","Choose at most "+api.IMAGE_MAX+" images per batch.");return;
   }
   try{
     const client=await assertEditor(),mapped=[],issues=[],codes=new Set(),names=new Set(),hashes=new Set();
     for(const file of files){
       const parsed=api.parsePhotoName(file.name);
       if(!parsed){issues.push(file.name+": filename must be SKU__1.jpg to SKU__5.webp");continue;}
       if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>5*1024*1024||file.size===0){
         issues.push(file.name+": image must be JPEG, PNG or WebP up to 5 MB");continue;
       }
       if(names.has(parsed.code.toLowerCase()+"#"+parsed.position)){
         issues.push(file.name+": duplicate image position in this batch");continue;
       }
       if(window.crypto?.subtle&&file.arrayBuffer){
         const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
         const hash=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
         if(hashes.has(hash)){issues.push(file.name+": identical bytes to another selected photo");continue;}
         hashes.add(hash);
       }
       names.add(parsed.code.toLowerCase()+"#"+parsed.position);mapped.push({...parsed,file});
       codes.add(parsed.code);
     }
     const results=[];
     for(const group of [...codes].reduce((parts,code,index)=>{
       if(index%30===0)parts.push([]);parts.at(-1).push(code);return parts;
     },[])){
       const {data,error}=await client.from("products")
         .select("id,product_code,product_name,product_images(id,sort_order,is_primary,storage_path)")
         .in("product_code",group);
       if(error)throw error;
       results.push(...(data||[]));
     }
     if(epoch!==photoPreviewEpoch)return;
     const lookup=new Map(results.map(p=>[p.product_code,p])),groups=new Map();
     for(const entry of mapped){
       const p=lookup.get(entry.code);
       if(!p){issues.push(entry.filename+": unknown exact product code");continue;}
       if(!groups.has(p.id))groups.set(p.id,[]);
       groups.get(p.id).push({...entry,product:p});
     }
     for(const batch of groups.values()){
       const existing=batch[0].product.product_images||[];
       if(existing.length+batch.length>5){
         issues.push(batch[0].code+": "+existing.length+" existing images + "+batch.length+" new exceed 5");continue;
       }
       const positions=new Set(existing.map(p=>Number(p.sort_order||0)+1));
       for(const entry of batch)if(positions.has(entry.position))
         issues.push(entry.filename+": position already used by an existing photograph");
     }
     photoJobs=[...groups.values()].flat().sort((a,b)=>a.code.localeCompare(b.code)||a.position-b.position);
     message("bulkPhotoPreview",photoJobs.length+" photographs mapped to "+
       groups.size+" products. "+issues.length+" error(s).\n"+
       (issues.length?issues.slice(0,12).join("\n"):photoJobs.slice(0,15).map(e=>e.filename+" → "+e.product.product_code).join("\n"))+
       "\nExisting photographs are never replaced; uploads use optimized WebP thumbnails.");
     if(issues.length)photoJobs=[];else $("bulkPhotosStart").disabled=photoJobs.length===0;
   }catch(error){photoJobs=[];message("bulkPhotoPreview","Could not preview images: "+error.message);}
 }
 async function uploadBatchPhotos(){
   if(photoBusy||!photoJobs.length||!$("bulkPhotosConfirm").checked)return;
   photoBusy=true;uploadCancelled=false;
   const workingJobs=photoJobs.slice();
   $("bulkPhotoFiles").disabled=true;
   $("bulkPhotosStart").disabled=true;$("bulkPhotosCancel").disabled=false;
   let completed=0;
   try{
     await assertEditor();
     for(const job of workingJobs){
       if(uploadCancelled)break;
       const {data,error}=await bootSupabase().from("product_images")
         .select("id,sort_order,is_primary").eq("product_id",job.product.id);
       if(error)throw error;
       if(data.length>=5||data.some(p=>Number(p.sort_order||0)+1===job.position))
         throw Error(job.code+" has changed; re-preview to avoid overwriting photograph positions.");
       await uploadAndSavePhoto(job.file,job.product,{
         alt_text:job.product.product_name+" — image "+job.position,
         is_primary:data.length===0&&job.position===1,sort_order:job.position-1
       });
       completed++;
       message("bulkProgress","Uploaded "+completed+"/"+workingJobs.length+" photographs (originals and thumbnails).");
     }
     message("bulkProgress",(uploadCancelled?"Stopped safely. ":"Photo upload completed. ")+
       completed+" product images uploaded. Existing images were preserved.");
     photoJobs=[];$("bulkPhotoFiles").value="";$("bulkPhotosConfirm").checked=false;
     await load();
   }catch(error){
     message("bulkProgress","Photo upload stopped after "+completed+" images: "+error.message+
       " Re-preview before retrying.");
     photoJobs=[];
   }finally{
     photoBusy=false;$("bulkPhotoFiles").disabled=false;$("bulkPhotosCancel").disabled=true;$("bulkPhotosStart").disabled=true;
   }
 }
 async function exportCatalogueCsv(){
   const button=$("exportCatalogueCsv");button.disabled=true;
   try{
     const client=await assertEditor();
     const columns=["product_code","category","product_name","type","selling_price","gender","length_cm","description","thickness","gold_amount_g","active"];
     const results=[columns];let offset=0;
     // Export is a convenience snapshot; never treat it as a database-consistent backup.
     while(offset<20000){
       const {data,error}=await client.from("products")
         .select("product_code,category_id,product_name,type,selling_price,gender,length_cm,description,thickness,gold_amount_g,active")
         .order("id",{ascending:true}).range(offset,offset+249);
       if(error)throw error;
       if(!data?.length)break;
       for(const p of data){
         results.push([
           p.product_code,
           cats.find(cat=>cat.id===p.category_id)?.name||"",
           p.product_name,p.type,p.selling_price,p.gender,p.length_cm,p.description,
           p.thickness,p.gold_amount_g,p.active
         ]);
       }
       offset+=data.length;
       message("bulkProgress","Exported "+offset+" product records so far…");
       if(data.length<250)break;
     }
     if(offset===20000)throw Error("Export capped at 20,000 products. Narrow the scope for a complete snapshot.");
     downloadText("rainbow-catalogue-"+new Date().toISOString().slice(0,10)+".csv",api.csvString(results));
     message("bulkProgress","Product snapshot exported ("+(results.length-1)+" products). It is not a complete database backup.");
   }catch(error){message("bulkProgress","Export failed: "+error.message);}
   finally{button.disabled=false;}
 }
 async function catalogueHealth(){
   message("catalogueHealth","Checking store catalogue…");
   try{
     const client=await assertEditor(),started=performance.now();
     const results=await Promise.all([
       client.from("products").select("id",{head:true,count:"exact"}),
       client.from("products").select("id",{head:true,count:"exact"}).eq("active",true),
       client.from("product_images").select("id",{head:true,count:"exact"}),
       client.from("product_variants").select("id",{head:true,count:"exact"}).gt("stock_quantity",0).eq("active",true)
     ]);
     for(const result of results)if(result.error)throw result.error;
     const counts=results.map(x=>x.count||0);
     const missingCurrent=items.filter(p=>!(p.product_images||[]).length).length;
     message("catalogueHealth","Products: "+counts[0].toLocaleString("en-IN")+
       " | Published: "+counts[1].toLocaleString("en-IN")+
       " | Image records: "+counts[2].toLocaleString("en-IN")+
       " | In-stock variants: "+counts[3].toLocaleString("en-IN")+
       "\nProducts missing photographs on this admin page: "+missingCurrent+
       " of "+items.length+
       "\nMetadata queries: "+Math.round(performance.now()-started)+" ms"+
       "\nLast product-list response: "+lastListMs+" ms."+
       "\nThese are operational counters, not a traffic monitor or confirmed backup.");
   }catch(error){message("catalogueHealth","Health check unavailable: "+error.message);}
 }
 function init(){
   if(!api||!$("bulkTools"))return;
   $("downloadCsvTemplate").addEventListener("click",()=>downloadText("rainbow-products-template.csv",api.csvString([api.FIELDS])));
   $("exportCatalogueCsv")?.addEventListener("click",exportCatalogueCsv);
   $("bulkProductCsv").addEventListener("change",previewCsv);
   $("bulkProductsStart").addEventListener("click",importDrafts);
   $("bulkProductsCancel").addEventListener("click",()=>{importCancelled=true;message("bulkProgress","Stopping after the current batch…");});
   $("bulkPhotoFiles").addEventListener("change",previewPhotos);
   $("bulkPhotosStart").addEventListener("click",uploadBatchPhotos);
   $("bulkPhotosCancel").addEventListener("click",()=>{uploadCancelled=true;message("bulkProgress","Stopping after the current photograph…");});
   $("refreshCatalogHealth").addEventListener("click",catalogueHealth);
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
 else init();
})();
