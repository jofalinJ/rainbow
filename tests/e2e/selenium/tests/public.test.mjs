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

test("customer navigation does not expose the staff portal", async () => {
  await runWithDriver("customer-no-staff-link", async (driver) => {
    await driver.get(BASE_URL + "/");
    const links = await driver.findElements(By.css("a[href*='/admin/'], a[href*='admin/login']"));
    assert.equal(links.length, 0);
  });
});

test("customer mobile navigation opens and closes with accessible state", async () => {
  await runWithDriver("customer-navigation", async (driver) => {
    await driver.manage().window().setRect({ width: 390, height: 844 });
    await driver.get(BASE_URL + "/");
    assert.match(await driver.findElement(By.css(".skip-link")).getAttribute("href"), /#mainContent$/);
    const toggle = await driver.findElement(By.css("#menuToggle"));
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
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

test("checkout shows state delivery options and keeps future gateway modes disabled", async () => {
  await runWithDriver("checkout-shipping-and-methods", async (driver) => {
    await driver.get(BASE_URL + "/order.html");
    const state = await driver.findElement(By.css("#state"));
    await driver.wait(async () => (await state.findElements(By.css("option"))).length === 37, 10000);
    const checkout = await driver.findElement(By.css("#checkoutQR"));
    assert.equal(await checkout.isDisplayed(), false);
    assert.equal((await driver.findElements(By.css("#paymentConfirmed"))).length, 0);
    assert.equal((await driver.findElements(By.css("#deliveryNote"))).length, 0);
    assert.equal((await driver.findElements(By.css("#paymentMethod option[disabled]"))).length, 4);
    assert.equal(await driver.findElement(By.css("#placeOrder")).isEnabled(), false);
  });
});

test("mobile storefront puts cart beside account and displays photo categories when available", async()=>{
  await runWithDriver("mobile-storefront-navigation-images",async driver=>{
    await driver.manage().window().setRect({width:390,height:844});
    await driver.get(BASE_URL+"/");
    const header=await driver.findElement(By.css(".storefront-header-actions"));
    const account=await header.findElement(By.css("#accountOpen"));
    const cart=await header.findElement(By.css(".cart-icon-link"));
    const a=await account.getRect(),b=await cart.getRect();
    assert.ok(b.x>=a.x,"Cart should follow account");
    assert.equal((await driver.findElements(By.css("#orderTrackOpen"))).length,0);
    await driver.findElement(By.css("#menuToggle")).click();
    const status=await driver.findElement(By.css("#productStatus"));
    await driver.wait(async()=> (await status.getText()).trim()!=="Loading products…",15000);
    const links=await driver.findElements(By.css("#drawerCategories .drawer-type-link"));
    for(const link of links){
      const thumbs=await link.findElements(By.css("img.drawer-type-thumb"));
      const fallback=await link.findElements(By.css(".drawer-type-fallback"));
      assert.equal(thumbs.length+fallback.length,1);
    }
    await driver.findElement(By.css("#drawerClose")).click();
  });
});

test("checkout top navigation and logo do not overlap at phone width",async()=>{
  await runWithDriver("checkout-mobile-topbar",async driver=>{
    await driver.manage().window().setRect({width:390,height:844});
    await driver.get(BASE_URL+"/order.html");
    const logo=await driver.findElement(By.css(".topbar .logo"));
    const links=await driver.findElement(By.css(".topbar .navlinks"));
    const a=await logo.getRect(),b=await links.getRect();
    assert.ok(a.y+a.height<=b.y+2,"Mobile checkout logo should be above navigation row");
  });
});
