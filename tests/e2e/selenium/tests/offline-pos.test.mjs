import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Builder,By,until} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../..");
const paths=new Set([
 "/admin/offline-pos.html","/admin/offline-pos.mjs","/admin/offline-pos-core.mjs",
 "/admin/offline-pos-sync.mjs","/admin/service-worker.js","/admin/config.js",
 "/assets/brand/rainbow-logo.png"
]);
const extType=pathname=>pathname.endsWith(".html")?"text/html; charset=utf-8":
 pathname.endsWith(".png")?"image/png":"text/javascript; charset=utf-8";

async function serve(){
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,"http://127.0.0.1").pathname;
  if(!paths.has(pathname)){res.writeHead(404);res.end("Unavailable");return;}
  try{
   res.setHeader("Cache-Control","no-store");
   res.setHeader("Content-Type",extType(pathname));
   res.end(await readFile(path.join(root,pathname)));
  }catch(error){res.writeHead(500);res.end(error.message);}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 let closed=false;
 return {
  base:"http://127.0.0.1:"+server.address().port,
  close:()=>new Promise((resolve,reject)=>{
   if(closed){resolve();return;}
   closed=true;server.close(error=>error?reject(error):resolve());
  })
 };
}

test("offline staff POS loads from service worker cache and persists encrypted provisional sale", {timeout:80000},async()=>{
 const fixture=await serve();
 const options=new chrome.Options().addArguments(
  "--headless=new","--no-sandbox","--disable-dev-shm-usage",
  "--disable-background-networking","--window-size=900,1100"
 );
 let driver;
 try{
  driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  await driver.get(fixture.base+"/admin/offline-pos.html");
  const setup=await driver.executeAsyncScript(async done=>{
   try{
    const {OfflineVault}=await import("/admin/offline-pos-core.mjs");
    await OfflineVault.create("test-device-passphrase-long",{
     userId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
     locationId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
     locationName:"Fixture shop",
     catalog:[{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      active:true,product_code:"RGC/FIX0001",product_name:"Fixture chain",type:"Chain",
      selling_price:1000,
      product_variants:[{id:"ffffffff-ffff-4fff-8fff-ffffffffffff",
       active:true,stock_quantity:3,barcode:"RGC-QR-001",color:"0",size:"0"}]}]
    });
    const registration=await navigator.serviceWorker.register("/admin/service-worker.js",{scope:"/admin/"});
    await navigator.serviceWorker.ready;
    await registration.update();
    done({installed:true});
   }catch(error){done({error:error.message});}
  });
  assert.equal(setup.installed,true,setup.error);
  await driver.navigate().refresh();
  await driver.wait(async()=>driver.executeScript("return Boolean(navigator.serviceWorker.controller)"),12000);
  await driver.executeScript(()=>{
   Object.defineProperty(navigator,"onLine",{get:()=>false,configurable:true});
   window.print=()=>{window.__printRequested=true;};
  });
  await (await driver.findElement(By.id("offlinePassphrase"))).sendKeys("test-device-passphrase-long");
  await (await driver.findElement(By.css("#unlockForm button"))).click();
  await driver.wait(until.elementIsVisible(driver.findElement(By.id("readyApp"))),12000);
  assert.match(await (await driver.findElement(By.id("productList"))).getText(),/Fixture chain/);
  await (await driver.findElement(By.css("[data-add]"))).click();
  await driver.wait(async()=>await (await driver.findElement(By.id("saveOffline"))).isEnabled(),8000);
  await (await driver.findElement(By.id("saveOffline"))).click();
  await driver.wait(async()=>/PENDING SYNC/.test(await driver.findElement(By.id("pendingList")).getText()),12000);
  const stored=await driver.executeAsyncScript(async done=>{
   const req=indexedDB.open("rainbow-staff-pos-offline-v1",1);
   req.onerror=()=>done({error:"Cannot open IndexedDB"});
   req.onsuccess=()=>{
    const tx=req.result.transaction("vault","readonly");
    const get=tx.objectStore("vault").get("staff-v1");
    get.onsuccess=()=>done(get.result);
    get.onerror=()=>done({error:"Cannot read encrypted vault"});
   };
  });
  assert.ok(stored.ciphertext,"Offline record must be encrypted");
  assert.equal(JSON.stringify(stored).includes("Fixture chain"),false);
  assert.equal(JSON.stringify(stored).includes("RGC/FIX0001"),false);
  await fixture.close();
  await driver.get(fixture.base+"/admin/billing.html");
  await driver.wait(async()=>{
   const headings=await driver.findElements(By.css("h1"));
   return headings.length&&/Offline Cash Billing/.test(await headings[0].getText());
  },15000);
  assert.equal(await (await driver.findElement(By.id("unlockPanel"))).isDisplayed(),true);
  await (await driver.findElement(By.id("offlinePassphrase"))).sendKeys("test-device-passphrase-long");
  await (await driver.findElement(By.css("#unlockForm button"))).click();
  await driver.wait(async()=>/PENDING SYNC/.test(await driver.findElement(By.id("pendingList")).getText()),12000);
 }finally{
  if(driver)await driver.quit();
  await fixture.close();
 }
});
