import {test} from "node:test";
import assert from "node:assert/strict";
import {Builder,By} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const URL=(process.env.PAYMENT_SMOKE_URL||"https://rainbowgoldcovering.com").replace(/\/$/,"");
test("live Rainbow storefront enables Razorpay TEST checkout in a real browser",async()=>{
  const options=new chrome.Options();
  options.addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=685,950");
  const driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  try{
    await driver.get(URL+"/order.html?testreadiness="+Date.now());
    const radio=await driver.findElement(By.css("#payRazorpay"));
    const status=await driver.findElement(By.css("#gatewayStatus"));
    await driver.wait(async()=>{
      const message=await status.getText();
      return message.includes("Razorpay test checkout is connected") || message.includes("not enabled") || message.includes("Could not connect");
    },20000,"Gateway never returned a readiness status");
    const message=await status.getText();
    const enabled=await radio.isEnabled();
    console.log(JSON.stringify({test:"payment-card",enabled,message}));
    assert.equal(enabled,true,"The live Razorpay radio is still disabled: "+message);
    assert.match(message,/test checkout is connected/i);
    assert.equal(await radio.isSelected(),true);
    // No checkout call, order mutation, real UPI transfer or actual payment is performed.
  }finally{await driver.quit();}
});
