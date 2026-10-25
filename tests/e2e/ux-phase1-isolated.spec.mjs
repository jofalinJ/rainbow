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
  let prepares=0,submits=0,corrections=0,statusReads=0,statusState="pending";
  const bag=[item("ISOLATED-A","Isolated Bangle")];
  if(buyNow)bag.push({...item("ISOLATED-C","Isolated Necklace"),
    variant_id:"55555555-5555-4555-8555-555555555555",
    product:{...bag[0].product,id:"66666666-6666-4666-8666-666666666666",
      product_name:"Isolated Necklace",product_code:"ISOLATED-C"}});
  await page.addInitScript(({bag,buyNow})=>{
    if(localStorage.getItem("__phase1_seeded"))return;
    localStorage.setItem("__phase1_seeded","true");
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
        ...(buyNow?[{id:bag[1].variant_id,product_id:bag[1].product.id,stock_quantity:9,active:true,color:"",size:""}]:[]),
        {id:selected.variant_id,product_id:selected.product.id,stock_quantity:9,active:true,color:"",size:""}
      ],
      products:[
        {id:bag[0].product.id,product_code:"ISOLATED-A",product_name:"Isolated Bangle",
          type:"Bangle",selling_price:1000,description:"Fixture",active:true,product_images:[]},
        ...(buyNow?[{id:bag[1].product.id,product_code:"ISOLATED-C",product_name:"Isolated Necklace",type:"Necklace",selling_price:1000,description:"Fixture",active:true,product_images:[]}]:[]),
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
    // Never render a real, scannable merchant QR in screenshots/test runs.
    if(url.pathname.endsWith("/assets/brand/pay.png"))
      return route.fulfill({status:200,contentType:"image/svg+xml",
        body:'<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176"><rect width="176" height="176" fill="#f9e5e5"/><text x="88" y="79" text-anchor="middle" font-size="20" fill="#8f1520">TEST ONLY</text><text x="88" y="108" text-anchor="middle" font-size="12" fill="#8f1520">DO NOT PAY</text></svg>'});
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
      delivery_fee:50,total_amount:quoteTotal,
      expires_at:new Date(Date.now()+15*60*1000).toISOString(),
      recovery_token:"test_isolated_recovery_token_1234567890abcdef"
    })});
  });
  await page.route("**/api/upi/submit",async route=>{
    submits++;
    return route.fulfill({status:200,contentType:"application/json",
      body:'{"order_number":"ISOLATED-0001","payment_status":"pending","total_amount":1049.10}'});
  });
  await page.route("**/api/upi/status",async route=>{
    statusReads++;
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      order_number:"ISOLATED-0001",state:statusState,
      payment_status:statusState==="verified"?"paid":"pending"
    })});
  });
  await page.route("**/api/upi/correct",async route=>{
    corrections++;
    const body=JSON.parse(route.request().postData()||"{}");
    if(!body.recovery_token||!body.request_id)throw new Error("Missing correction capability");
    return route.fulfill({status:200,contentType:"application/json",
      body:'{"order_number":"ISOLATED-0001","payment_status":"pending"}'});
  });
  return {stats:()=>({prepares,submits,corrections,statusReads}),
    setStatus:value=>{statusState=value}};

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
    expect(saved).toHaveLength(2);
    expect(saved.map(x=>x.product.product_name)).toEqual(["Isolated Bangle","Isolated Necklace"]);
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
  test("UX-06/07: discount is negative and one price model feeds both breakdowns",async({page})=>{
    await mockCheckout(page);
    await page.goto(base+"/order.html");await fillValid(page);
    await expect(page.locator("#checkoutQR img")).toHaveCount(1);
    await expect(page.locator("#discount")).toHaveText("−₹30.00");
    await expect(page.locator("#paymentMiniDiscount")).toHaveText("−₹30.00");
    await expect(page.locator("#paymentPriceHeadline")).toHaveText("Pay ₹1,049.10");
    await page.locator("#paymentPriceBreakdown summary").click();
    for(const [a,b] of [
      ["subtotal","paymentMiniSubtotal"],["discount","paymentMiniDiscount"],
      ["cgst","paymentMiniCgst"],["sgst","paymentMiniSgst"],
      ["delivery","paymentMiniDelivery"],["total","paymentMiniTotal"]
    ]){
      expect(await page.locator("#"+a).textContent()).toBe(
        await page.locator("#"+b).textContent()
      );
    }
  });
  test("UX-09: pending checkout persists without address and corrects same order",async({page})=>{
    const mock=await mockCheckout(page);
    await page.goto(base+"/order.html");await fillValid(page);
    await expect(page.locator("#checkoutQR img")).toHaveCount(1);
    await page.locator("#paymentReference").fill("TEST-UTR-001");
    await page.locator("#placeOrder").click();
    await expect(page.locator("#orderSuccess")).toContainText("pending shop verification");
    const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("rainbow_pending_upi_v1")));
    expect(record.order_number).toBe("ISOLATED-0001");
    expect(record.phone_last4).toBe("3210");
    expect(JSON.stringify(record)).not.toContain("Isolated test address");
    expect(JSON.stringify(record)).not.toContain("9876543210");
    const firstCheckoutId=record.checkout_id;
    await page.reload();
    await expect(page.locator("#pendingCheckoutBanner")).toBeVisible();
    await expect(page.locator("#pendingCheckoutMessage")).toContainText("ISOLATED-0001");
    expect(mock.stats().prepares).toBe(1);
    await page.locator("#pendingCheckoutCorrect").click();
    await page.locator("#pendingCheckoutUtr").fill("TEST-UTR-CORRECTED");
    await page.locator("#pendingCheckoutSaveUtr").click();
    await expect(page.locator("#pendingCheckoutMessage")).toContainText("Reference updated");
    expect(mock.stats().corrections).toBe(1);
    const current=await page.evaluate(()=>JSON.parse(localStorage.getItem("rainbow_pending_upi_v1")));
    expect(current.checkout_id).toBe(firstCheckoutId);
    await page.locator("#pendingCheckoutStatus").click();
    expect(mock.stats().statusReads).toBe(1);
    expect(mock.stats().prepares).toBe(1);
  });
  test("UX-09: only server decline restores the bag and clears pending state",async({page})=>{
    const mock=await mockCheckout(page);
    await page.goto(base+"/order.html");await fillValid(page);
    await expect(page.locator("#checkoutQR img")).toHaveCount(1);
    await page.locator("#paymentReference").fill("TEST-UTR-002");
    await page.locator("#placeOrder").click();
    await expect(page.locator("#orderSuccess")).toContainText("pending");
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("rainbow_cart_v1")))).toHaveLength(0);
    mock.setStatus("declined");
    await page.locator("#pendingCheckoutStatus").click();
    await expect(page.locator("#pendingCheckoutMessage")).toContainText("restored");
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem("rainbow_cart_v1")));
    expect(restored).toHaveLength(1);
    expect(await page.evaluate(()=>localStorage.getItem("rainbow_pending_upi_v1"))).toBeNull();
  });
  test("UX-10: checkout stages announce bag, delivery and payment",async({page})=>{
    await mockCheckout(page);
    await page.goto(base+"/order.html");
    await expect(page.locator("#addressStep")).toHaveAttribute("aria-current","step");
    await fillValid(page);
    await expect(page.locator("#paymentStep")).toHaveAttribute("aria-current","step");
    await expect(page.locator("#addressStep b")).toHaveText("✓");
    await expect(page.locator("#paymentStep [data-step-announcement]")).toContainText("Step 3 of 3");
  });

});