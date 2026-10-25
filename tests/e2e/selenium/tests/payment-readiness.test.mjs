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
    await driver.wait(async()=>{
      const message=await status.getText();
      return message.includes("Razorpay test checkout is connected") || message.includes("Secure Razorpay payments are ready") || message.includes("Razorpay rejected") || message.includes("not enabled") || message.includes("Could not connect") || message.includes("Razorpay could not be verified");
    },20000,"Gateway never returned a readiness status");
    const message=await status.getText();
    const enabled=await radio.isEnabled();
    console.log(JSON.stringify({test:"payment-card",enabled,message}));
    if(message.includes("Razorpay test checkout is connected") || message.includes("Secure Razorpay payments are ready")){
      assert.equal(enabled,true,"Provider is connected but the payment card is disabled.");
      assert.equal(await radio.isSelected(),true);
    }else if(message.includes("Razorpay rejected")){
      assert.equal(enabled,false,"Rejected provider credentials must NEVER enable Pay.");
      assert.equal(await radio.isSelected(),false);
    }else{
      assert.fail("Gateway readiness was not confirmed: "+message);
    }
    // No checkout call, order mutation, real UPI transfer or actual payment is performed.
  }finally{await driver.quit();}
});
