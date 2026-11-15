import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {Builder, By, Key, until} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import {isPublicAssetPath} from "../../../../scripts/public-asset-manifest.mjs";

const category={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",name:"Chain",show_in_storefront:true};
const product={
  id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  product_code:"FIXTURE-CHAIN",
  product_name:"Fixture chain",
  type:category.name,
  category_id:category.id,
  categories:category,
  selling_price:120,
  active:true,
  erp_online_listings:{published:true,online_price:122.55},
  product_images:[],
  product_variants:[
    {id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",active:true,stock_quantity:3,color:"Gold",length_cm:18}
  ]
};
const variantId=product.product_variants[0].id;
const contentTypes={
  ".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".png":"image/png"
};

function bootstrapFixture(catalogueProduct, catalogueCategory) {
  const scope=globalThis;
  scope.RAINBOW_SUPABASE_CONFIG={
    supabaseUrl:"https://storefront-fixture.invalid",
    supabasePublishableKey:"fixture-public-key"
  };
  scope.localStorage.setItem("rainbow_analytics_consent_v1","denied");
  const rows={
    products:[catalogueProduct],
    categories:[catalogueCategory],
    product_variants:catalogueProduct.product_variants.map(variant=>({...variant,product_id:catalogueProduct.id}))
  };
  class FixtureQuery {
    constructor(table) {
      this.items=rows[table]||[];
    }
    select(){return this;}
    eq(){return this;}
    neq(key,value){
      this.items=this.items.filter(item=>item[key]!==value);
      return this;
    }
    gt(){return this;}
    order(){return this;}
    range(){return this;}
    limit(){return this;}
    in(key,values){
      this.items=this.items.filter(item=>values.includes(item[key]));
      return this;
    }
    async maybeSingle(){return {data:this.items[0]??null,error:null};}
    then(resolve,reject){
      return Promise.resolve({data:this.items,count:this.items.length,error:null}).then(resolve,reject);
    }
  }
  const client={
    from:table=>new FixtureQuery(table),
    auth:{getSession:async()=>({data:{session:null},error:null})},
    channel:()=>({on(){return this;},subscribe(){return this;}}),
    removeChannel(){}
  };
  scope.supabase={createClient:()=>client};
}

async function withStorefront(run) {
  const root=new URL("../../../../",import.meta.url);
  const server=createServer(async(request,response)=>{
    const pathname=new URL(request.url,"http://127.0.0.1").pathname;
    const relative=pathname==="/"?"index.html":pathname.slice(1);
    response.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    response.setHeader("Cache-Control","no-store");
    if(relative==="admin/config.js"){
      response.setHeader("Content-Type",contentTypes[".js"]);
      response.end("(" + bootstrapFixture.toString() + ")(" + JSON.stringify(product) + "," + JSON.stringify(category) + ");");
      return;
    }
    if(relative==="payment-config.js"){
      response.setHeader("Content-Type",contentTypes[".js"]);
      response.end("window.RAINBOW_PAYMENT_CONFIG={apiBaseUrl:''};");
      return;
    }
    const fileType=relative.slice(relative.lastIndexOf("."));
    if(!contentTypes[fileType]||!isPublicAssetPath(relative)){
      response.writeHead(404).end();
      return;
    }
    try{
      const asset=await readFile(fileURLToPath(new URL(relative,root)));
      response.setHeader("Content-Type",contentTypes[fileType]);
      const body=fileType===".html"
        ?asset.toString().replace(/<script\b[^>]*\bsrc="https?:[^"]*"[^>]*>\s*<\/script>/gi,"")
          .replace(/<link\b[^>]*\bhref="https?:[^"]*"[^>]*>/gi,"")
        :asset;
      response.end(body);
    }catch(error){
      response.writeHead(error.code==="ENOENT"?404:500).end();
    }
  });
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  let driver;
  try{
    const options=new chrome.Options().addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage",
      "--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1","--window-size=1440,1000");
    const builder=new Builder().forBrowser("chrome").setChromeOptions(options);
    if(process.env.SE_CHROMEDRIVER)builder.setChromeService(new chrome.ServiceBuilder(process.env.SE_CHROMEDRIVER));
    driver=await builder.build();
    await run(driver,"http://127.0.0.1:"+server.address().port);
  }finally{
    try{
      await driver?.quit();
    }finally{
      server.closeAllConnections();
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  }
}

async function openCatalogue(driver,base) {
  await driver.get(base+"/");
  await (await driver.findElement(By.id("browseAllProducts"))).sendKeys(Key.ENTER);
  await driver.wait(until.elementLocated(By.css("[data-product-open]")),10000);
}

const seededBag=[{variant_id:variantId,quantity:2,variant_label:"Gold",product}];
function seedBag(driver) {
  return driver.executeScript("localStorage.setItem('rainbow_cart_v1',JSON.stringify(arguments[0]))",seededBag);
}
function readBag(driver) {
  return driver.executeScript("return JSON.parse(localStorage.getItem('rainbow_cart_v1'))");
}

test("keyboard shoppers retain focus after saving a design, exiting Quick View, and removing a saved design",async()=>{
  await withStorefront(async(driver,base)=>{
    await openCatalogue(driver,base);
    const savedButton=By.css("[data-wishlist-product]");
    await (await driver.findElement(savedButton)).sendKeys(Key.SPACE);
    assert.equal(await (await driver.findElement(savedButton)).getAttribute("aria-pressed"),"true");
    assert.equal(await driver.executeScript("return document.activeElement.matches('[data-wishlist-product]')"),true);

    await (await driver.findElement(By.css("[data-product-open]"))).sendKeys(Key.ENTER);
    assert.equal(await driver.executeScript(
      "return document.activeElement.matches('#productModal.open .product-modal-close')"
    ),true);
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    assert.equal(await driver.executeScript("return document.activeElement.matches('[data-product-open]')"),true);

    await (await driver.findElement(By.id("wishlistToggle"))).sendKeys(Key.ENTER);
    const heading=await driver.findElement(By.id("productHeading"));
    assert.equal(await heading.getText(),"Saved jewellery");
    const savedDesign=await driver.wait(until.elementLocated(savedButton),10000);
    await savedDesign.sendKeys(Key.SPACE);
    await driver.wait(async()=>{
      const grid=await driver.findElement(By.id("productGrid"));
      return /nothing saved/i.test(await grid.getText());
    },10000);
    assert.equal(await driver.executeScript("return document.activeElement.id"),"productHeading");
  });
});

test("Quick View declines quantities beyond remaining stock and lets a valid Buy Now update the bag",async()=>{
  await withStorefront(async(driver,base)=>{
    await openCatalogue(driver,base);
    await seedBag(driver);

    const modal=await driver.findElement(By.id("productModal"));
    await (await driver.findElement(By.css("[data-product-open]"))).sendKeys(Key.ENTER);
    await (await modal.findElement(By.css("[data-qty-plus]"))).sendKeys(Key.SPACE);
    assert.equal(await (await modal.findElement(By.css("[data-qty]"))).getText(),"2");

    for(const selector of ["[data-add-cart]","[data-buy-now]"]){
      await (await modal.findElement(By.css(selector))).sendKeys(Key.ENTER);
      assert.equal(await modal.isDisplayed(),true,"Quick View must stay open so the shopper can edit quantity");
      assert.deepEqual(await readBag(driver),seededBag,"Declining the quantity must leave the bag unchanged");
      const statusMessages=await modal.findElements(By.css("[aria-live]:not([aria-live='off']),[role='status'],[role='alert']"));
      const text=await Promise.all(statusMessages.map(status=>status.getText()));
      assert.match(text.join(" "),/\b1\b.*\b(?:more|available|remaining)\b/i);
    }

    await (await modal.findElement(By.css("[data-qty-minus]"))).sendKeys(Key.SPACE);
    await (await modal.findElement(By.css("[data-buy-now]"))).sendKeys(Key.ENTER);
    await driver.wait(until.urlMatches(/\/order\.html$/),10000);
    const bag=await readBag(driver);
    assert.equal(bag.length,1);
    assert.equal(bag[0].variant_id,variantId);
    assert.equal(bag[0].quantity,3);
  });
});

test("standalone product Buy Now preserves the bag until the requested quantity fits",async()=>{
  await withStorefront(async(driver,base)=>{
    const productUrl=base+"/product.html?sku="+encodeURIComponent(product.product_code);
    await driver.get(productUrl);
    await seedBag(driver);
    const buyButton=await driver.findElement(By.id("detailBuy"));
    await driver.wait(until.elementIsVisible(buyButton),10000);
    const quantity=await driver.findElement(By.id("detailQty"));
    await quantity.clear();
    await quantity.sendKeys("2");
    await buyButton.sendKeys(Key.ENTER);
    assert.equal(await driver.getCurrentUrl(),productUrl);
    assert.deepEqual(await readBag(driver),seededBag,"Declining the quantity must leave the bag unchanged");
    const status=await driver.findElement(By.id("detailMessage"));
    assert.match(await status.getText(),/\b1\b.*\b(?:more|available|remaining)\b/i);

    await quantity.clear();
    await quantity.sendKeys("1");
    await buyButton.sendKeys(Key.ENTER);
    await driver.wait(until.urlMatches(/\/order\.html$/),10000);
    const bag=await readBag(driver);
    assert.equal(bag.length,1);
    assert.equal(bag[0].variant_id,variantId);
    assert.equal(bag[0].quantity,3);
  });
});

test("checkout keeps the selected length, exact price, and keyboard focus while editing the bag",async()=>{
  await withStorefront(async(driver,base)=>{
    await driver.get(base+"/");
    await seedBag(driver);
    await driver.get(base+"/order.html");
    const variant=By.css(".order-item h3 + small");
    await driver.wait(async()=>/Length: 18 cm/.test(await (await driver.findElement(variant)).getText()),10000);
    assert.equal(await (await driver.findElement(variant)).getText(),"Color: Gold · Length: 18 cm • ₹122.55");
    assert.equal(await (await driver.findElement(By.css(".order-price"))).getText(),"₹245.10");
    assert.equal(await (await driver.findElement(By.id("subtotal"))).getText(),"₹245.10");

    await (await driver.findElement(By.css("[data-dec]"))).sendKeys(Key.SPACE);
    assert.equal(await (await driver.findElement(By.css(".order-price"))).getText(),"₹122.55");
    assert.equal(await driver.executeScript("return document.activeElement.matches('[data-inc]')"),true);
    assert.equal((await readBag(driver))[0].quantity,1);

    await (await driver.findElement(By.css("[data-remove]"))).sendKeys(Key.SPACE);
    assert.equal(await driver.executeScript("return document.activeElement.matches('#orderItems .empty a')"),true);
    assert.deepEqual(await readBag(driver),[]);
  });
});

test("checkout refreshes the bag after it changes in another tab",async()=>{
  await withStorefront(async(driver,base)=>{
    await driver.get(base+"/");
    await seedBag(driver);
    await driver.get(base+"/order.html");
    const checkoutTab=await driver.getWindowHandle();
    const linePrice=async()=>await (await driver.findElement(By.css(".order-price"))).getText();
    await driver.wait(async()=>await linePrice()==="₹245.10",10000);

    await driver.switchTo().newWindow("tab");
    const shoppingTab=await driver.getWindowHandle();
    await driver.get(base+"/product.html?sku="+encodeURIComponent(product.product_code));
    const addButton=await driver.findElement(By.id("detailAdd"));
    await driver.wait(until.elementIsVisible(addButton),10000);
    await addButton.sendKeys(Key.ENTER);
    assert.equal((await readBag(driver))[0].quantity,3);
    await driver.switchTo().window(checkoutTab);

    await driver.wait(async()=>await linePrice()==="₹367.65",10000);
    assert.equal(await (await driver.findElement(By.id("subtotal"))).getText(),"₹367.65");
    await (await driver.findElement(By.css("[data-dec]"))).sendKeys(Key.SPACE);
    assert.equal(await linePrice(),"₹245.10");
    await driver.switchTo().window(shoppingTab);
    assert.equal((await readBag(driver))[0].quantity,2);
  });
});
