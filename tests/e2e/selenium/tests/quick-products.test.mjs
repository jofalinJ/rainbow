import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Builder,By} from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

// Entire test is localhost-only. Supabase Auth, REST, Storage and ERP are
// fake objects in the browser; this never touches the merchant database.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../..");
const categoryId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function browserFixture(){
 const role=new URLSearchParams(globalThis.location.search).get("role")==="admin"?"admin":"cashier";
 const categories=[{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",name:"Chain",code_prefix:"CH",has_color:false,has_size:false,has_length:false,storefront_order:1,active:true,show_in_storefront:true}];
 const locations=[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",name:"Fixture shop",kind:"branch",active:true}];
 if(role==="admin")locations.push({id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",name:"Online Store",kind:"online",active:true});
 const products=[],writes=[],uploadPaths=[],balances=[],transfers=[];
 const seed=new URLSearchParams(globalThis.location.search).get("seed");
 if(role==="admin"&&(seed==="online"||seed==="shop")){
  const variantId="ffffffff-ffff-4fff-8fff-fffffffffff1";
  products.push({
   id:"ffffffff-ffff-4fff-8fff-fffffffffff0",product_code:"QATEST00001",
   product_name:"Fixture saved chain",selling_price:450,category_id:categories[0].id,
   active:true,archived_at:null,created_at:new Date().toISOString(),
   product_images:[{id:"ffffffff-ffff-4fff-8fff-fffffffffff2",public_url:"https://example.invalid/chain.webp",is_primary:true,sort_order:0}],
   product_variants:[{id:variantId,product_id:"ffffffff-ffff-4fff-8fff-fffffffffff0",active:true,color:"0",size:"0",stock_quantity:seed==="online"?2:0}],
   erp_online_listings:[]
  });
  balances.push(
   {location_id:locations[0].id,variant_id:variantId,on_hand:seed==="shop"?3:0,reserved:0},
   {location_id:locations[1].id,variant_id:variantId,on_hand:seed==="online"?2:0,reserved:0}
  );
 }
 let next=1;
 const staff=[{user_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",active:true,archived_at:null,role}];
 const state={role,products,writes,uploadPaths,categories,locations,balances,transfers};
 globalThis.__qa=state;
 const dataResult=data=>({data,error:null});
 const allRows=name=>{
  if(name==="categories")return categories;
  if(name==="erp_locations")return locations;
  if(name==="products")return products;
  if(name==="staff_profiles")return staff;
  if(name==="erp_stock_balances")return balances;
  if(name==="erp_online_listings")return products.flatMap(p=>p.erp_online_listings);
  if(name==="product_images")return products.flatMap(p=>p.product_images);
  if(name==="product_variants")return products.flatMap(p=>p.product_variants);
  throw new Error("Unexpected fixture table "+name);
 };
 function query(table){
  const q={table,action:"read",filters:[],values:null,
   select(){return q;},
   eq(key,value){q.filters.push([key,value]);return q;},
   order(){return q;},
   range(start,end){return Promise.resolve(dataResult(allRows(table).filter(match).slice(start,end+1)));},
   insert(values){q.action="insert";q.values=values;return q;},
   update(values){q.action="update";q.values=values;return q;},
   upsert(values){q.action="upsert";q.values=values;return q;},
   delete(){q.action="delete";return q;},
   single(){return Promise.resolve(run(true));},
   maybeSingle(){return Promise.resolve(run(true));},
   then(resolve,reject){return Promise.resolve().then(()=>run(false)).then(resolve,reject);}
  };
  const match=row=>q.filters.every(([key,value])=>row[key]===value);
  function run(one){
   if(q.action==="read"){const rows=allRows(table).filter(match);return dataResult(one?rows[0]||null:rows);}
   writes.push({table,action:q.action,values:structuredClone(q.values)});
   if(q.action==="insert"){
    const raw=Array.isArray(q.values)?q.values:[q.values];
    const added=raw.map(values=>{
     const row={...values,id:"00000000-0000-4000-8000-"+String(next++).padStart(12,"0")};
     if(table==="products"){
      row.product_code=row.product_code||"QATEST"+String(next).padStart(5,"0");
      row.product_images=[];row.product_variants=[];row.erp_online_listings=[];
      products.push(row);
     }else if(table==="product_variants"){
      const parent=products.find(p=>p.id===values.product_id);if(!parent)throw Error("Missing fixture product");
      parent.product_variants.push(row);
     }else if(table==="product_images"){
      const parent=products.find(p=>p.id===values.product_id);if(!parent)throw Error("Missing fixture product");
      parent.product_images.push(row);
     }else throw Error("Unexpected insert "+table);
     return row;
    });
    return dataResult(one?added[0]:added);
   }
   if(q.action==="update"){
    const rows=allRows(table).filter(match);
    for(const row of rows)Object.assign(row,q.values);
    return dataResult(one?rows[0]||null:rows);
   }
   if(q.action==="upsert"&&table==="erp_online_listings"){
    const item=q.values,parent=products.find(p=>p.id===item.product_id);
    if(!parent)throw Error("Missing product for publication");
    const row=parent.erp_online_listings[0];
    if(row)Object.assign(row,item);else parent.erp_online_listings.push({...item});
    return dataResult([item]);
   }
   if(q.action==="delete")return dataResult([]);
   throw Error("Unexpected action "+q.action+" on "+table);
  }
  return q;
 }
 const client={
  auth:{getUser:async()=>dataResult({user:{id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}}),signOut:async()=>dataResult(null)},
  from:query,
  storage:{from:()=>({
   createSignedUploadUrl:async item=>dataResult({path:item,token:"local-fixture-token"}),
   uploadToSignedUrl:async item=>{uploadPaths.push(item);return dataResult({path:item});},
   getPublicUrl:item=>dataResult({publicUrl:"https://example.invalid/"+item}),
   remove:async()=>dataResult([])
  })},
  rpc:async(name,params)=>{
    if(name==="erp_dispatch_transfer"&&role==="admin"){
     const src=balances.find(b=>b.location_id===params.p_from&&b.variant_id===params.p_variant);
     if(!src||params.p_quantity>src.on_hand-src.reserved)throw Error("Fixture cannot transfer uncounted stock");
     src.on_hand-=params.p_quantity;
     const id="local-transfer-"+transfers.length;
     transfers.push({id,params});
     return dataResult({state:"dispatched",transfer_id:id});
    }
    if(name==="erp_receive_transfer"&&role==="admin"){
     const transfer=transfers.find(t=>t.id===params.p_transfer);
     if(!transfer)throw Error("Unknown fixture transfer");
     const to=balances.find(b=>b.location_id===transfer.params.p_to&&b.variant_id===transfer.params.p_variant);
     if(!to)throw Error("Missing destination stock location");
     to.on_hand+=transfer.params.p_quantity;
     const variant=products.flatMap(p=>p.product_variants).find(v=>v.id===transfer.params.p_variant);
     variant.stock_quantity=balances.find(b=>b.location_id===locations.find(l=>l.kind==="online").id&&b.variant_id===variant.id).on_hand;
     return dataResult({state:"received",transfer_id:transfer.id});
    }
    throw Error("Unexpected ERP fixture RPC: "+name);
   }
 };
 globalThis.RAINBOW_SUPABASE_CONFIG={supabaseUrl:"https://example.invalid",supabasePublishableKey:"fixture-not-a-secret"};
 globalThis.supabase={createClient:()=>client};
}
async function serve(){
 const server=createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,"http://127.0.0.1").pathname;
   res.setHeader("Cache-Control","no-store");
   res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'");
   if(pathname==="/admin/owner.html"){
    let html=await fs.readFile(path.join(root,"admin/owner.html"),"utf8");
    html=html.replace('<script src="config.js"></script>','<script defer src="/__fixture/bootstrap.js"></script>')
      .replace(/<script defer src="https:\/\/cdn\.jsdelivr\.net[^"]+"><\/script>/,"");
    res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);return;
   }
   if(pathname==="/__fixture/bootstrap.js"){
    res.setHeader("Content-Type","text/javascript");
    res.end("("+browserFixture.toString()+")();");return;
   }
   if(pathname==="/admin/image-prep.js"){
    res.setHeader("Content-Type","text/javascript");
    res.end("window.RainbowImagePrep={prepare:async()=>null};");return;
   }
   const allowed=new Set(["/admin/owner.js","/admin/owner.css","/assets/brand/rainbow-logo.png"]);
   if(allowed.has(pathname)){
    res.setHeader("Content-Type",pathname.endsWith(".css")?"text/css":pathname.endsWith(".png")?"image/png":"text/javascript");
    res.end(await fs.readFile(path.join(root,pathname)));return;
   }
   res.statusCode=404;res.end("Fixture route unavailable");
  }catch(error){res.statusCode=500;res.end(error.message);}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 return {base:"http://127.0.0.1:"+server.address().port,
  close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
test("Quick Products is photo-first; staff can save a draft on a 390px screen with no stock or online write",async()=>{
 const fixture=await serve();
 const options=new chrome.Options().addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage",
  "--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1","--window-size=390,850");
 let driver;
 try{
  driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  await driver.manage().window().setRect({width:390,height:850});
  await driver.get(fixture.base+"/admin/owner.html?role=staff");
  const field=id=>driver.findElement(By.id(id));
  await driver.wait(async()=>await (await field("ownerApp")).isDisplayed(),12000);
  assert.equal(await (await field("startup")).isDisplayed(),false,"Login loading message must disappear");
  assert.equal(await (await field("screen-editor")).isDisplayed(),true,"Quick Add must open first");
  assert.equal(await (await field("ownerMoreDetails")).getAttribute("open"),null,"Stock options should begin folded");
  assert.equal(await (await field("publishNow")).isDisplayed(),false,"Staff should never be offered admin publishing");
  assert.equal(await (await field("saveDraft")).getText(),"Save product for approval");
  assert.ok(!(await driver.findElement(By.tagName("body")).getText()).includes("Salesforce"));
  const width=await driver.executeScript("return document.documentElement.scrollWidth");
  assert.ok(width<=390+2,"Quick add must not overflow the 390px viewport");

  const photoInput=await field("productPhotos");
  await driver.executeScript(input=>{
   const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],"chain.png",{type:"image/png"});
   const data=new globalThis.DataTransfer();data.items.add(file);input.files=data.files;
   input.dispatchEvent(new Event("change",{bubbles:true}));
  },photoInput);
  assert.equal((await driver.findElements(By.css("#photoGallery .photo-tile"))).length,1);
  await (await field("ownerName")).sendKeys("Fixture gold covering chain");
  assert.equal(await (await field("ownerCategory")).getAttribute("value"),categoryId);
  await (await field("ownerPrice")).sendKeys("450");
  await (await field("saveDraft")).click();
  await driver.wait(async()=>await (await field("screen-categories")).isDisplayed(),15000);
  assert.equal((await driver.findElements(By.css(".category-product-row"))).length,1);
  assert.match(await (await field("categoryCatalogueList")).getText(),/Fixture gold covering chain/);
  assert.match(await (await field("categoryCatalogueList")).getText(),/Not online/);
  assert.match(await (await field("categoryCatalogueList")).getText(),/Owner controls online visibility/);
  assert.equal((await driver.findElements(By.css(".category-product-actions button.primary"))).length,0,
   "Staff must not be offered a privileged Show Online action");
  const data=await driver.executeScript("return globalThis.__qa");
  assert.equal(data.products.length,1);
  assert.equal(data.products[0].product_images.length,1);
  assert.equal(data.products[0].product_variants[0].stock_quantity,0);
  assert.equal(data.writes.filter(w=>w.table==="erp_online_listings").length,0);
  assert.equal(data.writes.filter(w=>w.table==="erp_stock_balances").length,0);
  assert.equal(data.products[0].selling_price,450);
  assert.equal((await driver.findElements(By.css("#ownerToast .toast-actions button"))).length,1);
  await driver.findElement(By.css("#ownerToast .toast-actions button")).click();
  assert.equal(await (await field("ownerName")).getAttribute("value"),"");
  assert.equal(await (await field("ownerCategory")).getAttribute("value"),categoryId);
 }finally{if(driver)await driver.quit();await fixture.close();}
});

test("owner Show Online publishes counted stock and Hide Online safely reverses it",async()=>{
 const fixture=await serve();
 const options=new chrome.Options().addArguments("--headless=new","--no-sandbox","--disable-dev-shm-usage",
  "--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1","--window-size=390,850");
 let driver;
 try{
  driver=await new Builder().forBrowser("chrome").setChromeOptions(options).build();
  await driver.manage().window().setRect({width:390,height:850});
  const field=id=>driver.findElement(By.id(id));
  const categories=()=>driver.findElement(By.css('[data-screen="categories"]'));
  const action=label=>driver.findElement(By.xpath("//div[contains(@class,'category-product-actions')]/button[contains(text(),'"+label+"')]"));
  const openCategory=async()=>{
   await driver.wait(async()=>await (await field("ownerApp")).isDisplayed(),12000);
   await driver.executeScript("arguments[0].click()",await categories());
   await driver.wait(async()=>await (await field("categoryCatalogueList")).isDisplayed(),6000);
   assert.equal((await driver.findElements(By.css(".category-product-row"))).length,1);
  };
  await driver.get(fixture.base+"/admin/owner.html?role=admin&seed=online");
  await openCategory();
  await (await action("Show Online")).click();
  await driver.wait(async()=>/Visible online/.test(await (await field("categoryCatalogueList")).getText()),10000);
  let data=await driver.executeScript("return globalThis.__qa");
  assert.equal(data.transfers.length,0,"Existing online stock must not be received twice");
  assert.ok(data.writes.some(w=>w.table==="erp_online_listings"&&w.values.published===true));

  await driver.get(fixture.base+"/admin/owner.html?role=admin&seed=shop");
  await openCategory();
  await (await action("Show Online")).click();
  await driver.wait(async()=>await (await field("onlineVisibilityDialog")).isDisplayed(),10000);
  data=await driver.executeScript("return globalThis.__qa");
  assert.equal(data.writes.filter(w=>w.table==="erp_online_listings").length,0,
   "Product must stay unpublished until stock transfer succeeds");
  assert.equal(data.transfers.length,0,"Opening the dialog must not mutate stock");
  await (await field("onlineVisibilityConfirm")).click();
  await driver.wait(async()=>/Visible online/.test(await (await field("categoryCatalogueList")).getText()),10000);
  data=await driver.executeScript("return globalThis.__qa");
  assert.equal(data.transfers.length,1);
  assert.equal(data.transfers[0].params.p_quantity,1);
  assert.equal(data.balances.find(b=>b.location_id==="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").on_hand,2);
  assert.equal(data.balances.find(b=>b.location_id==="cccccccc-cccc-4ccc-8ccc-cccccccccccc").on_hand,1);
  assert.ok(data.writes.some(w=>w.table==="erp_online_listings"&&w.values.published===true));
  await (await action("Hide Online")).click();
  await driver.wait(async()=>/Not online/.test(await (await field("categoryCatalogueList")).getText()),10000);
  data=await driver.executeScript("return globalThis.__qa");
  assert.equal(data.transfers.length,2,"Hide Online returns stock to the physical shop");
  assert.ok(data.writes.some(w=>w.table==="erp_online_listings"&&w.values.published===false));
 }finally{if(driver)await driver.quit();await fixture.close();}
});
