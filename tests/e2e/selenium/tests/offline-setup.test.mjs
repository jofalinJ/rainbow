import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Builder,By,until} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../..");
const files=new Set([
 "/admin/offline-pos-bridge.mjs","/admin/offline-pos-core.mjs",
 "/admin/offline.html","/admin/offline-pos.html","/admin/offline-pos.mjs",
 "/admin/offline-pos-sync.mjs","/admin/service-worker.js","/admin/config.js",
 "/assets/brand/rainbow-logo.png"
]);
const userId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const locationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const variantId="ffffffff-ffff-4fff-8fff-ffffffffffff";
const passphrase="safe-offline-device-passphrase";

async function serve(){
 const billing=await readFile(path.join(root,"admin/billing.html"),"utf8");
 const start=billing.indexOf('<div class="offline-pos-setup">');
 const end=billing.indexOf('<div class="panelhead">',start);
 assert.ok(start>=0&&end>start,"Offline form must be extracted from actual Billing markup");
 const markup=billing.slice(start,end);
 const fixture=`<!doctype html><html lang="en"><head><meta charset="utf-8">
 <title>Offline POS setup fixture</title></head><body>
 ${markup}
 <script>
 window.RAINBOW_MULTI_SHOP_ENABLED=true;
 window.__fixtureRole="cashier";
 window.RainbowBillingPos={
   shop:()=>({id:"${locationId}",name:"Fixture shop"}),
   products:()=>[{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    product_code:"RGC/FIX0001",product_name:"Fixture chain",
    type:"Chain",selling_price:1000,active:true,
    product_variants:[{id:"${variantId}",stock_quantity:3,
      active:true,barcode:"TEST-QR",color:"0",size:"0"}]}]
 };
 window.bootSupabase=()=>({
   auth:{getUser:async()=>({data:{user:{id:"${userId}"}},error:null})},
   from:name=>({
     select(){return this;},
     eq(){return this;},
     maybeSingle:async()=>({
       data:name==="staff_profiles"?{role:window.__fixtureRole,active:true}:null,
       error:null
     })
   })
 });
 </script>
 <script type="module" src="/admin/offline-pos-bridge.mjs"></script>
 </body></html>`;
 const server=createServer(async(req,res)=>{
  const name=new URL(req.url,"http://localhost").pathname;
  if(name==="/admin/offline-setup-fixture.html"){
   res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
   res.end(fixture);return;
  }
  if(!files.has(name)){res.writeHead(404);res.end("Unavailable");return;}
  try{
   const type=name.endsWith(".html")?"text/html; charset=utf-8":
    name.endsWith(".png")?"image/png":"text/javascript; charset=utf-8";
   res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});
   res.end(await readFile(path.join(root,name)));
  }catch(error){res.writeHead(500);res.end(error.message);}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 return {url:"http://127.0.0.1:"+server.address().port+"/admin/offline-setup-fixture.html",
  close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}

test("inline offline passphrase setup and refresh work when prompt() is blocked",{
 timeout:80000
},async()=>{
 const fixture=await serve();
 const options=new chrome.Options().addArguments("--headless=new","--no-sandbox",
  "--disable-dev-shm-usage","--disable-background-networking","--window-size=900,1000");
 let driver;
 try{
  driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  await driver.get(fixture.url);
  await driver.executeScript(()=>{
   // Embedded browser behavior that originally caused the production failure.
   globalThis.prompt=()=>{throw new Error("prompt() is not supported");};
  });
  const trigger=await driver.findElement(By.id("prepareOffline"));
  await driver.wait(async()=>/Only the admin/i.test(await driver.findElement(By.id("offlineSetupPermissionHint")).getText()),8000);
  assert.equal(await trigger.isDisplayed(),false,"Staff must not see admin provisioning controls");
  // Even a forced click cannot bypass the live role check.
  await driver.executeScript(()=>{
    document.getElementById("prepareOffline").hidden=false;
    document.getElementById("prepareOffline").click();
  });
  await driver.wait(async()=>/Only an active admin/i.test(await driver.findElement(By.id("offlineSetupStatus")).getText()),8000);
  assert.equal(await (await driver.findElement(By.id("offlineSetupForm"))).isDisplayed(),false);
  await driver.executeScript(()=>{
    globalThis.__fixtureRole="admin";
    globalThis.dispatchEvent(new Event("focus"));
  });
  await driver.wait(until.elementIsVisible(trigger),8000);
  await trigger.click();
  const form=await driver.findElement(By.id("offlineSetupForm"));
  await driver.wait(until.elementIsVisible(form),8000);
  assert.equal(await (await driver.findElement(By.id("offlineConfirmWrap"))).isDisplayed(),true);
  await (await driver.findElement(By.id("offlineDevicePassphrase"))).sendKeys(passphrase);
  await (await driver.findElement(By.id("offlineConfirmPassphrase"))).sendKeys("not-matching-password");
  await (await driver.findElement(By.id("offlineSetupSubmit"))).click();
  await driver.wait(async()=>/do not match/i.test(await driver.findElement(By.id("offlineSetupStatus")).getText()),8000);
  const wrong=await driver.executeAsyncScript(async done=>{
   try{const {OfflineVault}=await import("/admin/offline-pos-core.mjs");
    done(await OfflineVault.exists());
   }catch(error){done({error:error.message});}
  });
  assert.equal(wrong,false,"Mismatched passphrases must never create an offline vault");
  await (await driver.findElement(By.id("offlineDevicePassphrase"))).clear();
  await (await driver.findElement(By.id("offlineDevicePassphrase"))).sendKeys(passphrase);
  await (await driver.findElement(By.id("offlineConfirmPassphrase"))).clear();
  await (await driver.findElement(By.id("offlineConfirmPassphrase"))).sendKeys(passphrase);
  await (await driver.findElement(By.id("offlineSetupSubmit"))).click();
  await driver.wait(async()=>/billing is ready/i.test(await driver.findElement(By.id("offlineSetupStatus")).getText()),16000);
  assert.equal(await form.isDisplayed(),false,"Setup fields must close after preparation");
  assert.equal(await (await driver.findElement(By.id("offlineDevicePassphrase"))).getAttribute("value"),"",
   "Passphrase must not remain in a DOM field");
  const queued=await driver.executeAsyncScript(async done=>{
   try{
    const {OfflineVault}=await import("/admin/offline-pos-core.mjs");
    const vault=await OfflineVault.unlock("safe-offline-device-passphrase");
    await vault.queue([{variant_id:"ffffffff-ffff-4fff-8fff-ffffffffffff",quantity:1}],
     {name:"Fixture buyer"});
    done((await vault.read()).pending.length);
   }catch(error){done({error:error.message});}
  });
  assert.equal(queued,1,"A cash record should survive later offline product refreshes");
  await (await driver.findElement(By.id("prepareOffline"))).click();
  await driver.wait(until.elementIsVisible(form),8000);
  assert.equal(await (await driver.findElement(By.id("offlineConfirmWrap"))).isDisplayed(),false,
   "Existing vault refresh should request only the current passphrase");
  await (await driver.findElement(By.id("offlineDevicePassphrase"))).sendKeys(passphrase);
  await (await driver.findElement(By.id("offlineSetupSubmit"))).click();
  await driver.wait(async()=>/billing is ready/i.test(await driver.findElement(By.id("offlineSetupStatus")).getText()),16000);
  const saved=await driver.executeAsyncScript(async done=>{
   try{
    const {OfflineVault}=await import("/admin/offline-pos-core.mjs");
    const vault=await OfflineVault.unlock("safe-offline-device-passphrase");
    const state=await vault.read();
    done({pending:state.pending.length,products:state.catalog.length});
   }catch(error){done({error:error.message});}
  });
  assert.deepEqual(saved,{pending:1,products:1});
  const owned=await driver.executeAsyncScript(async done=>{
   try{
    const {OfflineVault}=await import("/admin/offline-pos-core.mjs");
    const vault=await OfflineVault.unlock("safe-offline-device-passphrase");
    const record=(await vault.read()).pending[0];
    await vault.claimSyncActor(record.id,"cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const pinned=(await vault.read()).pending[0];
    let blocked=false;
    try{await vault.claimSyncActor(record.id,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");}
    catch{blocked=true;}
    done({actor:pinned.syncActorId,blocked,operator:pinned.operator||""});
   }catch(error){done({error:error.message});}
  });
  assert.deepEqual(owned,{actor:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",blocked:true,operator:""});
 }finally{
  if(driver)await driver.quit();
  await fixture.close();
 }
});
