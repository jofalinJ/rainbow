/* Safe, opt-in Playwright coverage for Phase 1.
 * Run ONLY with E2E_ISOLATED_ENV=true and a locally served branch build.
 * Every external request is blocked, and payment endpoints return test fixtures.
 * Requires dev-only @playwright/test installation; never run against production.
 */
import {test,expect} from "@playwright/test";

const base=String(process.env.E2E_BASE_URL||"http://127.0.0.1:4173");
if(process.env.E2E_ISOLATED_ENV!=="true" ||
  !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Refusing Playwright Phase 1 run without isolated local host and E2E_ISOLATED_ENV=true.");

const variant="11111111-1111-4111-8111-111111111111";
const productId="22222222-2222-4222-8222-222222222222";
const item=(code,name)=>({variant_id:variant,quantity:1,
  product:{id:productId,product_code:code,product_name:name,
    selling_price:1000,description:"Isolated product",image:""}});
async function mockCheckout(page,{buyNow=false,quoteTotal=1049.10}={}){
  let prepares=0,submits=0;
  const bag=[item("ISOLATED-A","Isolated Bangle")];
  await page.addInitScript(({bag,buyNow})=>{
    localStorage.setItem("rainbow_cart_v1",JSON.stringify(bag));
    const selected={
      ...bag[0],variant_id:"33333333-3333-4333-8333-333333333333",
      product:{...bag[0].product,id:"44444444-4444-4444-8444-444444444444",
        product_name:"Buy now selected design",product_code:"ISOLATED-B"}
    };
    if(buyNow)sessionStorage.setItem("rainbow_buy_now_v1",JSON.stringify(selected));
    const mockRows={
      product_variants:[
        {id:bag[0].variant_id,product_id:bag[0].product.id,stock_quantity:9,active:true,color:"",size:""},
        {id:selected.variant_id,product_id:selected.product.id,stock_quantity:9,active:true,color:"",size:""}
      ],
      products:[
        {id:bag[0].product.id,product_code:"ISOLATED-A",product_name:"Isolated Bangle",
          type:"Bangle",selling_price:1000,description:"Fixture",active:true,product_images:[]},
        {id:selected.product.id,product_code:"ISOLATED-B",product_name:"Buy now selected design",
          type:"Ring",selling_price:1000,description:"Fixture",active:true,product_images:[]}
      ]
    };
    Object.defineProperty(window,"supabase",{value:{createClient:()=>({
      from:table=>({select:()=>({in:async()=>({data:mockRows[table]||[],error:null})})})
    })},writable:false,configurable:false});
  },{bag,buyNow});
  // Strict denylist: no external request escapes the test runner.
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin===base)return route.continue();
    return route.fulfill({status:503,contentType:"text/plain",body:"Blocked by isolated test"});
  });
  await page.route("**/api/razorpay/**",route=>route.fulfill({
    status:503,contentType:"application/json",body:'{"enabled":false,"mode":"test"}'
  }));
  await page.route("**/api/upi/prepare",async route=>{
    prepares++;
    const body=JSON.parse(route.request().postData()||"{}");
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      checkout_id:body.checkout_id,state:"awaiting_payment",order_number:"ISOLATED-0001",
      subtotal:1000,discount_amount:30,cgst_amount:14.55,sgst_amount:14.55,
      delivery_fee:50,total_amount:quoteTotal
    })});
  });
  await page.route("**/api/upi/submit",async route=>{
    submits++;
    return route.fulfill({status:200,contentType:"application/json",
      body:'{"order_number":"ISOLATED-0001","payment_status":"pending","total_amount":1049.10}'});
  });
  return {stats:()=>({prepares,submits})};
}
async function fillValid(page){
  await page.locator("#name").fill("Test Buyer");
  await page.locator("#phone").fill("9876543210");
  await page.locator("#address").fill("Isolated test address");
  await page.locator("#state").selectOption("Tamil Nadu");
}
test.describe("Phase 1 isolated checkout at 390x844",()=>{
  test.use({viewport:{width:390,height:844}});
  test("UX-05/02: invalid details never expose UPI QR; valid details receive a server-locked amount",async({page})=>{
    const {stats}=await mockCheckout(page);
    await page.goto(base+"/order.html");
    await expect(page.locator("#checkoutQR img")).toHaveCount(0);
    await page.locator("#placeOrder").click();
    await expect(page.locator("#name")).toBeFocused();
    await expect(page.locator("#name")).toHaveAttribute("aria-invalid","true");
    await fillValid(page);
    await expect(page.locator("#checkoutQR img")).toHaveCount(1);
    await expect(page.locator("#checkoutQR")).toContainText("ISOLATED-0001");
    await expect(page.locator("#checkoutQR")).toContainText("₹1,049.10");
    expect(stats().prepares).toBe(1);
    await page.locator("#phone").fill("9876543211");
    await expect(page.locator("#checkoutQR img")).toHaveCount(0);
  });
  test("UX-02: a server price difference of one paisa blocks the QR",async({page})=>{
    await mockCheckout(page,{quoteTotal:1049.11});
    await page.goto(base+"/order.html");await fillValid(page);
    await expect(page.locator("#qrUnavailable")).toContainText("Prices changed");
    await expect(page.locator("#checkoutQR img")).toHaveCount(0);
  });
  test("UX-01: Buy now does not erase the ordinary bag",async({page})=>{
    await mockCheckout(page,{buyNow:true});
    await page.goto(base+"/order.html");
    await expect(page.locator("#bagItemCount")).toContainText("Buying now: 1 item");
    await expect(page.locator("#orderItems")).toContainText("Buy now selected design");
    await page.locator("#buyNowBackToBag").click();
    await expect(page.locator("#orderItems")).toContainText("Isolated Bangle");
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("rainbow_cart_v1")));
    expect(saved).toHaveLength(1);
    expect(saved[0].product.product_name).toBe("Isolated Bangle");
  });
  test("UX-03: Escape cancels and confirmation clears locally",async({page})=>{
    await mockCheckout(page);await page.goto(base+"/order.html");
    await page.locator("#clearCart").click();
    await expect(page.locator("#clearBagConfirm")).toBeVisible();
    await expect(page.getByRole("button",{name:"Keep bag"})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#clearBagConfirm")).not.toBeVisible();
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("rainbow_cart_v1")).length)).toBe(1);
    await page.locator("#clearCart").click();
    await page.getByRole("button",{name:"Clear bag",exact:true}).last().click();
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("rainbow_cart_v1")).length)).toBe(0);
  });
});