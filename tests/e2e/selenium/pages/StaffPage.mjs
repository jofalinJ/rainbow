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
  async createStaff({name,username,password,role}) {
    await this.driver.findElement(By.css("[data-testid='staff-name']")).sendKeys(name);
    await this.driver.findElement(By.css("[data-testid='staff-username']")).sendKeys(username);
    await this.driver.findElement(By.css("[data-testid='staff-password']")).sendKeys(password);
    await this.driver.findElement(By.css("[data-testid='staff-role']")).findElement(By.css("option[value='"+role+"']")).click();
    await this.driver.findElement(By.css("[data-testid='create-staff']")).click();
    await this.driver.wait(until.elementLocated(By.css("[data-testid='staff-list']")),10000);
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
