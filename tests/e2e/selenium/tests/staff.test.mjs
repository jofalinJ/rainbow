import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD, E2E_ENABLED, BILL_E2E_TOKEN, requireAuthenticatedE2EConfig } from "../configuration.mjs";
import { LoginPage } from "../pages/LoginPage.mjs";
import { StaffPage } from "../pages/StaffPage.mjs";
import { BillsPage } from "../pages/BillsPage.mjs";

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

test("unauthenticated users are redirected away from staff management", async () => {
  await runWithDriver("unauthenticated-staff-redirect", async (driver) => {
    await driver.get(BASE_URL + "/admin/staff.html");
    await driver.wait(until.urlContains("login.html"), 10000);
    assert.match(await driver.getCurrentUrl(), /login\.html/);
  });
});

test("login page exposes accessible form controls", async () => {
  await runWithDriver("login-accessibility", async (driver) => {
    await driver.get(BASE_URL + "/admin/login.html");
    const username = await driver.findElement(By.css("[data-testid='login-username']"));
    const password = await driver.findElement(By.css("[data-testid='login-password']"));
    const submit = await driver.findElement(By.css("[data-testid='login-submit']"));
    assert.equal(await username.isDisplayed(), true);
    assert.equal(await password.isDisplayed(), true);
    assert.ok((await submit.getText()).trim().length > 0);
  });
});

test("admin can load and manage an isolated staff account", { skip: !E2E_ENABLED }, async () => {
  requireAuthenticatedE2EConfig();
  await runWithDriver("admin-staff-management", async (driver) => {
    const login = new LoginPage(driver);
    const staff = new StaffPage(driver);
    await login.open(BASE_URL);
    await login.signIn(ADMIN_USERNAME, ADMIN_PASSWORD);
    await staff.open(BASE_URL);
    assert.equal(await staff.hasUsername(ADMIN_USERNAME), true);
    const unique="e2e_"+Date.now().toString(36);
    await staff.createStaff({name:"E2E Test Staff",username:unique,password:"TestPass123!",role:"cashier"});
    assert.equal(await staff.hasUsername(unique), true);
    await staff.deleteStaff(unique);
    assert.equal(await staff.hasUsername(unique), false);
  });
});


test("authenticated admin navigation remains stable across Products, Inventory, Billing and Bills", { skip: !E2E_ENABLED }, async () => {
  requireAuthenticatedE2EConfig();
  await runWithDriver("admin-page-navigation", async (driver) => {
    const login = new LoginPage(driver);
    await login.open(BASE_URL);
    await login.signIn(ADMIN_USERNAME, ADMIN_PASSWORD);
    for (const page of ["products.html", "inventory.html", "billing.html", "bills.html", "products.html"]) {
      await driver.get(BASE_URL + "/admin/" + page);
      await driver.wait(until.urlContains(page), 10000);
      assert.match(await driver.getCurrentUrl(), new RegExp(page.replace(".", "\\.")+"$"));
    }
  });
});

test("bill View opens the in-app bill preview when an isolated E2E bill exists", { skip: !E2E_ENABLED || !BILL_E2E_TOKEN }, async () => {
  requireAuthenticatedE2EConfig();
  await runWithDriver("bill-view", async (driver) => {
    const login = new LoginPage(driver);
    const bills = new BillsPage(driver);
    await login.open(BASE_URL);
    await login.signIn(ADMIN_USERNAME, ADMIN_PASSWORD);
    await bills.open(BASE_URL);
    await driver.get(BASE_URL + "/admin/bills.html");
    await driver.wait(until.urlContains("bills.html"), 10000);
    const opened = await bills.openBillByToken(BILL_E2E_TOKEN);
    assert.equal(opened, true);
    const preview = await driver.findElement(By.css("#billModal.open #billPreview"));
    assert.equal(await preview.isDisplayed(), true);
  });
});

test("admin dashboard provides the promotional product selector", { skip: !E2E_ENABLED }, async () => {
  requireAuthenticatedE2EConfig();
  await runWithDriver("admin-promotion-editor", async (driver) => {
    const login = new LoginPage(driver);
    await login.open(BASE_URL);
    await login.signIn(ADMIN_USERNAME, ADMIN_PASSWORD);
    await driver.get(BASE_URL + "/admin/index.html");
    await driver.wait(until.elementLocated(By.css("#promotionForm")), 10000);
    assert.equal(await driver.findElement(By.css("#promotionTitle")).isDisplayed(), true);
    assert.equal(await driver.findElement(By.css("#promotionProduct")).getTagName(), "select");
    assert.equal(await driver.findElement(By.css("#promotionSave")).getAttribute("type"), "submit");
    assert.equal(await driver.findElement(By.css("#promotionClear")).getAttribute("type"), "button");
  });
});

test("admin orders provides shipment management with customer data and mobile controls", { skip: !E2E_ENABLED }, async () => {
  requireAuthenticatedE2EConfig();
  await runWithDriver("admin-shipment-modal", async driver => {
    const login = new LoginPage(driver);
    await login.open(BASE_URL);
    await login.signIn(ADMIN_USERNAME, ADMIN_PASSWORD);
    await driver.manage().window().setRect({ width: 430, height: 930 });
    await driver.get(BASE_URL + "/admin/orders.html");
    await driver.wait(until.elementLocated(By.css("#shipmentModal")), 10000);
    assert.equal(await driver.findElement(By.css("#shipmentModal")).isDisplayed(), false);
    await driver.wait(async () => {
      const rows = await driver.findElements(By.css("#rows tr"));
      return rows.length > 0 && !(await rows[0].getText()).includes("Loading");
    }, 15000);
    const actions = await driver.findElements(By.css("[data-shipment]"));
    if (!actions.length) return; // Seeded test DB can legitimately have no online orders.
    await driver.executeScript("arguments[0].click()", actions[0]);
    const editor = await driver.findElement(By.css("#shipmentModal.open"));
    assert.equal(await editor.isDisplayed(), true);
    const summary = await driver.findElement(By.css("#shipmentOrderSummary"));
    assert.ok((await summary.getText()).includes("Order"));
    assert.ok((await summary.getText()).includes("Customer"));
    assert.ok((await summary.getText()).includes("WhatsApp"));
    assert.equal(await driver.findElement(By.css("#shipmentWhatsapp")).isEnabled(), false);
    assert.equal(await driver.findElement(By.css("#shipmentConfirm")).isEnabled(), false);
    const width = await driver.executeScript("return document.documentElement.scrollWidth");
    const viewport = await driver.executeScript("return window.innerWidth");
    assert.ok(width <= viewport + 2, "Shipment modal must not cause horizontal overflow");
    await driver.findElement(By.css("#closeShipment")).click();
    assert.equal(await editor.isDisplayed(), false);
  });
});
