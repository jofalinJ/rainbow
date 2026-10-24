/* Run ONLY on a local branch checkout with E2E_ISOLATED_ENV=true.
 * All third-party requests are blocked and all customer catalogue data is fake.
 * Never point this suite at rainbowgoldcovering.com or real payment endpoints.
 * Dev-only dependencies: @playwright/test and axe-core.
 */
import {test,expect} from "@playwright/test";
import axe from "axe-core";

const base=String(process.env.E2E_BASE_URL||"http://127.0.0.1:4173");
if(process.env.E2E_ISOLATED_ENV!=="true" ||
   !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Phase 3 audit refuses nonlocal execution or unapproved network.");

async function fixture(page,{failCatalogue=false}={}){
  await page.addInitScript(({failCatalogue})=>{
    const product={id:"11111111-1111-4111-8111-111111111111",product_code:"ISOLATED-RING",
      product_name:"Isolated long jewellery design for keyboard and wrapping test",
      type:"Bangle",gender:"women",category_id:"22222222-2222-4222-8222-222222222222",
      active:true,selling_price:1049.10,description:"Test only",
      display_priority:10,created_at:"2026-01-01T00:00:00Z",
      categories:{name:"Bangle",storefront_order:1,show_in_storefront:true},
      product_variants:[{id:"33333333-3333-4333-8333-333333333333",stock_quantity:5,active:true,color:"Gold",size:""}],
      product_images:[]};
    const catA={id:"22222222-2222-4222-8222-222222222222",name:"Bangle",storefront_order:1,show_in_storefront:true};
    const catB={id:"44444444-4444-4444-8444-444444444444",name:"Bracelet",storefront_order:2,show_in_storefront:true};
    class Q {
      constructor(table){this.table=table;this.head=false;this.targetCat=null;}
      select(fields,opts={}){this.head=Boolean(opts.head);return this;}
      eq(key,value){if(key==="products.category_id")this.targetCat=value;return this;}
      order(){return this;}range(){return this;}limit(){return this;}
      gt(){return this;}gte(){return this;}lte(){return this;}
      in(){return this;}neq(){return this;}ilike(){return this;}or(){return this;}
      maybeSingle(){return Promise.resolve({data:product,error:null});}
      then(resolve,reject){
        if(failCatalogue)return Promise.resolve({data:null,error:{message:"OFFLINE TEST"}}).then(resolve,reject);
        if(this.table==="categories")return Promise.resolve({data:[catA,catB],error:null}).then(resolve,reject);
        if(this.table==="storefront_promotion_items")return Promise.resolve({data:[],error:null}).then(resolve,reject);
        if(this.table==="product_variants")return Promise.resolve({data:null,error:null,count:this.targetCat===catA.id?1:0}).then(resolve,reject);
        if(this.table==="products")return Promise.resolve({data:[product],count:1,error:null}).then(resolve,reject);
        return Promise.resolve({data:[],count:0,error:null}).then(resolve,reject);
      }
    }
    Object.defineProperty(window,"supabase",{configurable:true,value:{
      createClient:()=>({
        from:table=>new Q(table),
        channel:()=>({on(){return this;},subscribe(){return this;}}),
        removeChannel(){return Promise.resolve()}
      })
    }});
  },{failCatalogue});
  await page.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.origin===base)return route.continue();
    return route.fulfill({status:503,contentType:"text/plain",body:"External network denied in isolated QA"});
  });
}
async function assertWidth(page){
  const metrics=await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth
  }));
  expect(metrics.scrollWidth,"No horizontal overflow").toBeLessThanOrEqual(metrics.innerWidth);
}
async function scanTouchTargets(page){
  return page.evaluate(()=>[...document.querySelectorAll(
    'button,a[href],input:not([type="hidden"]),select,textarea,[role="button"]')]
    .filter(el=>{
      const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
      return rect.width>0&&rect.height>0&&style.visibility!=="hidden";
    })
    .map(el=>({tag:el.tagName,id:el.id||el.className?.toString().slice(0,40),
      width:Math.round(el.getBoundingClientRect().width),
      height:Math.round(el.getBoundingClientRect().height)}))
    .filter(item=>item.width<44||item.height<44));
}
for(const [width,height] of [[320,568],[360,800],[390,844],[430,932]]){
  test.describe("Phase 3 mobile "+width+"x"+height,()=>{
    test.use({viewport:{width,height}});
    test("UX-11/16/17: stocked categories only, semantic cards and no horizontal overflow",async({page})=>{
      await fixture(page);
      await page.goto(base+"/index.html");
      await expect(page.locator("#mobileCategoryTrack [data-mobile-category='Bangle']")).toBeVisible();
      await expect(page.locator("#mobileCategoryTrack [data-mobile-category='Bracelet']")).toHaveCount(0);
      await expect(page.locator(".product-card-quick-view").first()).toHaveAttribute("aria-label",/Quick view:/);
      await assertWidth(page);
      await page.locator(".product-card-quick-view").first().focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#productModal")).toHaveClass(/open/);
      await page.keyboard.press("Escape");
      await expect(page.locator(".product-card-quick-view").first()).toBeFocused();
      console.log("Touch target sweep",width,await scanTouchTargets(page));
      if(width===390)await page.screenshot({path:"tests/artifacts/ux-phase3/home-390.png",fullPage:true});
    });
    test("UX-16: offline shows error, never says No jewellery listed yet",async({page})=>{
      await fixture(page,{failCatalogue:true});
      await page.goto(base+"/index.html");
      await expect(page.locator("#catalogueRetry")).toBeVisible();
      await expect(page.locator("#productGrid")).not.toContainText("No jewellery listed yet");
      await expect(page.locator("#catalogueRetry")).toHaveJSProperty("offsetHeight",44);
    });
    test("UX-12/13: product Back and 16px field controls",async({page})=>{
      await fixture(page);
      await page.goto(base+"/product.html?sku=ISOLATED-RING");
      await expect(page.locator(".detail-back-link")).toBeVisible();
      const backBox=await page.locator(".detail-back-link").boundingBox();
      expect(backBox.width).toBeGreaterThanOrEqual(44);
      expect(backBox.height).toBeGreaterThanOrEqual(44);
      const sizes=await page.locator('input:not([type="checkbox"]):not([type="radio"]),select,textarea').evaluateAll(
        elems=>elems.filter(e=>e.getBoundingClientRect().width>0)
          .map(e=>({id:e.id,size:parseFloat(getComputedStyle(e).fontSize)})));
      expect(sizes.every(x=>x.size>=16),JSON.stringify(sizes)).toBe(true);
      await assertWidth(page);
    });
  });
}
test("UX-14: axe-core WCAG AA scan on isolated customer screens at 390px",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fixture(page);
  for(const screen of ["index.html","product.html?sku=ISOLATED-RING","order.html"]){
    await page.goto(base+"/"+screen);
    await page.addScriptTag({content:axe.source});
    const result=await page.evaluate(()=>window.axe.run(document,{
      runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag22aa"]}
    }));
    expect(result.violations.map(x=>({id:x.id,impact:x.impact,summary:x.description}))).toEqual([]);
  }
});
