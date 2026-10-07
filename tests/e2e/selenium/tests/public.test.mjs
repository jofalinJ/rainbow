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
    await driver.wait(until.titleContains("Rainbow Gold Covering"), 10000);
    assert.match(await driver.getTitle(), /Rainbow Gold Covering/i);
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
    assert.match(value, /product(s)? available/i);
  });
});

test("customer navigation does not expose the staff portal", async () => {
  await runWithDriver("customer-no-staff-link", async (driver) => {
    await driver.get(BASE_URL + "/");
    const links = await driver.findElements(By.css("a[href*='/admin/'], a[href*='admin/login']"));
    assert.equal(links.length, 0);
  });
});
