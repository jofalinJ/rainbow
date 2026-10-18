import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context={};
runInNewContext(readFileSync(new URL("../../shop-catalogue.js",import.meta.url),"utf8"),context);
const catalogue=context.RainbowCatalogue;
function fakeClient(total=10000){
 const calls=[];
 const query={};
 for(const name of ["eq","gt","gte","lte","or","in","order","range","ilike"]){
   query[name]=(...args)=>{calls.push([name,...args]);return query;};
 }
 query.then=(resolve,reject)=>{
   const range=calls.filter(c=>c[0]==="range").at(-1);
   const length=range?Math.max(0,Math.min(range[2]+1,total)-range[1]):24;
   return Promise.resolve({count:total,data:Array.from({length},(_,i)=>({id:"test-"+(range[1]+i)})),error:null}).then(resolve,reject);
 };
 return {calls,from:table=>{calls.push(["from",table]);return {select:(columns,opts)=>{calls.push(["select",columns,opts]);return query;}}}};
}
describe("catalogue scale: query and storage contracts",()=>{
 it("never asks Supabase for more than 48 products",async()=>{
   const c=fakeClient(10000);
   const first=await catalogue.page(c,{offset:0,limit:1000});
   expect(first.items).toHaveLength(48);
   expect(first.hasMore).toBe(true);
   expect(c.calls.find(row=>row[0]==="range")).toEqual(["range",0,47]);
   expect(c.calls.find(row=>row[0]==="select")[2]).toEqual({count:"exact"});
 });
 it("returns all 10k by bounded, nonoverlapping pages and stable id ordering",async()=>{
   const c=fakeClient(10000);
   const last=await catalogue.page(c,{offset:9984,limit:24,sort:"price-low"});
   expect(last.items).toHaveLength(16);
   expect(last.hasMore).toBe(false);
   expect(last.total).toBe(10000);
   expect(c.calls.filter(call=>call[0]==="order").map(row=>row[1])).toEqual(["selling_price","id"]);
 });
 it("applies price, category, stock, audience and same-variant filters on server",()=>{
   const c=fakeClient();
   catalogue.buildQuery(c,{categoryId:"123",segment:"men",minPrice:"100",maxPrice:"500",color:"Gold",size:"M",length:"60"});
   expect(c.calls).toContainEqual(["eq","active",true]);
   expect(c.calls).toContainEqual(["gt","product_variants.stock_quantity",0]);
   expect(c.calls).toContainEqual(["ilike","product_variants.color","Gold"]);
   expect(c.calls).toContainEqual(["ilike","product_variants.size","M"]);
   expect(c.calls).toContainEqual(["eq","product_variants.length_cm",60]);
   expect(c.calls).toContainEqual(["gte","selling_price",100]);
   expect(c.calls).toContainEqual(["lte","selling_price",500]);
   expect(c.calls).toContainEqual(["in","gender",["male","unisex"]]);
 });
 it("keeps empty wishlist empty instead of accidentally showing the entire shop",async()=>{
   const c=fakeClient();
   const result=await catalogue.page(c,{wishlistIds:[]});
   expect(result.total).toBe(0);
   expect(c.calls.length).toBeGreaterThan(0);
   expect(c.calls.some(c=>c[0]==="range")).toBe(false);
 });
 it("never interpolates search control syntax into the PostgREST OR filter",()=>{
   const c=fakeClient();
   catalogue.buildQuery(c,{search:"  ring,) OR active.eq.false%  "});
   const filter=c.calls.find(row=>row[0]==="or")?.[1];
   expect(filter).toBeDefined();
   expect(filter).not.toContain(")");
   expect(filter).not.toContain("%  ");
 });
 it("finds matching category names without downloading their product rows",()=>{
   const c=fakeClient();
   const categoryId="11111111-2222-3333-4444-555555555555";
   catalogue.buildQuery(c,{search:"earrings",searchCategoryIds:[categoryId]});
   const filter=c.calls.find(row=>row[0]==="or")?.[1];
   expect(filter).toContain("category_id.in.("+categoryId+")");
 });
 it("finds slash-containing SKUs exactly and expands jewellery transliterations",()=>{
   const c=fakeClient();
   catalogue.buildQuery(c,{search:"RGC/C00004"});
   expect(c.calls.find(row=>row[0]==="or")?.[1]).toContain("product_code.eq.RGC/C00004");
   const d=fakeClient();
   catalogue.buildQuery(d,{search:"jimmiki"});
   expect(d.calls.find(row=>row[0]==="or")?.[1]).toContain("type.ilike.%earring%");
 });
 it("only returns a thumbnail URL for managed optimized WebP objects",()=>{
   const full="https://demo.supabase.co/storage/v1/object/public/product-images/RG/abc-optimized.webp";
   expect(catalogue.thumbnailUrl({storage_path:"RG/abc-optimized.webp",public_url:full})).toContain("abc-thumb.webp");
   expect(catalogue.thumbnailUrl({storage_path:"RG/old.jpg",public_url:full})).toBe(full);
 });
});
