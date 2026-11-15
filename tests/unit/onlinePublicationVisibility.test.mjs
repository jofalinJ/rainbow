import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("online publication is required for public product discovery",()=>{
  it("filters the paged catalogue by published ERP listing",()=>{
    const script=read("shop-catalogue.js");
    expect(script).toContain("erp_online_listings!inner(published,online_price)");
    expect(script).toContain('online==null?product.selling_price:online');
    expect(script).toContain('.eq("erp_online_listings.published",true)');
    expect(script).toContain('.gt("product_variants.stock_quantity",0)');
  });
  it("applies publication to direct SKU links and related products",()=>{
    const script=read("product-page.js");
    expect(script).toContain("erp_online_listings!inner(published,online_price)");
    expect(script).toContain('.eq("product_code",sku).eq("active",true).eq("erp_online_listings.published",true)');
    expect(script).toContain('.eq("active",true).eq("erp_online_listings.published",true).eq("type",product.type)');
  });
  it("protects direct anonymous API reads while retaining actual staff access",()=>{
    const sql=read("supabase/migrations/20261108153000_restrict_public_product_visibility.sql");
    expect(sql).toContain('drop policy if exists "public can view active products"');
    expect(sql).toContain('to anon, authenticated');
    expect(sql).toContain("listing.published=true");
    expect(sql).toContain("using ((select public.is_staff()))");
    expect(sql).not.toContain("delete from public.products");
  });
});

describe("Buy Now does not erase the customer's existing bag",()=>{
  const source=read("shop-bag.js");
  const product={id:"design-1",product_name:"Fixture necklace"};
  const line=id=>({variant_id:id,product});
  function bagWith(items){
    const window={};
    let value=JSON.stringify(items);
    const storage={
      getItem:()=>value,
      setItem:(_key,next)=>{value=next;}
    };
    runInNewContext(source,{window,localStorage:storage});
    return {bag:window.RainbowBag,storage};
  }
  it("uses the same bag logic for quick view and the standalone product page",()=>{
    for(const script of ["content.js","product-page.js"]){
      expect(read(script)).toContain("window.RainbowBag");
      expect(read(script)).toContain("bag.add(");
    }
  });
  it("merges the requested quantity without changing other options",()=>{
    const {bag}=bagWith([{...line("short"),quantity:2},{...line("long"),quantity:3}]);
    expect(bag.add(line("short"),2,4)).toBe("");
    expect(bag.read().map(item=>item.quantity)).toEqual([4,3]);
  });
  it("rejects the entire addition if it exceeds available stock or the per-option limit",()=>{
    const {bag}=bagWith([{...line("short"),quantity:2},{...line("long"),quantity:99}]);
    expect(bag.add(line("short"),2,3)).toContain("1 more");
    expect(bag.add(line("long"),2,120)).toContain("1 more");
    expect(bag.read().map(item=>item.quantity)).toEqual([2,99]);
    expect(bag.add(line("long"),1,120)).toBe("");
    expect(bag.read()[1].quantity).toBe(100);
  });
  it("keeps older bags readable and declines new options at the checkout line limit",()=>{
    const {bag}=bagWith(Array.from({length:51},(_,index)=>({...line(String(index)),quantity:1})));
    expect(bag.add(line("extra"),1,4)).toContain("50 different options");
    expect(bag.read()).toHaveLength(51);
  });
  it("reports storage errors and leaves the previous bag intact",()=>{
    const {bag,storage}=bagWith([{...line("short"),quantity:1}]);
    storage.setItem=()=>{throw new Error("Storage is full");};
    expect(bag.add(line("short"),1,4)).toContain("Could not save");
    expect(bag.read()[0].quantity).toBe(1);
  });
});
