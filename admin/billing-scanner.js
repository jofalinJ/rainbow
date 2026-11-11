/* Staff POS scanner: camera QR/1D decoding and USB/Bluetooth keyboard scanners.
 * Scanner input only selects recorded products. Never creates a sale or changes stock. */
(function(){
"use strict";
const byId=id=>document.getElementById(id);
const startButton=byId("startScanner");
if(!startButton)return;
const stopButton=byId("stopScanner");
const panel=byId("scannerPanel");
const video=byId("scannerVideo");
const message=byId("scannerMessage");
const search=byId("productSearch");
let generation=0,active=false,stream=null,readerControls=null,timer=null;
const cameraFormats=["qr_code","code_128","code_39","ean_13","ean_8","upc_a","upc_e","itf","codabar","data_matrix"];

function normalizeCode(value){
 const raw=String(value??"").trim().slice(0,400);
 if(!raw)return "";
 if(/^https?:\/\//i.test(raw)){
  try{
   const url=new URL(raw);
   if(!["rainbowgoldcovering.com","www.rainbowgoldcovering.com"].includes(url.hostname.toLowerCase())||
      url.protocol!=="https:"||!["/product.html","/products/"].some(p=>url.pathname===p||url.pathname.startsWith(p))){
    return ""; // Unknown website QR codes must not change the billing cart.
   }
   return String(url.searchParams.get("sku")||url.searchParams.get("code")||"").trim().slice(0,150);
  }catch{return "";}
 }
 return raw;
}
function locateCode(raw,products){
 const code=normalizeCode(raw).toLowerCase();
 if(!code)return {kind:"invalid"};
 const matches=[];
 for(const p of products||[]){
  if(p.active===false)continue;
  for(const v of p.product_variants||[]){
   if(v.active===false||Number(v.stock_quantity||0)<1)continue;
   const barcode=String(v.barcode||"").trim().toLowerCase();
   const sku=String(p.product_code||"").trim().toLowerCase();
   if(barcode===code||String(v.id||"").toLowerCase()===code||sku===code)matches.push({p,v});
  }
 }
 if(matches.length===1)return {kind:"match",record:matches[0],code};
 if(matches.length>1)return {kind:"multiple",code};
 return {kind:"not-found",code};
}
function setStatus(text,error=false){
 message.textContent=text;
 message.classList.toggle("error",error);
}
function processCode(value){
 const pos=window.RainbowBillingPos;
 if(!pos)return false;
 const decoded=normalizeCode(value);
 if(!decoded){setStatus("This QR code is not a Rainbow product code. Scan a product barcode or enter its code.",true);return false;}
 const found=locateCode(decoded,pos.products());
 if(found.kind==="match"){
  const ok=pos.addVariant(found.record.v.id);
  if(ok){
   pos.search("");
   setStatus("Added "+found.record.p.product_name+" to the current bill.");
  }else setStatus("Product is unavailable or the requested quantity exceeds shop stock.",true);
  return Boolean(ok);
 }
 if(found.kind==="multiple"){
  pos.search(decoded);
  setStatus("More than one variant matches. Choose the correct item from the product list.");
  return true;
 }
 pos.search(decoded);
 setStatus("No available matching item in this billing shop. Check the product code and stock.",true);
 return false;
}
function stopCamera(){
 generation++;
 active=false;
 if(timer!==null){clearTimeout(timer);timer=null;}
 try{readerControls?.stop();}catch{/* Camera may already be closed. */}
 readerControls=null;
 if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
 try{video.pause();}catch{/* No active preview. */}
 video.srcObject=null;
 panel.hidden=true;
 startButton.disabled=false;
}
async function nativeCamera(token){
 if(typeof window.BarcodeDetector!=="function")return false;
 const formats=await window.BarcodeDetector.getSupportedFormats().catch(()=>[]);
 if(!formats.includes("qr_code")||!formats.some(f=>f!=="qr_code"&&cameraFormats.includes(f)))return false;
 const detector=new window.BarcodeDetector({formats:cameraFormats.filter(f=>formats.includes(f))});
 const camera=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"}}});
 if(token!==generation){camera.getTracks().forEach(t=>t.stop());return true;}
 stream=camera;video.srcObject=camera;await video.play();
 const tick=async()=>{
  if(!active||token!==generation)return;
  try{
   if(video.readyState>=2){
    const detected=await detector.detect(video);
    if(token!==generation||!active)return;
    if(detected?.length){
     const value=String(detected[0].rawValue||"");
     stopCamera();processCode(value);return;
    }
   }
  }catch(error){if(active)console.warn("Barcode frame could not be decoded.",error);}
  if(active&&token===generation)timer=setTimeout(tick,170);
 };
 tick();
 return true;
}
async function zxingCamera(token){
 const {BrowserMultiFormatReader}=await import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/+esm");
 if(token!==generation)return;
 const reader=new BrowserMultiFormatReader();
 const controls=await reader.decodeFromConstraints(
  {audio:false,video:{facingMode:{ideal:"environment"}}},video,
  (result,_error,ctrl)=>{
   if(!result||!active||token!==generation)return;
   const value=result.getText();
   if(ctrl)readerControls=ctrl;
   stopCamera();processCode(value);
  }
 );
 if(token!==generation){controls.stop();return;}
 readerControls=controls;
}
async function startCamera(){
 if(active)return;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
  setStatus("Camera scanning needs HTTPS and camera access. You can still use a USB/Bluetooth scanner or type a code.",true);
  return;
 }
 active=true;panel.hidden=false;startButton.disabled=true;
 const token=++generation;
 setStatus("Requesting camera access… Point the camera at a Rainbow product QR code or barcode.");
 try{
  if(!await nativeCamera(token))await zxingCamera(token);
  if(token===generation&&active)setStatus("Camera ready. Hold the code steady inside the picture.");
 }catch(error){
  if(token!==generation)return;
  stopCamera();
  const denied=error?.name==="NotAllowedError"||error?.name==="PermissionDeniedError";
  setStatus(denied?"Camera permission denied. Allow camera access in browser settings or use a handheld scanner.":"Could not start camera. Check camera availability and internet access, or use a handheld scanner.",true);
 }
}
startButton.addEventListener("click",startCamera);
stopButton.addEventListener("click",()=>{stopCamera();setStatus("Camera closed.");search.focus();});
window.addEventListener("pagehide",stopCamera);
document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)stopCamera();});
window.RainbowBillingScanner={normalizeCode,locateCode,processCode,stopCamera};
})();
