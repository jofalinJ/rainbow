import { By, until } from "selenium-webdriver";

export class LoginPage {
  constructor(driver) { this.driver = driver; }
  async open(baseUrl) { await this.driver.get(baseUrl + "/admin/login.html"); }
  async signIn(username, password) {
    await this.driver.findElement(By.css("[data-testid='login-username']")).sendKeys(username);
    await this.driver.findElement(By.css("[data-testid='login-password']")).sendKeys(password);
    await this.driver.findElement(By.css("[data-testid='login-submit']")).click();
    await this.driver.wait(until.urlContains("index.html"), 10000);
  }
}
