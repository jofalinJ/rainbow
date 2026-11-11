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
const permissionHint=get("offlineSetupPermissionHint");
let existingVault=false;
let busy=false;

// Provisioning is online-only and restricted to an active admin role.
// The standalone offline screen never asks for an online login: staff unlock
// its locally encrypted, already-provisioned shop with the shared device code.
async function verifyProvisioningAdmin(){
 if(!navigator.onLine)throw new Error("An admin must be online to prepare this device.");
 const client=bootSupabase();
 const {data:auth,error:authError}=await client.auth.getUser();
 if(authError||!auth?.user)throw new Error("An admin must sign in online to prepare this device.");
 const {data:profile,error:profileError}=await client.from("staff_profiles")
  .select("role,active").eq("user_id",auth.user.id).maybeSingle();
 if(profileError)throw new Error("Could not verify admin permissions. Reconnect and try again.");
 if(!profile?.active||profile.role!=="admin")
  throw new Error("Only an active admin can create or refresh the offline shop passcode.");
 return {client,user:auth.user};
}
async function showProvisioningAccess(){
 trigger.hidden=true;
 try{
  await verifyProvisioningAdmin();
  trigger.hidden=false;
  if(permissionHint)permissionHint.textContent="Admin setup available. Staff use the shared passcode to unlock this prepared device offline.";
 }catch{
  if(permissionHint)permissionHint.textContent="Only the admin can prepare this device. Staff can still open offline billing with the admin-created passcode.";
 }
}

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
 const registration=await navigator.serviceWorker.register("service-worker.js",{scope:"./"});
 await registration.update();
 const ready=await Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_,reject)=>setTimeout(()=>reject(new Error("Offline installation did not finish. Reload Billing and try again.")),12000))
 ]);
 if(!ready?.active)throw new Error("The offline service worker is not active yet. Reload and retry.");
 // The updated service worker is required on previously installed tablets;
 // an old cache must not make the admin believe the new offline code is ready.
 const updatedCache=await caches.open("rainbow-staff-offline-pos-v4");
 const offlinePage=new URL("offline-pos.html",location.href).href;
 let installed=false;
 for(let attempt=0;attempt<36;attempt++){
  if(await updatedCache.match(offlinePage)){installed=true;break;}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!installed)
  throw new Error("The latest offline billing files are still installing. Reload Billing while online and try again.");
}
if(trigger&&form&&password&&confirmation&&status){
 // Hidden until the live staff profile confirms an admin session.
 showProvisioningAccess();
 trigger.addEventListener("click",async()=>{
  if(busy)return;
  if(!form.hidden){closeSetup();trigger.focus();return;}
  trigger.disabled=true;
  try{
   await verifyProvisioningAdmin();
   existingVault=await OfflineVault.exists();
   confirmationWrap.hidden=existingVault;
   confirmation.required=!existingVault;
   mode.textContent=existingVault
    ?"This device already has an admin-created shop passcode. Enter the same code to refresh products; pending sales will be preserved."
    :"Admin: create a shared offline shop passcode (at least 10 characters). Staff can unlock this prepared device with that code even without internet.";
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
   const {user}=await verifyProvisioningAdmin();
   if(!window.RAINBOW_MULTI_SHOP_ENABLED)throw new Error("Multi-shop POS is required for safe offline records.");
   const shop=window.RainbowBillingPos?.shop();
   const catalog=window.RainbowBillingPos?.products();
   if(!shop?.id||!catalog?.length)throw new Error("Select a billing shop and load its products first.");
   const existsNow=await OfflineVault.exists();
   if(existsNow!==existingVault){
    throw new Error("Offline device status changed. Close setup and open it again before continuing.");
   }
   // Confirm offline files exist before creating the encrypted device vault.
   await offlineAssetsReady();
   if(!existsNow){
    await OfflineVault.create(passphrase,{
     userId:user.id,locationId:shop.id,locationName:shop.name,catalog
    });
   }else{
    const vault=await OfflineVault.unlock(passphrase);
    const saved=await vault.read();
    if(saved.locationId!==shop.id)
     throw new Error("This device contains protected sales for a different shop. Keep those records; use that shop's designated device.");
    await vault.updateCatalog(catalog);
   }
   closeSetup();
   message("Offline cash billing is ready for "+shop.name+". Give authorized staff the shared device passcode; they can open Offline Billing without internet.");
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
 // If this page stays open while staff accounts change, recheck before revealing
 // setup rather than trusting a stale role result.
 window.addEventListener("focus",()=>{if(!busy)showProvisioningAccess();});
}
