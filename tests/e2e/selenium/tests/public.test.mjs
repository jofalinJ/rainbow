import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { BASE_URL } from "../configuration.mjs";

const artifacts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../test-results/selenium");
await fs.mkdir(artifacts, { recursive: true });

async function runWithDriver(name, fn) {
  const options = new chrome.Options();
  options.addArguments("--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1000");
  const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  try { return await fn(driver); }
  catch (error) {
    try { await fs.writeFile(path.join(artifacts, name + ".png"), await driver.takeScreenshot(), "base64"); } catch (screenshotError) { console.warn("Could not capture failure screenshot:", screenshotError.message); }
    throw error;
  }
  finally { await driver.quit(); }
}

test("customer home page loads and exposes the main shopping sections", async () => {
  await runWithDriver("customer-home", async (driver) => {
    await driver.get(BASE_URL + "/");
    await driver.wait(async () => /Rainbow(?: Kollam)? Gold Covering/i.test(await driver.getTitle()), 10000);
    assert.match(await driver.getTitle(), /Rainbow(?: Kollam)? Gold Covering/i);
    assert.equal(await driver.findElement(By.css("#products")).isDisplayed(), true);
    assert.equal(await driver.findElement(By.css("#collections")).isDisplayed(), true);
    assert.equal(await driver.findElement(By.css("#contact")).isDisplayed(), true);
    assert.equal(await driver.findElement(By.css("[data-instagram]")).isDisplayed(), true);
  });
});

test("customer product catalogue resolves to a usable state", async () => {
  await runWithDriver("customer-products", async (driver) => {
    await driver.get(BASE_URL + "/");
    const status = await driver.findElement(By.css("#productStatus"));
    await driver.wait(async () => (await status.getText()).trim() !== "Loading products…", 15000);
    const value = (await status.getText()).trim();
    assert.notEqual(value, "Products are temporarily unavailable.");
    assert.match(value, /choose a product type|no product types|product(s)? available/i);
  });
});

test("standalone product link loads current catalogue data", async context => {
  await runWithDriver("standalone-product", async driver => {
    await driver.get(BASE_URL + "/");
    const config=await driver.executeScript("return window.RAINBOW_SUPABASE_CONFIG");
    assert.ok(config?.supabaseUrl&&config?.supabasePublishableKey);
    const response=await fetch(config.supabaseUrl+"/rest/v1/products?select=product_code&active=eq.true&limit=1",{
      headers:{apikey:config.supabasePublishableKey}
    });
    assert.equal(response.ok,true,"Public catalogue should be readable");
    const products=await response.json();
    if(!products.length){context.skip("No active product is published.");return;}
    const sku=products[0].product_code;
    await driver.get(BASE_URL+"/product.html");
    assert.equal(await driver.findElement(By.css("#productError")).isDisplayed(),true);
    assert.equal(await driver.findElement(By.css("#productDetail")).isDisplayed(),false);
    await driver.get(BASE_URL+"/product.html?sku="+encodeURIComponent(sku));
    await driver.wait(async()=>!(await driver.findElement(By.css("#productLoading")).isDisplayed()),15000);
    assert.equal(await driver.findElement(By.css("#productError")).isDisplayed(),false);
    assert.equal(await driver.findElement(By.css("#productDetail")).isDisplayed(),true);
    assert.equal(await driver.findElement(By.css("#detailSku")).getText(),sku);
    assert.ok((await driver.findElement(By.css("#detailName")).getText()).trim().length>0);
  });
});

test("customer navigation does not expose the staff portal", async () => {
  await runWithDriver("customer-no-staff-link", async (driver) => {
    await driver.get(BASE_URL + "/");
    const links = await driver.findElements(By.css("a[href*='/admin/'], a[href*='admin/login']"));
    assert.equal(links.length, 0);
  });
});

test("customer mobile navigation opens and closes with accessible state", async () => {
  await runWithDriver("customer-navigation", async (driver) => {
    await driver.sendDevToolsCommand("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await driver.get(BASE_URL + "/");
    assert.match(await driver.findElement(By.css(".skip-link")).getAttribute("href"), /#mainContent$/);
    const toggle = await driver.findElement(By.css("#menuToggle"));
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const drawer=await driver.findElement(By.css("#shopDrawer"));
    await driver.wait(async () => driver.executeScript(drawer => {
      return Math.abs(drawer.getBoundingClientRect().left)<1;
    }, drawer), 5000);
    await driver.findElement(By.css("#drawerClose")).click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  });
});

test("admin-selected homepage promotion opens the matching product details", async () => {
  await runWithDriver("featured-promotion", async (driver) => {
    await driver.get(BASE_URL + "/");
    const status = await driver.findElement(By.css("#productStatus"));
    await driver.wait(async () => (await status.getText()).trim() !== "Loading products…", 15000);
    const section = await driver.findElement(By.css("#featuredPromotion"));
    // The feature is intentionally hidden until an admin publishes a product.
    if (!(await section.isDisplayed())) return;
    // Image-only rotating gallery: no product name or pricing overlay.
    assert.equal((await driver.findElements(By.css("#promotionName, #promotionPrice"))).length, 0);
    const image=await driver.findElement(By.css("#promotionImage"));
    assert.ok((await image.getAttribute("src")).length > 8);
    assert.ok((await image.getAttribute("alt")).trim().length > 0);
    await driver.findElement(By.css("#promotionView")).click();
    await driver.wait(until.elementLocated(By.css("#productModal.open #modalProductName")), 5000);
    assert.ok((await driver.findElement(By.css("#modalProductName")).getText()).trim().length > 0);
  });
});

test("homepage editorial content and contact links match storefront feedback", async () => {
  await runWithDriver("home-editorial-feedback", async (driver) => {
    await driver.get(BASE_URL + "/");
    assert.equal((await driver.findElements(By.css("#process .section-head > p"))).length, 0);
    assert.equal((await driver.findElements(By.css("#story .section-head > p"))).length, 0);

    const logo = await driver.findElement(By.css("#story .story-card img.story-brand-logo"));
    assert.equal(await logo.isDisplayed(), true);
    assert.match(await logo.getAttribute("src"), /assets\/brand\/logo2\.png/);
    assert.ok((await logo.getAttribute("alt")).includes("Rainbow"));
    const logoStyle = await driver.executeScript((element) => {
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return { blend: style.mixBlendMode, background: style.backgroundColor, border: style.borderTopStyle };
    }, logo);
    assert.equal(logoStyle.blend, "multiply");
    assert.equal(logoStyle.background, "rgba(0, 0, 0, 0)");
    assert.equal(logoStyle.border, "none");

    const links = await driver.findElements(By.css("#contact .contact-phone a"));
    assert.equal(links.length, 3);
    const instagram = await driver.findElement(By.css("#contact .contact-phone .contact-instagram"));
    assert.match(await instagram.getAttribute("href"), /instagram\.com\/rainbow_kollam_gold_covering\//);
    assert.equal(await instagram.getAttribute("target"), "_blank");
  });
});

test("checkout shows state delivery options and blocks an empty cart", async () => {
  await runWithDriver("checkout-shipping-and-methods", async (driver) => {
    await driver.get(BASE_URL + "/order.html");
    const state = await driver.findElement(By.css("#state"));
    await driver.wait(async () => (await state.findElements(By.css("option"))).length === 37, 10000);
    const checkout = await driver.findElement(By.css("#checkoutQR"));
    assert.equal(await checkout.isDisplayed(), false);
    assert.equal((await driver.findElements(By.css("#paymentConfirmed"))).length, 0);
    assert.equal((await driver.findElements(By.css("#deliveryNote"))).length, 0);
    assert.equal((await driver.findElements(By.css('input[name="paymentMethod"]'))).length, 2);
    const manual=await driver.findElement(By.css("#payUpi"));
    const manualChoice=await driver.findElement(By.css("#manualUpiChoice"));
    await driver.executeScript(element=>element.scrollIntoView({block:"center",behavior:"instant"}),manualChoice);
    await manualChoice.click();
    assert.equal(await manual.isSelected(), true);
    assert.equal(await driver.findElement(By.css("#paymentReferenceGroup")).isDisplayed(), true);
    assert.equal(await driver.findElement(By.css("#whatsappReceiptConsent")).isSelected(), false);
    assert.equal(await driver.findElement(By.css("#placeOrder")).isEnabled(), false);
  });
});

test("mobile storefront puts cart beside account and displays photo categories when available", async()=>{
  await runWithDriver("mobile-storefront-navigation-images",async driver=>{
    await driver.sendDevToolsCommand("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await driver.get(BASE_URL+"/");
    const header=await driver.findElement(By.css(".storefront-header-actions"));
    const account=await header.findElement(By.css("#accountOpen"));
    const cart=await header.findElement(By.css(".cart-icon-link"));
    const a=await account.getRect(),b=await cart.getRect();
    assert.ok(b.x>=a.x,"Cart should follow account");
    assert.equal((await driver.findElements(By.css("#orderTrackOpen"))).length,0);
    await driver.findElement(By.css("#menuToggle")).click();
    const drawer=await driver.findElement(By.css("#shopDrawer"));
    await driver.wait(async()=>driver.executeScript(element=>Math.abs(element.getBoundingClientRect().left)<1,drawer),5000);
    const status=await driver.findElement(By.css("#productStatus"));
    await driver.wait(async()=> (await status.getText()).trim()!=="Loading products…",15000);
    // Catalogue refreshes may replace links; inspect one consistent DOM snapshot.
    const categories=await driver.findElement(By.css("#drawerCategories"));
    const imageCounts=await driver.executeScript(element=>Array.from(element.querySelectorAll(".drawer-type-link"),link=>
      link.querySelectorAll("img.drawer-type-thumb, .drawer-type-fallback").length),categories);
    for(const count of imageCounts){
      assert.equal(count,1);
    }
    await driver.findElement(By.css("#drawerClose")).click();
  });
});

test("checkout top navigation and logo do not overlap at phone width",async()=>{
  await runWithDriver("checkout-mobile-topbar",async driver=>{
    await driver.sendDevToolsCommand("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await driver.get(BASE_URL+"/order.html");
    const logo=await driver.findElement(By.css(".topbar .logo"));
    const links=await driver.findElement(By.css(".topbar .navlinks"));
    const a=await logo.getRect(),b=await links.getRect();
    assert.ok(a.y+a.height<=b.y+2,"Mobile checkout logo should be above navigation row");
  });
});
