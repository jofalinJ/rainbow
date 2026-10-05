import { By, until } from "selenium-webdriver";

export class StaffPage {
  constructor(driver) { this.driver = driver; }
  async open(baseUrl) { await this.driver.get(baseUrl + "/admin/staff.html"); }
  async waitForList() { await this.driver.wait(until.elementLocated(By.css("[data-testid='staff-list']")), 10000); }
  async hasUsername(username) {
    await this.waitForList();
    const rows = await this.driver.findElements(By.css("[data-testid='staff-list'] tr"));
    for (const row of rows) if ((await row.getText()).includes(username)) return true;
    return false;
  }
}
