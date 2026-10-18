/* Compress jewellery uploads on the staff device. No server-side image transformations required. */
(function(root){
 "use strict";
 const MAX_SOURCE_BYTES=5*1024*1024;
 function dimensions(width,height,maxEdge){
   const ratio=Math.min(1,maxEdge/Math.max(1,width,height));
   return {width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))};
 }
 async function webpFromBitmap(bitmap,maxEdge,quality){
   const size=dimensions(bitmap.width,bitmap.height,maxEdge);
   const canvas=document.createElement("canvas");canvas.width=size.width;canvas.height=size.height;
   const ctx=canvas.getContext("2d",{alpha:false});if(!ctx)throw new Error("Image processing unavailable.");
   ctx.fillStyle="#fff";ctx.fillRect(0,0,size.width,size.height);
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
   ctx.drawImage(bitmap,0,0,size.width,size.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
   if(!blob||blob.type!=="image/webp")throw new Error("WebP encoding is unavailable.");
   return blob;
 }
 async function prepare(file){
   if(!file?.type?.startsWith("image/")||file.size>MAX_SOURCE_BYTES)throw new Error("Choose an image under 5 MB.");
   if(!root.createImageBitmap||!document.createElement("canvas").toBlob)return null;
   let bitmap;
   try{
     bitmap=await root.createImageBitmap(file);
     if(bitmap.width*bitmap.height>50000000)throw new Error("Image resolution exceeds 50 megapixels.");
     const [main,thumb]=await Promise.all([
       webpFromBitmap(bitmap,1600,.85),
       webpFromBitmap(bitmap,480,.76)
     ]);
     return {main,thumb};
   }catch(error){
     // Unsafe/corrupt inputs should fail rather than silently publishing the wrong photo.
     throw new Error("Could not prepare photo: "+error.message);
   }finally{bitmap?.close?.();}
 }
 root.RainbowImagePrep={prepare,dimensions,MAX_SOURCE_BYTES};
})(window);
