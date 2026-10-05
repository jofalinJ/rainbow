import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { BASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD, E2E_ENABLED, requireAuthenticatedE2EConfig } from "../configuration.mjs";
import { LoginPage } from "../pages/LoginPage.mjs";
import { StaffPage } from "../pages/StaffPage.mjs";

const artifacts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../test-results/selenium");
await fs.mkdir(artifacts, { recursive: true });

async function runWithDriver(name, fn) {
  const options = new chrome.Options();
  options.addArguments("--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1000");
  const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  try { return await fn(driver); }
  catch (error) {
    try { await fs.writeFile(path.join(artifacts, name + ".png"), await driver.takeScreenshot(), "base64"); } catch {}
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

test("admin can load staff management", { skip: !E2E_ENABLED }, async () => {
  requireAuthenticatedE2EConfig();
  await runWithDriver("admin-staff-load", async (driver) => {
    const login = new LoginPage(driver);
    const staff = new StaffPage(driver);
    await login.open(BASE_URL);
    await login.signIn(ADMIN_USERNAME, ADMIN_PASSWORD);
    await staff.open(BASE_URL);
    assert.equal(await staff.hasUsername(ADMIN_USERNAME), true);
  });
});
