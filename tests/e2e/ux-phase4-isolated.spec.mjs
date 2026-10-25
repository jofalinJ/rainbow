/* Phase 4 mobile browser checks. Uses a LOCAL static server only.
 * All remote requests are denied. Does NOT submit an order or initiate a payment.
 * Install @playwright/test in devDependencies only, never a runtime dependency.
 */
import {test,expect} from "@playwright/test";
const base=String(process.env.E2E_BASE_URL||"http://127.0.0.1:4173");
if(process.env.E2E_ISOLATED_ENV!=="true"||
   !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(base)){
  throw new Error("Phase 4 tests refuse nonlocal execution.");
}
async function isolated(page){
  await page.addInitScript(()=>{
    const product={id:"11111111-1111-4111-8111-111111111111",
      product_code:"ISOLATED-NO-PHOTO",product_name:"Isolated no-photo Bangle",
      type:"Bangle",gender:"women",active:true,selling_price:1049.10,
      category_id:"22222222-2222-4222-8222-222222222222",
      description:"Isolated fixture",created_at:"2026-01-01T00:00:00Z",
      display_priority:10,product_images:[],
      categories:{name:"Bangle",storefront_order:1,show_in_storefront:true},
      product_variants:[{id:"33333333-3333-4333-8333-333333333333",
        product_id:"11111111-1111-4111-8111-111111111111",
        active:true,stock_quantity:5,color:"Gold",size:""}]};
    class Q{
      constructor(table){this.table=table;this.category=null;this.single=false;}
      select(){return this;}order(){return this;}limit(){return this;}
      eq(key,value){if(key==="products.category_id")this.category=value;return this;}
      gt(){return this;}gte(){return this;}lte(){return this;}
      in(){return this;}or(){return this;}range(){return this;}
      maybeSingle(){return Promise.resolve({data:product,error:null});}
      then(resolve,reject){
        const result=this.table==="categories"?
          {data:[{id:product.category_id,name:"Bangle",storefront_order:1,show_in_storefront:true}],error:null}:
          this.table==="product_variants"?
          {data:null,count:1,error:null}:
          this.table==="products"?
          {data:[product],count:1,error:null}:
          {data:[],count:0,error:null};
        return Promise.resolve(result).then(resolve,reject);
      }
    }
    Object.defineProperty(window,"supabase",{configurable:true,value:{
      createClient:()=>({from:t=>new Q(t),channel:()=>({on(){return this;},subscribe(){return this;}}),
        removeChannel:()=>Promise.resolve()})}});
  });
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.origin===base)return route.continue();
    return route.fulfill({status:503,contentType:"text/plain",body:"BLOCKED: isolated Phase 4 QA"});
  });
}
for(const [width,height] of [[320,568],[360,800],[390,844],[430,932]]){
  test.describe("Phase 4 isolated "+width+"x"+height,()=>{
    test.use({viewport:{width,height}});
    test("UX-18: no-photo product has no 1 / 0 photo counter",async({page})=>{
      await isolated(page);
      await page.goto(base+"/index.html");
      await expect(page.locator(".product-card .photo-unavailable").first()).toBeVisible();
      await page.locator(".product-card-quick-view").first().click();
      await expect(page.locator("#productModal")).toHaveClass(/open/);
      await expect(page.locator("#productModal .photo-unavailable")).toBeVisible();
      await expect(page.locator("#productModal [data-gallery-count]")).toHaveCount(0);
      await expect(page.locator("#productModal")).not.toContainText("1 / 0");
      await page.keyboard.press("Escape");
      await page.goto(base+"/product.html?sku=ISOLATED-NO-PHOTO");
      await expect(page.locator(".detail-main-image .photo-unavailable")).toBeVisible();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      expect(overflow).toBe(false);
      if(width===390)await page.screenshot({path:"phase4-product-390.png",fullPage:true});
    });
    test("UX-19/20: product prices and Bag labels are consistent",async({page})=>{
      await isolated(page);
      await page.goto(base+"/index.html");
      await expect(page.locator(".product-price").first()).toContainText("₹1,049.10");
      await expect(page.locator('a.cart-icon-link')).toHaveAttribute("aria-label","Bag");
      await page.goto(base+"/product.html?sku=ISOLATED-NO-PHOTO");
      await expect(page.locator("#detailPrice")).toHaveText("₹1,049.10");
      await expect(page.locator('a[href="order.html"]').first()).toContainText("Bag");
    });
    test("UX-21: manual UPI hides Razorpay status, without submitting payment",async({page})=>{
      await isolated(page);
      await page.goto(base+"/order.html");
      await expect(page.locator("#payUpi")).toBeChecked();
      await expect(page.locator("#gatewayConnection")).toBeHidden();
      await expect(page.locator("#bagHeading")).toHaveText("Bag");
      await expect(page.locator("#razorpayInlineStatus")).toHaveText(/Checking|Unavailable/);
      if(width===390)await page.screenshot({path:"phase4-payment-390.png",fullPage:true});
    });
  });
}
