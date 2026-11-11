import {OfflineVault} from "./offline-pos-core.mjs";

const get=id=>document.getElementById(id);
const button=get("prepareOffline");
if(button){
 const status=get("offlineSetupStatus");
 const message=(text,error=false)=>{
  status.textContent=text;
  status.classList.toggle("error",error);
 };
 button.addEventListener("click",async()=>{
  button.disabled=true;
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
   const passphrase=window.prompt("Enter an offline-device passphrase (at least 10 characters). You will need it to unlock the device offline. Never reuse your shop password.","");
   if(passphrase===null)return;
   if(passphrase.length<10)throw new Error("Use an offline passphrase of at least 10 characters.");
   const exists=await OfflineVault.exists();
   if(!exists){
    const again=window.prompt("Confirm the offline-device passphrase.","");
    if(again!==passphrase)throw new Error("Passphrases did not match; offline billing was not enabled.");
    await OfflineVault.create(passphrase,{
     userId:auth.user.id,locationId:shop.id,locationName:shop.name,catalog
    });
   }else{
    const vault=await OfflineVault.unlock(passphrase);
    const saved=await vault.read();
    if(saved.userId!==auth.user.id||saved.locationId!==shop.id)
     throw new Error("This device already has protected records for another staff account/shop. Do not erase pending sales. Use that account or an approved separate device.");
    await vault.updateCatalog(catalog);
   }
   if(!("serviceWorker" in navigator))throw new Error("Browser offline installation is unavailable. Use a current Chrome or Edge browser.");
   await navigator.serviceWorker.ready;
   if(!(await caches.match(new URL("offline-pos.html",location.href).href)))
    throw new Error("The offline page has not finished installing. Open Offline Billing while online to verify it.");
   message("Offline cash billing prepared and encrypted for "+shop.name+". Open Offline Billing and unlock using your passphrase.");
  }catch(error){message(error?.message||"Could not prepare offline billing.",true);}
  finally{button.disabled=false;}
 });
}
