import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {createContext,runInContext} from "node:vm";
import {webcrypto} from "node:crypto";
import * as openingStockTools from "../../admin/product-opening-stock.mjs";

const source=readFileSync(new URL("../../admin/products.js",import.meta.url),"utf8");
const fixture=readFileSync(new URL("../fixtures/product-editor-browser.js",import.meta.url),"utf8");
const product={id:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",product_code:"QA00001",active:true};
const variantId="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const shop={id:"22222222-2222-4222-8222-222222222222",name:"QA Thuckalay",kind:"branch",active:true};

function harness(){
  const nodes=new Map(),storage=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:"",className:""});return nodes.get(id);};
  const context=createContext({URL,URLSearchParams,Request,Response,crypto:webcrypto,console,
    location:{search:"?fixtureRole=cashier&failStock=1",href:"http://127.0.0.1:8848/admin/products.html?fixtureRole=cashier&failStock=1"},
    document:{addEventListener(){},getElementById:node},
    sessionStorage:{setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)},
    fetch:vi.fn(()=>{throw new Error("Unexpected external request");}),
    variantMessage:vi.fn(),resetEditor:vi.fn(),load:vi.fn(async()=>{}),fillExistingProducts:vi.fn(),updateExistingVariantFields:vi.fn(),
    getAuthUser:async()=>({id:"qa-user"}),testing:{openingStockTools}
  });
  context.window=context;
  runInContext(fixture,context);
  const client=context.supabase.createClient();
  context.bootSupabase=()=>client;
  const calls=[];
  context.sb=async(path,options={})=>{
    calls.push({path,options});
    if(options.method==="POST"){
      const body=JSON.parse(options.body),existing=await client.from(path).eq("id",body.id).maybeSingle();
      if(existing.data)throw new Error(JSON.stringify({code:"23505",message:"Duplicate primary key"}));
    }
    const response=await context.fetch("https://product-editor-fixture.invalid/rest/v1/"+path,options);
    const body=await response.json();if(!response.ok)throw new Error(body.message);return body;
  };
  // Run the actual recovery functions independently of page rendering/init.
  runInContext(source.slice(0,source.indexOf("const findCurrentProduct=")),context);
  const insertStart=source.indexOf("async function insertProductRecord(");
  runInContext(source.slice(insertStart,source.indexOf('$("form").onsubmit=',insertStart)),context);
  runInContext('openingStockTools=testing.openingStockTools; openingStockKey="qa-user"; productInsertKey="rainbow_product_insert_v1:qa-user";',context);
  return {context,client,calls,storage,node};
}

describe("actual product editor persistence recovery",()=>{
  it("recovers a committed insert when its response is lost without repeating insertion",async()=>{
    const h=harness(),normal=h.context.sb;
    const body={id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",product_name:"New QA product",active:true};
    h.context.sb=async(path,options={})=>{
      const result=await normal(path,options);
      if(options.method==="POST")throw new Error("Response lost after commit");
      return result;
    };
    const saved=await h.context.insertProductRecord("products",body);
    expect(saved.id).toBe(body.id);
    expect(h.calls.filter(call=>call.options.method==="POST")).toHaveLength(1);
    expect(h.calls.at(-1).path).toBe("products?id=eq."+body.id+"&select=*");
    expect(h.storage.has("rainbow_product_insert_v1:qa-user")).toBe(false);
  });
  it("retains a committed product's exact identifier across a failed verification and reload",async()=>{
    const h=harness(),normal=h.context.sb;
    const body={id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",product_name:"Original saved product",active:true};
    let offline=true;
    h.context.sb=async(path,options={})=>{
      if(!offline)return normal(path,options);
      if(options.method==="POST"){await normal(path,options);throw new Error("Response lost after commit");}
      throw new Error("Verification also unavailable");
    };
    await expect(h.context.insertProductRecord("products",body)).rejects.toThrow("Verify saved record");
    const marker=JSON.parse(h.storage.get("rainbow_product_insert_v1:qa-user"));
    expect(marker.body).toEqual(body);
    expect(h.node("saveProductBtn").disabled).toBe(true);
    expect(h.node("saveVariantBtn").disabled).toBe(true);
    await expect(h.context.insertProductRecord("products",{...body,id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"})).rejects.toThrow("previous saved record");
    runInContext("pendingProductInsert=null; productInsertKey='';",h.context);
    await h.context.setupProductInsertRecovery();
    expect(h.node("productInsertRecovery").hidden).toBe(false);
    offline=false;
    expect(await h.context.retryProductInsert()).toBe(true);
    const {data}=await h.client.from("products").select();
    expect(data).toHaveLength(2);
    const ids=h.calls.filter(call=>call.options.method==="POST").map(call=>JSON.parse(call.options.body).id);
    expect(ids).toEqual([body.id,body.id]);
    expect(h.storage.has("rainbow_product_insert_v1:qa-user")).toBe(false);
    expect(h.node("saveProductBtn").disabled).toBe(false);
  });
  it("recovers an uncertain variant insertion without adding another variant or receiving stock",async()=>{
    const h=harness(),normal=h.context.sb,rpc=vi.spyOn(h.client,"rpc");
    const body={id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",product_id:product.id,color:"Blue",size:"0",stock_quantity:0,low_stock_limit:3};
    let offline=true;
    h.context.sb=async(path,options={})=>{
      if(!offline)return normal(path,options);
      if(options.method==="POST"){await normal(path,options);throw new Error("Variant response lost");}
      throw new Error("Offline");
    };
    await expect(h.context.insertProductRecord("product_variants",body)).rejects.toThrow("Verify saved record");
    offline=false;
    expect(await h.context.retryProductInsert()).toBe(true);
    const {data}=await h.client.from("product_variants").eq("product_id",product.id);
    expect(data).toHaveLength(2);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not insert a product without preserving its recovery marker first",async()=>{
    const h=harness();
    h.context.sessionStorage.setItem=()=>{throw new Error("Storage unavailable");};
    await expect(h.context.insertProductRecord("products",{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",product_name:"Unsent product"})).rejects.toThrow("Storage unavailable");
    expect(h.calls).toHaveLength(0);
    expect(h.node("saveProductBtn").disabled).toBe(true);
  });
  it("retries only the opening stock request after the server applied it but its reply was lost",async()=>{
    const h=harness();
    const plan={quantity:7,location:shop};
    const result=await h.context.recordOpeningStock(product,variantId,plan);
    expect(result).toContain("needs confirmation");
    const pending=JSON.parse(h.storage.get("qa-user"));
    expect(pending.quantity).toBe(7);
    expect(h.node("openingStockRecovery").hidden).toBe(false);
    expect(await h.context.retryOpeningStock()).toBe(true);
    const {data}=await h.client.from("erp_stock_balances").eq("location_id",shop.id).eq("variant_id",variantId).single();
    expect(data.on_hand).toBe(12); // Original five units plus one receipt of seven.
    expect(h.calls.filter(call=>call.options.method==="POST")).toHaveLength(0);
    expect(h.storage.has("qa-user")).toBe(false);
    expect(h.node("openingStockRecovery").hidden).toBe(true);
  });
  it("sends no stock request when recovery storage is unavailable, including on retry",async()=>{
    const h=harness(),rpc=vi.spyOn(h.client,"rpc");
    h.context.sessionStorage.setItem=()=>{throw new Error("Storage unavailable");};
    expect(await h.context.recordOpeningStock(product,variantId,{quantity:7,location:shop})).toContain("pending");
    expect(await h.context.retryOpeningStock()).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(h.node("openingStockRecovery").hidden).toBe(false);
  });
});
