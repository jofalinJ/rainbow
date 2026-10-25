// Zero-additional-service-cost browser smoke: all Supabase/payment APIs mocked.
// This file refuses anything except the loopback static server and sends no money.
import {test} from "node:test";
import assert from "node:assert/strict";
import {Builder,By,until} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const base=(process.env.E2E_BASE_URL||"http://127.0.0.1:4173").replace(/\/$/,"");
if(process.env.E2E_ISOLATED_ENV!=="true" ||
  !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Refusing external website or non-isolated browser E2E.");

const fixture=String.raw`
(() => {
  if(!["127.0.0.1","localhost"].includes(location.hostname)) return;
  const ids={admin:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",staff:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"};
  const get=()=>{try{return JSON.parse(sessionStorage.getItem("__isolated_auth")||"null");}catch{return null;}};
  const product={id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",product_code:"FAKE-001",
    product_name:"Isolated Necklace",type:"Necklace",selling_price:1000,
    description:"Only a test item",active:true,product_images:[]};
  const variant={id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    product_id:product.id,stock_quantity:5,active:true,color:"Gold",size:"Standard"};
  const makeQuery=(table)=>({
    select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
    range(){return this;},or(){return this;},ilike(){return this;},gte(){return this;},
    in(){return Promise.resolve({data:table==="products"?[product]:
      table==="product_variants"?[variant]:[],error:null});},
    maybeSingle:async()=>({data:table==="staff_profiles" && get()
      ?{role:get().role,active:true,full_name:get().role==="admin"?"Test Admin":"Test Staff",username:get().role}:null,error:null}),
    then(resolve,reject){return Promise.resolve({data:[],count:0,error:null}).then(resolve,reject);}
  });
  const sdk={
    createClient(_url,_key,options={}){
      window.__mockAuthOptions=options.auth||{};
      return {
        auth:{
          signInWithPassword:async({email})=>{
            const role=String(email).startsWith("admin@")?"admin":"cashier";
            sessionStorage.setItem("__isolated_auth",JSON.stringify({role,id:ids[role==="admin"?"admin":"staff"]}));
            return {data:{},error:null};
          },
          getUser:async()=>({data:{user:get()?{id:get().id}:null},error:null}),
          getSession:async()=>({data:{session:get()?{access_token:"MOCK_NOT_REAL"}:null},error:null}),
          signOut:async()=>{sessionStorage.removeItem("__isolated_auth");return {error:null};}
        },
        from:makeQuery,
        rpc:async(name)=>({data:name==="get_admin_operational_metrics"
          ?{products:1,orders:0,today_orders:0,today_sales:0,total_sales:0,low_stock:0}
          :{rows:[],total:0,stock:0,low:0,out:0},error:null}),
        channel:()=>({on(){return this;},subscribe(){return this;}}),
        removeChannel:async()=>{}
      };
    }
  };
  Object.defineProperty(window,"supabase",{configurable:false,enumerable:true,
    get(){return sdk;},set(){}});
  const nativeFetch=window.fetch.bind(window);
  window.__isolatedExternalRequests=[];
  window.fetch=async(input,opts)=>{
    const url=new URL(typeof input==="string"?input:input.url,location.href);
    if(url.origin!==location.origin){
      window.__isolatedExternalRequests.push(url.pathname);
      return new Response(JSON.stringify({error:"ISOLATED_API_UNAVAILABLE",enabled:false,mode:"test"}),
        {status:503,headers:{"content-type":"application/json"}});
    }
    return nativeFetch(input,opts);
  };
})();
`;

async function browser(){
  const options=new chrome.Options().addArguments("--headless=new","--no-sandbox",
    "--disable-dev-shm-usage","--disable-background-networking","--window-size=1280,900");
  const driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  // No requests to real Supabase, live payment Worker or CDN are possible.
  await driver.sendDevToolsCommand("Network.enable",{});
  await driver.sendDevToolsCommand("Network.setBlockedURLs",{
    urls:["*://*.supabase.co/*","*://*.workers.dev/*","*://cdn.jsdelivr.net/*"]
  });
  await driver.sendDevToolsCommand("Page.addScriptToEvaluateOnNewDocument",{source:fixture});
  return driver;
}

async function login(driver,username){
  await driver.get(base+"/admin/login.html");
  await driver.findElement(By.css("#username")).sendKeys(username);
  await driver.findElement(By.css("#password")).sendKeys("NOT_A_REAL_PASSWORD");
  await driver.findElement(By.css("[data-testid='login-submit']")).click();
  await driver.wait(until.urlContains("/admin/index.html"),10000);
}

test("admin and staff sessions remain isolated in the same browser tabs",async()=>{
  const driver=await browser();
  try{
    await login(driver,"admin");
    const adminTab=await driver.getWindowHandle();
    await driver.wait(async()=>{
      const nav=await driver.findElement(By.css("aside nav")).getText();
      return nav.includes("Staff");
    },12000);
    assert.equal(await driver.executeScript(
      "return window.__mockAuthOptions.storage===window.sessionStorage"),true);
    assert.equal(await driver.executeScript(
      "return window.__mockAuthOptions.storageKey"),"rainbow-staff-session");
    await driver.switchTo().newWindow("tab");
    await login(driver,"cashier");
    await driver.get(base+"/admin/billing.html");
    await driver.wait(async()=>{
      const nav=await driver.findElement(By.css("aside nav")).getText();
      return nav.includes("Billing");
    },10000);
    const staffNav=await driver.findElement(By.css("aside nav")).getText();
    assert.equal(staffNav.includes("Staff"),false,"Cashier must not see staff management");
    await driver.switchTo().window(adminTab);
    await driver.navigate().refresh();
    await driver.wait(async()=>{
      const nav=await driver.findElement(By.css("aside nav")).getText();
      return nav.includes("Staff");
    },10000);
    assert.equal(await driver.executeScript(
      "return JSON.parse(sessionStorage.getItem('__isolated_auth')).role"),"admin");
  }finally{await driver.quit();}
});

test("customer checkout never exposes a real-money UPI QR when server cannot prepare",async()=>{
  const driver=await browser();
  try{
    await driver.get(base+"/admin/login.html");
    await driver.executeScript(`
      localStorage.setItem("rainbow_cart_v1",JSON.stringify([{
        variant_id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",quantity:1,
        product:{id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          product_code:"FAKE-001",product_name:"Isolated Necklace",
          selling_price:1000,image:""}
      }]));
    `);
    await driver.get(base+"/order.html");
    await driver.wait(async()=>await driver.executeScript(
      "return document.querySelector('#bagItemCount')?.textContent?.includes('1 item')"),
      12000);
    for(const [id,value] of Object.entries({
      name:"Isolated Customer",phone:"9000000000",address:"Test street example address",
      city:"Nagercoil",pin:"629001"
    })){
      await driver.findElement(By.id(id)).sendKeys(value);
    }
    await driver.executeScript(`
      const e=document.querySelector("#state");
      e.value="Tamil Nadu";
      e.dispatchEvent(new Event("change",{bubbles:true}));
    `);
    await driver.wait(async()=>await driver.executeScript(
      "return window.__isolatedExternalRequests?.some(x=>x==='/api/upi/prepare')"),15000);
    const result=await driver.executeScript(`return {
      qrHidden:document.querySelector("#checkoutQR").hidden,
      qrChildren:document.querySelector("#checkoutQR").children.length,
      gatewayDisabled:document.querySelector("#payRazorpay").disabled,
      pending:localStorage.getItem("rainbow_pending_upi_v1"),
      attempts:window.__isolatedExternalRequests
    }`);
    assert.equal(result.qrHidden,true);
    assert.equal(result.qrChildren,0,"No scannable payment QR before a server quote");
    assert.equal(result.gatewayDisabled,true,"Razorpay requires live server readiness");
    assert.equal(result.pending,null,"Cannot record a successful pending order from a 503");
    assert.ok(result.attempts.includes("/api/upi/prepare"));
  }finally{await driver.quit();}
});
