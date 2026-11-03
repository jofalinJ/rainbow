import {test} from "node:test";
import assert from "node:assert/strict";
import {Builder,By} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const URL=(process.env.PAYMENT_SMOKE_URL||"https://rainbowgoldcovering.com").replace(/\/$/,"");
test("live Rainbow storefront only enables Razorpay when provider credentials are accepted",async()=>{
  const options=new chrome.Options();
  options.addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=685,950");
  const driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  try{
    await driver.get(URL+"/order.html?testreadiness="+Date.now());
    const radio=await driver.findElement(By.css("#payRazorpay"));
    const status=await driver.findElement(By.css("#gatewayStatus"));
    assert.equal((await driver.findElements(By.css('input[name="paymentMethod"]'))).length,1);
    assert.equal((await driver.findElements(By.css("#payUpi, #manualUpiChoice, #checkoutQR, #paymentReference"))).length,0);
    await driver.wait(async()=>{
      // The compact mobile layout hides the successful connection banner.
      const message=await status.getAttribute("textContent");
      return /connected|payments are ready|rejected|not enabled|unavailable|Could not connect|could not be verified|did not load/i.test(message);
    },20000,"Gateway never returned a readiness status");
    const message=await status.getAttribute("textContent");
    const enabled=await radio.isEnabled();
    console.log(JSON.stringify({test:"payment-card",enabled,message}));
    assert.equal(await radio.isSelected(),true,"The sole online payment method remains selected.");
    if(message.includes("Razorpay test checkout is connected") || message.includes("Secure Razorpay payments are ready")){
      assert.equal(enabled,true,"Provider is connected but the payment card is disabled.");
    }else{
      assert.equal(enabled,false,"Unverified or unavailable provider credentials must NEVER enable payment.");
      assert.equal(await driver.findElement(By.css("#placeOrder")).isEnabled(),false);
      assert.equal(await driver.findElement(By.css("#retryGateway")).isDisplayed(),true);
    }
    // No checkout call, order mutation, real UPI transfer or actual payment is performed.
  }finally{await driver.quit();}
});
