import { By, until } from "selenium-webdriver";

export class BillsPage {
  constructor(driver) { this.driver = driver; }

  async open(baseUrl) {
    await this.driver.get(baseUrl + "/admin/bills.html");
    await this.driver.wait(until.urlContains("bills.html"), 10000);
    await this.driver.wait(until.elementLocated(By.css("[data-testid='bill-search']")), 10000);
  }

  async hasBillViewButton() {
    return (await this.driver.findElements(By.css("[data-view]"))).length > 0;
  }

  async openBillByToken(token) {
    const buttons = await this.driver.findElements(By.css("[data-view]"));
    const target = [];
    for (const button of buttons) {
      if (await button.getAttribute("data-view") === token) target.push(button);
    }
    if (!target.length) return false;
    await target[0].click();
    await this.driver.wait(until.elementLocated(By.css("#billModal.open #billPreview")), 10000);
    return true;
  }
}
