import { By } from "selenium-webdriver";
import { isolatedOrigin } from "../../../../scripts/test-runtime-config.mjs";
import { TEST_SUPABASE_URL } from "../configuration.mjs";

export class LoginPage {
  constructor(driver) { this.driver = driver; }
  async open(baseUrl, { next } = {}) {
    const origin=isolatedOrigin(baseUrl,"E2E_BASE_URL");
    this.next=next||"index.html";
    await this.driver.get(origin+"/admin/login.html"+(next?"?next="+encodeURIComponent(next):""));
    const config=await this.driver.executeScript("return window.RAINBOW_SUPABASE_CONFIG");
    if(new URL(await this.driver.getCurrentUrl()).origin!==origin||
      config?.supabaseUrl!==isolatedOrigin(TEST_SUPABASE_URL,"SUPABASE_TEST_URL")){
      throw new Error("The browser did not load the expected isolated Supabase configuration.");
    }
  }
  async signIn(username, password) {
    await this.driver.findElement(By.css("[data-testid='login-username']")).sendKeys(username);
    await this.driver.findElement(By.css("[data-testid='login-password']")).sendKeys(password);
    await this.driver.findElement(By.css("[data-testid='login-submit']")).click();
    await this.driver.wait(async () => new URL(await this.driver.getCurrentUrl()).pathname === "/admin/" + this.next, 10000);
  }
}
