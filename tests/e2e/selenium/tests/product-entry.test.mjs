import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Builder,By} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

// This suite serves the real product HTML, CSS, and scripts locally. Authentication
// and REST boundaries are fixtures: no credentials or production URL are used.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../..");
const artifacts=path.join(root,"test-results/selenium");
const categoryId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const existingId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const shopOne="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const shopTwo="dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function fixtureState(mode){
  return {
    mode,writes:[],receipts:new Map(),receiptAttempts:[],
    categories:[{id:categoryId,name:"Bracelet",active:true,has_color:true,has_size:false,has_length:false}],
    shops:mode==="no-shops"?[]:[
      {id:shopOne,name:"Fixture Shop One",kind:"branch",active:true},
      {id:shopTwo,name:"Fixture Shop Two",kind:"branch",active:true}
    ],
    products:[{id:existingId,product_code:"FIXTURE-EXISTING",product_name:"Fixture Bracelet",
      category_id:categoryId,type:"Chain",gender:"women",active:true,selling_price:100,
      product_images:[],product_variants:[{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        color:"Red",size:"0",length_cm:null,stock_quantity:0,active:true}]}]
  };
}

function bootstrapFixture(){
  const scope=globalThis;
  scope.RAINBOW_MULTI_SHOP_ENABLED=true;
  const admin=new URLSearchParams(scope.location.search).get("fixture")==="admin";
  scope.getMyProfile=async()=>({active:true,role:admin?"admin":"cashier"});
  const localFetch=scope.fetch.bind(scope);
  scope.fetch=(url,options)=>{
    const target=new URL(url,scope.location.href);
    if(target.origin!==scope.location.origin)throw new Error("Fixture forbids external requests");
    return localFetch(target,options);
  };
  scope.sb=async(resource,options={})=>{
    const response=await scope.fetch("/__fixture/api?resource="+encodeURIComponent(resource),options);
    const body=await response.json();
    if(!response.ok)throw new Error(body.message||"Fixture REST failure");
    return body;
  };
  scope.bootSupabase=()=>({
    rpc:async(name,params)=>{
      if(name==="erp_shared_inventory_mode")return {data:{shared_stock:false},error:null};
      try{return {data:await scope.sb("rpc/"+name,{method:"POST",body:JSON.stringify(params)}),error:null};}
      catch(error){return {data:null,error};}
    },
    from:table=>{
      const filters=[];
      let search="";
      const query={
        select(){return query;},order(){return query;},range(){return query;},
        eq(column,value){filters.push([column,value]);return query;},
        async maybeSingle(){const result=await query;return {data:result.data[0]??null,error:result.error};},
        or(expression){search=expression.split(".ilike.%")[1]?.split("%")[0]||"";return query;},
        then(resolve,reject){
          return scope.sb(table+"?fixture-read=true").then(rows=>{
            const data=rows.filter(row=>filters.every(([column,value])=>row[column]===value)&&
              (!search||["product_code","product_name","type"].some(column=>String(row[column]||"").toLowerCase().includes(search.toLowerCase()))));
            return {data,error:null,count:data.length};
          }).then(resolve,reject);
        }
      };
      return query;
    }
  });
}

async function startFixture(){
  let state=fixtureState("normal");
  const allowed=new Set([
    "/admin/products.js","/admin/catalogue-ops.js","/admin/product-opening-stock.mjs",
    "/src/domain/productRules.mjs","/src/domain/variantRules.mjs",
    "/admin/style.css","/admin/products-editor.css","/admin/premium.css","/design-system.css",
    "/assets/brand/rainbow-logo.png"
  ]);
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,"http://127.0.0.1");
      response.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'");
      response.setHeader("Cache-Control","no-store");
      if(url.pathname==="/admin/products.html"){
        state=fixtureState(url.searchParams.get("fixture")||"normal");
        let html=await fs.readFile(path.join(root,"admin/products.html"),"utf8");
        html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"")
          .replace(/<link\b[^>]*href="https?:[^>]*>/gi,"")
          .replace("</body>",'<script src="/__fixture/bootstrap.js"></script><script src="catalogue-ops.js"></script><script src="products.js"></script></body>');
        response.setHeader("Content-Type","text/html; charset=utf-8");response.end(html);return;
      }
      if(url.pathname==="/__fixture/bootstrap.js"){
        response.setHeader("Content-Type","text/javascript");response.end("("+bootstrapFixture.toString()+")();");return;
      }
      if(url.pathname==="/__fixture/api"){
        const resource=url.searchParams.get("resource"),table=resource.split("?")[0];
        response.setHeader("Content-Type","application/json");
        if(request.method==="GET"){
          const rows=table==="categories"?state.categories:table==="erp_locations"?state.shops:table==="products"?state.products:table==="erp_online_listings"?[]:null;
          if(!rows)throw new Error("Unexpected fixture read: "+resource);
          response.end(JSON.stringify(rows));return;
        }
        let text="";for await(const chunk of request)text+=chunk;
        const body=JSON.parse(text);state.writes.push({resource,body,method:request.method});
        if(table==="products"&&request.method==="POST"){
          const product={...body,id:"fixture-product-"+state.products.length,product_code:"FIXTURE-NEW-"+state.products.length,product_images:[],product_variants:[]};
          state.products.push(product);response.end(JSON.stringify([product]));return;
        }
        if(table==="products"&&request.method==="PATCH"){
          const id=new URLSearchParams(resource.split("?")[1]).get("id").replace(/^eq\./,"");
          const product=state.products.find(row=>row.id===id);
          assert.ok(product,"Only an existing fixture product can be edited");
          Object.assign(product,body);response.end(JSON.stringify([product]));return;
        }
        if(table==="product_variants"&&request.method==="POST"){
          assert.equal(body.stock_quantity,0,"ERP variant creation must not publish branch stock online");
          const product=state.products.find(row=>row.id===body.product_id);
          assert.ok(product,"Variant belongs to a saved fixture product");
          const variant={...body,id:"fixture-variant-"+state.writes.length,active:true};
          product.product_variants.push(variant);response.end(JSON.stringify([variant]));return;
        }
        if(table==="rpc/erp_adjust_stock"){
          state.receiptAttempts.push(body);
          assert.ok(state.shops.some(shop=>shop.id===body.p_location),"Only assigned fixture shops are allowed");
          assert.ok(body.p_delta>0&&body.p_delta<=100000);
          const alreadyApplied=state.receipts.has(body.p_request);
          if(!alreadyApplied)state.receipts.set(body.p_request,body);
          if(state.mode==="lost-receipt-response"&&state.receiptAttempts.length===1){
            response.statusCode=503;response.end(JSON.stringify({message:"Receipt response lost"}));return;
          }
          response.end(JSON.stringify({stock:body.p_delta,already_applied:alreadyApplied}));return;
        }
        throw new Error("Unexpected fixture write: "+resource);
      }
      if(allowed.has(url.pathname)){
        if(url.pathname==="/admin/product-opening-stock.mjs"&&state.mode==="delayed-helper"){
          state.helperRequested=true;
          await new Promise(resolve=>{state.releaseHelper=resolve;});
        }
        const extension=path.extname(url.pathname);
        response.setHeader("Content-Type",extension===".css"?"text/css":extension===".png"?"image/png":"text/javascript");
        response.end(await fs.readFile(path.join(root,url.pathname)));return;
      }
      response.statusCode=404;response.end("Fixture route unavailable");
    }catch(error){response.statusCode=500;response.end(JSON.stringify({message:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {base:"http://127.0.0.1:"+server.address().port,state:()=>state,
    close:()=>{state.releaseHelper?.();return new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}

test("staff product entry accepts opening stock safely using only local fixtures",async context=>{
  const fixture=await startFixture();
  const options=new chrome.Options().addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage",
    "--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1","--window-size=1440,1000");
  let driver;
  try{
    driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
    const field=id=>driver.findElement(By.id(id));
    const open=async(mode="normal")=>{
      await driver.get(fixture.base+"/admin/products.html?fixture="+mode);
      await driver.wait(async()=>/matching products/.test(await (await field("adminCatalogMessage")).getText()),10000);
    };
    const enter=async(id,value)=>{const input=await field(id);await input.clear();await input.sendKeys(String(value));};
    const chooseShop=()=>driver.findElement(By.css('#openingStockShop option[value="'+shopTwo+'"]')).click();
    const fillProduct=async(quantity)=>{await enter("name","Fixture new bracelet");await enter("price","125");await enter("stock",quantity);};
    const submitProduct=async()=>{await (await field("saveProductBtn")).click();};
    const waitMessage=pattern=>driver.wait(async()=>pattern.test(await (await field("msg")).getText()),10000);
    const writes=table=>fixture.state().writes.filter(row=>row.resource===table);

    await context.test("an admin can open the online listing and see how to allocate stock",async()=>{
      await open("admin");
      assert.equal(await (await field("onlineListingDialog")).isDisplayed(),false);
      await driver.findElement(By.css('[data-online-product]')).click();
      await driver.wait(async()=>await (await field("onlineListingDialog")).isDisplayed(),5000);
      assert.match(await (await field("onlineListingDialog")).getText(),/Online Store.*confirm receipt/);
      await (await field("closeOnlineListing")).click();
      assert.equal(fixture.state().writes.length,0);
    });

    await context.test("Initial stock is editable by keyboard and received in the selected shop",async()=>{
      await open();
      assert.equal(await (await field("stock")).getAttribute("readonly"),null);
      await fillProduct(25);await chooseShop();
      assert.equal(await (await field("stock")).getAttribute("value"),"25");
      await fs.mkdir(artifacts,{recursive:true});
      await driver.executeScript(element=>element.scrollIntoView({block:"center"}),await field("stock"));
      await fs.writeFile(path.join(artifacts,"product-entry-editable.png"),await driver.takeScreenshot(),"base64");
      await submitProduct();await waitMessage(/^Saved /);
      assert.equal(writes("products").length,1);assert.equal(writes("product_variants").length,1);
      assert.equal(writes("product_variants")[0].body.stock_quantity,0);
      assert.equal(fixture.state().receiptAttempts.length,1);
      assert.equal(fixture.state().receiptAttempts[0].p_location,shopTwo);
      assert.equal(fixture.state().receiptAttempts[0].p_delta,25);
    });

    await context.test("existing-product variants accept stock without changing existing variants",async()=>{
      await open();await (await field("existingBtn")).click();
      await driver.findElement(By.css('#existingProduct option[value="'+existingId+'"]')).click();
      assert.equal(await (await field("existingStock")).getAttribute("readonly"),null);
      await enter("existingColor","Blue");await enter("existingStock",10);await chooseShop();
      await (await field("saveVariantBtn")).click();await waitMessage(/^Saved a new variant/);
      assert.equal(writes("products").length,0);assert.equal(writes("product_variants").length,1);
      assert.equal(writes("product_variants")[0].body.stock_quantity,0);
      assert.equal(fixture.state().products[0].product_variants[0].color,"Red");
      assert.equal(fixture.state().receiptAttempts[0].p_delta,10);
      assert.equal(fixture.state().receiptAttempts[0].p_location,shopTwo);
    });

    await context.test("positive opening stock requires an assigned shop before any product is written",async()=>{
      await open("no-shops");await fillProduct(25);await submitProduct();
      await waitMessage(/assigned shop|shop access/);
      assert.equal(fixture.state().writes.length,0);
    });

    await context.test("zero-stock drafts remain saveable without an assigned shop",async()=>{
      await open("no-shops");await fillProduct(0);await (await field("active")).click();
      await submitProduct();await waitMessage(/^Saved /);
      assert.equal(writes("products")[0].body.active,false);
      assert.equal(writes("product_variants")[0].body.stock_quantity,0);
      assert.equal(fixture.state().receiptAttempts.length,0);
    });

    await context.test("a draft with positive opening stock fails before writing",async()=>{
      await open();await fillProduct(25);await chooseShop();await (await field("active")).click();
      await submitProduct();await waitMessage(/Make the product active/);
      assert.equal(fixture.state().writes.length,0);
    });

    await context.test("editing product details leaves existing stock untouched",async()=>{
      await open();
      await driver.findElement(By.css('[data-edit-product="'+existingId+'"]')).click();
      assert.equal(await (await field("stock")).isEnabled(),false);
      assert.equal(await (await field("openingStockShopField")).isDisplayed(),false);
      await enter("name","Updated fixture bracelet");
      await submitProduct();await waitMessage(/^Updated /);
      assert.equal(fixture.state().writes.length,1);
      const update=fixture.state().writes[0];
      assert.equal(update.method,"PATCH");
      assert.equal(update.resource,"products?id=eq."+existingId);
      assert.equal(Object.hasOwn(update.body,"stock_quantity"),false);
      assert.equal(writes("product_variants").length,0);
      assert.equal(fixture.state().receiptAttempts.length,0);
    });

    await context.test("a lost receipt response retries the same variant and request once",async()=>{
      await open("lost-receipt-response");await fillProduct(25);await chooseShop();
      await submitProduct();await waitMessage(/already saved.*incomplete/);
      assert.equal(writes("products").length,1);assert.equal(writes("product_variants").length,1);
      assert.equal(await (await field("stock")).isEnabled(),false);
      await submitProduct();await waitMessage(/^Saved /);
      assert.equal(writes("products").length,1);assert.equal(writes("product_variants").length,1);
      assert.equal(fixture.state().receipts.size,1);
      assert.equal(fixture.state().receiptAttempts.length,2);
      assert.deepEqual(fixture.state().receiptAttempts[0],fixture.state().receiptAttempts[1]);
      assert.equal(await (await field("stock")).isEnabled(),true);
    });

    await context.test("catalogue search cannot change a pending variant receipt or unlock its fields",async()=>{
      await open("lost-receipt-response");await (await field("existingBtn")).click();
      await driver.findElement(By.css('#existingProduct option[value="'+existingId+'"]')).click();
      await enter("existingColor","Blue");await enter("existingStock",10);await chooseShop();
      await (await field("saveVariantBtn")).click();await waitMessage(/already saved.*incomplete/);
      assert.equal(await (await field("existingStock")).isEnabled(),false);
      assert.equal(await (await field("openingStockShop")).isEnabled(),false);
      await enter("search","no-fixture-match");
      await driver.wait(async()=>/0 matching products/.test(await (await field("adminCatalogMessage")).getText()),10000);
      assert.equal(await (await field("existingStock")).isEnabled(),false);
      assert.equal(await (await field("existingStock")).getAttribute("value"),"10");
      assert.equal(await (await field("existingProduct")).getAttribute("value"),existingId);
      assert.equal(await (await field("openingStockShop")).isEnabled(),false);
      assert.equal(await (await field("openingStockShop")).getAttribute("value"),shopTwo);
      assert.equal(await (await field("saveVariantBtn")).isEnabled(),true);
      await (await field("saveVariantBtn")).click();await waitMessage(/^Saved a new variant/);
      assert.equal(writes("products").length,0);assert.equal(writes("product_variants").length,1);
      assert.equal(fixture.state().receipts.size,1);
      assert.equal(fixture.state().receiptAttempts.length,2);
      assert.deepEqual(fixture.state().receiptAttempts[0],fixture.state().receiptAttempts[1]);
      assert.equal(await (await field("existingStock")).isEnabled(),true);
    });

    await context.test("product entry locks its mode and fields while the stock helper loads",async()=>{
      await open("delayed-helper");await fillProduct(25);await chooseShop();
      await submitProduct();
      try{
        await driver.wait(()=>fixture.state().helperRequested===true,10000);
        assert.equal(await (await field("existingBtn")).isEnabled(),false);
        assert.equal(await (await field("stock")).isEnabled(),false);
        assert.equal(await (await field("name")).isEnabled(),false);
        assert.equal(await (await field("openingStockShop")).isEnabled(),false);
        assert.equal(await (await field("existingBox")).isDisplayed(),false);
        assert.equal(await (await field("stock")).getAttribute("value"),"25");
      }finally{fixture.state().releaseHelper?.();}
      await waitMessage(/^Saved /);
      assert.equal(writes("products").length,1);assert.equal(writes("product_variants").length,1);
      assert.equal(fixture.state().receiptAttempts[0].p_delta,25);
      assert.equal(fixture.state().receiptAttempts[0].p_location,shopTwo);
    });
  }catch(error){
    if(driver){await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(path.join(artifacts,"product-entry-failure.png"),await driver.takeScreenshot(),"base64");}
    throw error;
  }finally{
    if(driver)await driver.quit();
    await fixture.close();
  }
});
