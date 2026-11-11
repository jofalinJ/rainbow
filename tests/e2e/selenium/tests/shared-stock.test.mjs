import {test} from "node:test";
import assert from "node:assert/strict";
import {createClient} from "@supabase/supabase-js";
import {Builder,By,Key} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import {BASE_URL,ADMIN_USERNAME,ADMIN_PASSWORD,E2E_ENABLED,TEST_SUPABASE_URL,requireAuthenticatedE2EConfig} from "../configuration.mjs";
import {LoginPage} from "../pages/LoginPage.mjs";

const enabled=E2E_ENABLED&&process.env.E2E_SHARED_STOCK_ENABLED==="true";
const sku=process.env.E2E_SHARED_STOCK_SKU||"";
const cashierUsername=process.env.E2E_CASHIER_USERNAME||"";
const cashierPassword=process.env.E2E_CASHIER_PASSWORD||"";

function checkEnvironment(){
  requireAuthenticatedE2EConfig();
  assert.match(sku,/^(?:QA|E2E)[A-Z0-9_-]{3,30}$/i,"Use a synthetic staging SKU starting with QA or E2E");
  assert.ok(cashierUsername&&cashierPassword,"Shared stock E2E requires an isolated cashier account");
  assert.ok(process.env.SUPABASE_TEST_PUBLISHABLE_KEY,"Shared stock E2E requires the isolated publishable key");
}
async function data(request){
  const {data:value,error}=await request;
  assert.equal(error,null,error?.message);
  return value;
}
async function client(username,password){
  const instance=createClient(TEST_SUPABASE_URL,process.env.SUPABASE_TEST_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=username.includes("@")?username:username.toLowerCase()+"@staff.rainbow.local";
  await data(instance.auth.signInWithPassword({email,password}));
  return instance;
}
async function browser(){
  const options=new chrome.Options().addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000");
  return new Builder().forBrowser("chrome").setChromeOptions(options).build();
}
async function login(driver,username,password){
  const page=new LoginPage(driver);
  await page.open(BASE_URL,{next:"owner.html"});
  await page.signIn(username,password);
  await driver.wait(async()=>driver.findElement(By.id("ownerApp")).isDisplayed(),12000,"Quick Products did not load");
}
async function openCategories(driver,query){
  await driver.findElement(By.css('[data-screen="categories"]')).click();
  const search=await driver.findElement(By.id("categoryCatalogueSearch"));
  await search.clear();await search.sendKeys(query);
  const row=By.css(".category-product-row");
  await driver.wait(async()=>(await driver.findElements(row)).length===1,10000,"Expected one saved product");
  return driver.findElement(row);
}

test("real Supabase: owner publishes and hides one existing product without stock writes, including when sold out",{skip:!enabled},async()=>{
  checkEnvironment();
  const admin=await client(ADMIN_USERNAME,ADMIN_PASSWORD);
  assert.equal((await data(admin.rpc("erp_shared_inventory_mode"))).shared_stock,true);
  const product=await data(admin.from("products").select("id,product_code,product_variants(id,stock_quantity,active),erp_online_listings(published)").eq("product_code",sku).single());
  assert.equal(product.erp_online_listings?.published??product.erp_online_listings?.[0]?.published??false,false,"Start with an unpublished fixture");
  const variants=product.product_variants.filter(variant=>variant.active);
  assert.equal(variants.length,1);
  const variant=variants[0];
  const readStock=()=>data(admin.from("erp_stock_balances").select("location_id,on_hand,reserved").eq("variant_id",variant.id).order("location_id"));
  const locations=await data(admin.from("erp_locations").select("id,kind").eq("active",true));
  const branchIds=locations.filter(location=>location.kind==="branch").map(location=>location.id);
  const stockBefore=await readStock();
  const physical=stockBefore.filter(row=>branchIds.includes(row.location_id)&&row.on_hand>0);
  assert.ok(physical.length>=2,"Seed stock for one variant in at least two active physical shops");
  assert.ok(stockBefore.every(row=>row.reserved===0&&(branchIds.includes(row.location_id)||row.on_hand===0)));
  const available=physical.reduce((sum,row)=>sum+row.on_hand,0);
  assert.equal(variant.stock_quantity,available);
  const inventoryEvents=()=>data(admin.from("erp_stock_events").select("id").eq("variant_id",variant.id).order("id"));
  const beforeEvents=await inventoryEvents();
  const activeDriver=await browser();
  const shopper=await browser();
  const decremented=[];
  let listingChanged=false;
  const adjust=(row,delta)=>data(admin.rpc("erp_adjust_stock",{
    p_location:row.location_id,p_variant:variant.id,p_delta:delta,p_reason:"Isolated shared stock browser fixture",p_request:crypto.randomUUID()
  }));
  const openShop=async()=>{
    await shopper.get(BASE_URL+"/product.html?sku="+encodeURIComponent(sku));
    await shopper.wait(async()=>!(await shopper.findElement(By.id("productLoading")).isDisplayed()),15000);
  };
  try{
    await login(activeDriver,ADMIN_USERNAME,ADMIN_PASSWORD);
    await openShop();
    assert.match(await shopper.findElement(By.id("productError")).getText(),/unavailable or no longer listed/);
    const row=await openCategories(activeDriver,sku);
    assert.match(await row.getText(),new RegExp(`Existing shop stock: ${available} pcs`));
    assert.doesNotMatch(await row.getText(),/Add Online Stock/);
    listingChanged=true;
    await row.findElement(By.css('button[aria-label^="Show Online for "]')).click();
    await activeDriver.wait(async()=>(await activeDriver.findElements(By.css('button[aria-label^="Hide Online for "]'))).length===1,10000);
    assert.deepEqual(await readStock(),stockBefore);
    assert.deepEqual(await inventoryEvents(),beforeEvents);
    await openShop();
    assert.equal(await shopper.findElement(By.id("detailSku")).getText(),sku);
    assert.equal(await shopper.findElement(By.id("detailStock")).getText(),available+" available");
    assert.equal(await shopper.findElement(By.id("detailQty")).getAttribute("max"),String(available));
    const afterPublish=await data(admin.from("products").select("id,product_variants(id)").eq("product_code",sku).single());
    assert.deepEqual(afterPublish,{id:product.id,product_variants:[{id:variant.id}]});

    for(const entry of physical){await adjust(entry,-entry.on_hand);decremented.push(entry);}
    const emptyBalances=await readStock();
    const emptyEvents=await inventoryEvents();
    await openShop();
    assert.equal(await shopper.findElement(By.id("detailStock")).getText(),"Out of stock");
    assert.equal(await shopper.findElement(By.id("detailAdd")).isEnabled(),false);
    await activeDriver.navigate().refresh();
    await activeDriver.wait(async()=>activeDriver.findElement(By.id("ownerApp")).isDisplayed(),12000);
    const emptyRow=await openCategories(activeDriver,sku);
    assert.match(await emptyRow.getText(),/Published · unavailable/);
    await emptyRow.findElement(By.css('button[aria-label^="Hide Online for "]')).click();
    await activeDriver.wait(async()=>(await activeDriver.findElements(By.css('button[aria-label^="Show Online for "]'))).length===1,10000);
    listingChanged=false;
    assert.deepEqual(await readStock(),emptyBalances);
    assert.deepEqual(await inventoryEvents(),emptyEvents);
    await openShop();
    assert.match(await shopper.findElement(By.id("productError")).getText(),/unavailable or no longer listed/);
  }finally{
    try{
      if(listingChanged)await data(admin.from("erp_online_listings").update({published:false}).eq("product_id",product.id));
    }finally{
      try{for(const entry of decremented)await adjust(entry,entry.on_hand);}
      finally{await Promise.all([activeDriver.quit(),shopper.quit()]);}
    }
  }
  assert.deepEqual(await readStock(),stockBefore);
});

test("real Supabase: cashier saves a private draft with counted opening stock at the assigned shop",{skip:!enabled},async()=>{
  checkEnvironment();
  const cashier=await client(cashierUsername,cashierPassword);
  assert.equal((await data(cashier.rpc("erp_shared_inventory_mode"))).shared_stock,true);
  const shops=await data(cashier.from("erp_locations").select("id").eq("kind","branch").eq("active",true));
  assert.equal(shops.length,1,"Cashier fixture must have one assigned shop");
  const admin=await client(ADMIN_USERNAME,ADMIN_PASSWORD);
  const draftName="QA draft "+crypto.randomUUID();
  const driver=await browser();
  try{
    await login(driver,cashierUsername,cashierPassword);
    const field=id=>driver.findElement(By.id(id));
    assert.equal(await (await field("publishNow")).isDisplayed(),false);
    await (await field("ownerName")).sendKeys(draftName);
    const categoryOptions=await driver.findElements(By.css('#ownerCategory option[value]:not([value=""])'));
    assert.ok(categoryOptions.length>0);
    await categoryOptions[0].click();
    await (await field("ownerPrice")).sendKeys("450");
    const details=await driver.findElement(By.css("#ownerMoreDetails summary"));
    await driver.executeScript("arguments[0].scrollIntoView({block:'center'});",details);
    await details.sendKeys(Key.ENTER);
    await (await field("ownerStock")).clear();
    await (await field("ownerStock")).sendKeys("2");
    const source=await field("ownerSource");
    const option=await source.findElement(By.css(`option[value="${shops[0].id}"]`));
    await option.click();
    assert.equal(await driver.executeScript("return arguments[0].value;",source),shops[0].id);
    const counted=await field("ownerStockConfirm");
    await counted.sendKeys(Key.SPACE);
    assert.equal(await counted.isSelected(),true);
    await (await field("saveDraft")).sendKeys(Key.ENTER);
    try{
      await driver.wait(async()=>await (await field("screen-categories")).isDisplayed(),12000,"Cashier draft did not save");
    }catch(error){
      assert.fail("Cashier draft did not save: "+await (await field("editMessage")).getText()+" ("+error.name+")");
    }
    assert.equal((await driver.findElements(By.css('.category-product-actions button[aria-label^="Show Online"]'))).length,0);
    const saved=await data(admin.from("products").select("id,product_code,product_variants(id,stock_quantity),erp_online_listings(published)").eq("product_name",draftName).single());
    assert.equal(saved.erp_online_listings?.published??saved.erp_online_listings?.[0]?.published??false,false);
    assert.equal(saved.product_variants.length,1);
    assert.equal(saved.product_variants[0].stock_quantity,2);
    assert.deepEqual(await data(admin.from("erp_stock_balances").select("location_id,on_hand,reserved").eq("variant_id",saved.product_variants[0].id)),[
      {location_id:shops[0].id,on_hand:2,reserved:0}
    ]);
    const anonymous=createClient(TEST_SUPABASE_URL,process.env.SUPABASE_TEST_PUBLISHABLE_KEY,{auth:{persistSession:false}});
    assert.deepEqual(await data(anonymous.from("products").select("id").eq("id",saved.id)),[]);
  }finally{await driver.quit();}
});
