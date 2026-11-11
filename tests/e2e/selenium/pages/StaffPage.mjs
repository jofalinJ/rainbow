import { By, until } from "selenium-webdriver";
import { fileURLToPath } from "node:url";

export class StaffPage {
  constructor(driver) { this.driver = driver; }
  async open(baseUrl) { await this.driver.get(baseUrl + "/admin/staff.html"); }
  async waitForList() { await this.driver.wait(until.elementLocated(By.css("[data-testid='staff-list']")), 10000); }
  async hasUsername(username) {
    await this.waitForList();
    return this.driver.executeScript("return Array.from(document.querySelectorAll('[data-testid=staff-row]')).some(row => row.dataset.username === arguments[0]);", username);
  }
  async waitForUsername(username) {
    await this.driver.wait(() => this.hasUsername(username), 12000, "Expected the staff account to appear");
  }
  async createStaff({name,username,password,role}) {
    await this.driver.findElement(By.css("[data-testid='staff-name']")).sendKeys(name);
    await this.driver.findElement(By.css("[data-testid='staff-username']")).sendKeys(username);
    await this.driver.findElement(By.css("[data-testid='staff-password']")).sendKeys(password);
    await this.driver.findElement(By.css("[data-testid='staff-role']")).findElement(By.css("option[value='"+role+"']")).click();
    await this.driver.findElement(By.id("photo")).sendKeys(fileURLToPath(new URL("../../../../assets/brand/rainbow-logo.png", import.meta.url)));
    await this.driver.findElement(By.css("[data-testid='create-staff']")).click();
    await this.waitForUsername(username);
  }
  async deleteStaff(username) {
    const row=await this.driver.findElement(By.css("[data-testid='staff-row'][data-username='"+username+"']"));
    await row.findElement(By.css("[data-testid='delete-staff']")).click();
    await this.driver.wait(until.alertIsPresent(),5000);
    await this.driver.switchTo().alert().accept();
    await this.driver.wait(async()=>{
      const rows=await this.driver.findElements(By.css("[data-testid='staff-row'][data-username='"+username+"']"));
      return rows.length===0;
    },10000);
  }
}
