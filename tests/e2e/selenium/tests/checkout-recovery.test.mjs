import {test} from "node:test";
import assert from "node:assert/strict";
import {Builder,By} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import {BASE_URL} from "../configuration.mjs";

// Browser-only fixtures: no request below can create or pay a real checkout.
const installFixture=(status,recovery)=>`(()=>{
  const token="58cad012-6529-41be-b14e-4ad0878c19db";
  const key="rainbow_razorpay_verification_v1";
  if(!sessionStorage.getItem(key)&&!sessionStorage.getItem("fixture_recovery_installed")){
    const saved=${JSON.stringify(recovery)}==="capability"
      ? {paid:false,capability:{checkout_id:token,gateway_order_id:"order_fixture",recovery_token:"b".repeat(64)}}
      : {paid:false,payload:{checkout_id:token,razorpay_order_id:"order_fixture",razorpay_payment_id:"pay_fixture",razorpay_signature:"a".repeat(64)}};
    sessionStorage.setItem(key,JSON.stringify(saved));sessionStorage.setItem("fixture_recovery_installed","true");
  }
  if(!localStorage.getItem("rainbow_cart_v1"))localStorage.setItem("rainbow_cart_v1",JSON.stringify([{variant_id:token,quantity:1,product:{id:token,product_name:"Fixture jewellery",selling_price:100}}]));
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
    const url=new URL(typeof input==="string"?input:input.url,location.href);
    const reply=data=>Promise.resolve(new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}}));
    if(url.hostname==="rainbow-api.jofalin2005.workers.dev"){
      const calls=JSON.parse(sessionStorage.getItem("fixture_calls")||"[]");calls.push(url.pathname);sessionStorage.setItem("fixture_calls",JSON.stringify(calls));
      if(url.pathname==="/api/razorpay/verify"||url.pathname==="/api/razorpay/status")return reply({success:true,paid:${status==="paid"},status:${JSON.stringify(status)},orderNumber:"RG-FIXTURE",invoiceUrl:"https://rainbowgoldcovering.com/invoice.html?token="+token});
      if(url.pathname==="/api/razorpay/config")return reply({enabled:true,mode:"test",keyId:"rzp_test_fixture"});
      if(url.pathname==="/api/razorpay/provider-check")return reply({provider:"connected"});
      throw new Error("Fixture blocked unexpected payment request: "+url.pathname);
    }
    if(url.hostname.endsWith(".supabase.co")&&url.pathname==="/rest/v1/product_variants")return reply([{id:token,product_id:token,stock_quantity:2,active:true}]);
    if(url.hostname.endsWith(".supabase.co")&&url.pathname==="/rest/v1/products")return reply([{id:token,product_name:"Fixture jewellery",selling_price:100,active:true,product_images:[]}]);
    return originalFetch(input,options);
  };
})();`;
async function browser(status,run,recovery="callback"){
  const options=new chrome.Options().addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=390,844");
  const driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  try{
    await driver.sendDevToolsCommand("Page.addScriptToEvaluateOnNewDocument",{source:installFixture(status,recovery)});
    await run(driver);
  }finally{await driver.quit();}
}
const outcome=async(driver,text)=>{
  await driver.wait(async()=>{
    const view=await driver.findElement(By.id("orderSuccess"));
    return await view.isDisplayed()&&(await view.getText()).includes(text);
  },15000,"Expected payment outcome did not appear");
};
test("paid recovery re-verifies on reload and fits phone and Android tablet widths",async()=>{
  await browser("paid",async driver=>{
    await driver.get(BASE_URL+"/order.html");
    await outcome(driver,"Order placed — payment verified!");
    const link=await driver.findElement(By.css("#orderSuccess a.btn-dark"));
    assert.match(await link.getAttribute("href"),/invoice\.html\?token=[a-f0-9-]{36}$/);
    assert.equal(await driver.findElement(By.id("orderLayout")).isDisplayed(),false);
    for(const width of [390,768]){
      await driver.manage().window().setRect({width,height:950});
      const metrics=await driver.executeScript(()=>({width:globalThis.innerWidth,scroll:globalThis.document.documentElement.scrollWidth,rect:globalThis.document.getElementById("orderSuccess").getBoundingClientRect().toJSON()}));
      assert.ok(metrics.scroll<=metrics.width+1,"Confirmation must not scroll sideways at "+width);
      assert.ok(metrics.rect.x>=0&&metrics.rect.right<=metrics.width+1,"Confirmation must fit at "+width);
    }
    await driver.navigate().refresh();
    await outcome(driver,"Order placed — payment verified!");
    const calls=await driver.executeScript(()=>JSON.parse(sessionStorage.getItem("fixture_calls")));
    assert.equal(calls.filter(path=>path==="/api/razorpay/verify").length,2);
    assert.equal(calls.includes("/api/razorpay/create"),false);
    assert.deepEqual(await driver.executeScript(()=>JSON.parse(localStorage.getItem("rainbow_cart_v1"))),[]);
  });
});
for(const status of ["awaiting_capture","payment_failed","refund_required","refunded"]){
  test(status+" recovery does not show a placed order or open another payment",async()=>{
    await browser(status,async driver=>{
      await driver.get(BASE_URL+"/order.html");
      await outcome(driver,"order not confirmed.");
      assert.equal(await driver.findElement(By.id("orderLayout")).isDisplayed(),false);
      assert.equal((await driver.findElements(By.css("#orderSuccess a[href*='invoice.html']"))).length,0);
      assert.equal(await driver.findElement(By.id("retryPaymentVerification")).isDisplayed(),true);
      assert.equal((await driver.executeScript(()=>JSON.parse(localStorage.getItem("rainbow_cart_v1")))).length,1);
      const calls=await driver.executeScript(()=>JSON.parse(sessionStorage.getItem("fixture_calls")));
      assert.equal(calls.includes("/api/razorpay/create"),false);
    });
  });
}
test("reload without a provider callback rechecks the issued capability and keeps checkout locked",async()=>{
  await browser("awaiting_capture",async driver=>{
    await driver.get(BASE_URL+"/order.html");
    await outcome(driver,"order not confirmed.");
    assert.equal(await driver.executeScript(()=>globalThis.document.getElementById("orderLayout").inert),true);
    assert.equal(await driver.findElement(By.id("placeOrder")).isEnabled(),false);
    await driver.executeScript(()=>{
      const cart=JSON.parse(localStorage.getItem("rainbow_cart_v1"));
      cart[0].quantity=2;localStorage.setItem("rainbow_cart_v1",JSON.stringify(cart));
    });
    await driver.navigate().refresh();
    await outcome(driver,"order not confirmed.");
    const saved=await driver.executeScript(()=>JSON.parse(sessionStorage.getItem("rainbow_razorpay_verification_v1")));
    assert.ok(saved.capability);
    assert.equal(saved.payload,null);
    const calls=await driver.executeScript(()=>JSON.parse(sessionStorage.getItem("fixture_calls")));
    assert.equal(calls.filter(path=>path==="/api/razorpay/status").length,2);
    assert.equal(calls.includes("/api/razorpay/create"),false);
    assert.equal((await driver.findElements(By.id("returnToCheckout"))).length,0);
  },"capability");
});
test("only a server reconciled expiry allows a fresh checkout",async()=>{
  await browser("checkout_expired",async driver=>{
    await driver.get(BASE_URL+"/order.html");
    await outcome(driver,"Checkout expired");
    await driver.findElement(By.id("returnToCheckout")).click();
    await driver.wait(async()=>await driver.findElement(By.id("orderLayout")).isDisplayed(),5000);
    assert.equal(await driver.executeScript(()=>sessionStorage.getItem("rainbow_razorpay_verification_v1")),null);
    assert.equal(await driver.executeScript(()=>globalThis.document.getElementById("orderLayout").inert),false);
    const calls=await driver.executeScript(()=>JSON.parse(sessionStorage.getItem("fixture_calls")));
    assert.equal(calls.includes("/api/razorpay/create"),false);
  },"capability");
});
