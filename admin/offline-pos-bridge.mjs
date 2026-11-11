import {OfflineVault} from "./offline-pos-core.mjs";

// A real form works in browsers and embedded webviews that disable prompt().
const get=id=>document.getElementById(id);
const trigger=get("prepareOffline");
const form=get("offlineSetupForm");
const password=get("offlineDevicePassphrase");
const confirmation=get("offlineConfirmPassphrase");
const confirmationWrap=get("offlineConfirmWrap");
const mode=get("offlineSetupMode");
const submit=get("offlineSetupSubmit");
const cancel=get("offlineSetupCancel");
const status=get("offlineSetupStatus");
let existingVault=false;
let busy=false;

function message(text,error=false){
 status.textContent=text;
 status.classList.toggle("error",error);
}
function closeSetup(){
 form.reset();
 form.hidden=true;
 trigger.setAttribute("aria-expanded","false");
 confirmation.required=false;
 confirmationWrap.hidden=false;
}
async function offlineAssetsReady(){
 if(!("serviceWorker" in navigator)||!("caches" in window)){
  throw new Error("Offline installation is unavailable in this browser. Open the staff site using Chrome or Edge.");
 }
 // Explicit registration means preparation also works when PWA registration is slow.
 // Do not create an encrypted vault until its offline shell is safely cached.
 await navigator.serviceWorker.register("service-worker.js",{scope:"./"});
 const ready=await Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_,reject)=>setTimeout(()=>reject(new Error("Offline installation did not finish. Reload Billing and try again.")),12000))
 ]);
 if(!ready?.active)throw new Error("The offline service worker is not active yet. Reload and retry.");
 if(!(await caches.match(new URL("offline-pos.html",location.href).href))){
  throw new Error("Offline Billing files are not installed yet. Open Offline Billing online, then return and retry.");
 }
}
if(trigger&&form&&password&&confirmation&&status){
 trigger.addEventListener("click",async()=>{
  if(busy)return;
  if(!form.hidden){closeSetup();trigger.focus();return;}
  trigger.disabled=true;
  try{
   existingVault=await OfflineVault.exists();
   confirmationWrap.hidden=existingVault;
   confirmation.required=!existingVault;
   mode.textContent=existingVault
    ?"This device is already prepared. Enter its current offline passphrase to refresh the saved shop products. Pending sales will be preserved."
    :"Create a separate offline-device passphrase to encrypt saved products and cash sales. Confirm it below.";
   password.autocomplete=existingVault?"off":"new-password";
   submit.textContent=existingVault?"Refresh offline products":"Prepare offline billing";
   form.hidden=false;
   trigger.setAttribute("aria-expanded","true");
   message("");
   password.focus();
  }catch(error){message(error?.message||"Could not open offline setup.",true);}
  finally{trigger.disabled=false;}
 });
 cancel.addEventListener("click",()=>{
  if(busy)return;
  closeSetup();
  message("Offline setup cancelled.");
  trigger.focus();
 });
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(busy)return;
  const passphrase=password.value;
  if(passphrase.length<10){
   message("Use an offline passphrase with at least 10 characters.",true);
   password.focus();
   return;
  }
  if(!existingVault&&confirmation.value!==passphrase){
   message("Passphrases do not match. Please enter the same passphrase twice.",true);
   confirmation.focus();
   return;
  }
  busy=true;
  submit.disabled=true;
  cancel.disabled=true;
  trigger.disabled=true;
  message("Checking staff access and preparing offline billing…");
  try{
   if(!navigator.onLine)throw new Error("Connect to the internet to prepare or refresh offline billing.");
   if(!window.RAINBOW_MULTI_SHOP_ENABLED)throw new Error("Multi-shop POS is required for safe offline records.");
   const client=bootSupabase();
   const {data:auth,error:authError}=await client.auth.getUser();
   if(authError||!auth?.user)throw new Error("Sign in online before preparing the device.");
   const {data:profile,error:profileError}=await client.from("staff_profiles")
    .select("role,active").eq("user_id",auth.user.id).maybeSingle();
   if(profileError||!profile?.active||!["admin","cashier"].includes(profile.role))
    throw new Error("Only active owner/cashier accounts can prepare offline billing.");
   const shop=window.RainbowBillingPos?.shop();
   const catalog=window.RainbowBillingPos?.products();
   if(!shop?.id||!catalog?.length)throw new Error("Select a billing shop and load its products first.");
   if(profile.role!=="admin"){
    const {data:assigned,error:assignedError}=await client.from("erp_staff_locations")
     .select("location_id").eq("user_id",auth.user.id).eq("location_id",shop.id).maybeSingle();
    if(assignedError||!assigned)throw new Error("You are not assigned to this shop.");
   }
   const existsNow=await OfflineVault.exists();
   if(existsNow!==existingVault){
    throw new Error("Offline device status changed. Close setup and open it again before continuing.");
   }
   // Confirm offline files exist before creating the encrypted device vault.
   await offlineAssetsReady();
   if(!existsNow){
    await OfflineVault.create(passphrase,{
     userId:auth.user.id,locationId:shop.id,locationName:shop.name,catalog
    });
   }else{
    const vault=await OfflineVault.unlock(passphrase);
    const saved=await vault.read();
    if(saved.userId!==auth.user.id||saved.locationId!==shop.id)
     throw new Error("This device contains protected sales for another staff account or shop. Keep those records; use the original account/device.");
    await vault.updateCatalog(catalog);
   }
   closeSetup();
   message("Offline cash billing is ready for "+shop.name+". Open Offline Billing and unlock with your offline passphrase.");
  }catch(error){
   message(error?.message||"Could not prepare offline billing.",true);
  }finally{
   // Do not leave a passphrase visible or stored in a DOM field after an attempt.
   password.value="";
   confirmation.value="";
   busy=false;
   submit.disabled=false;
   cancel.disabled=false;
   trigger.disabled=false;
  }
 });
}
