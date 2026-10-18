import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context={};
runInNewContext(readFileSync(new URL("../../shop-discovery.js", import.meta.url),"utf8"),context);
const d=context.RainbowDiscovery;
const product=(code,name,price,variant={},opts={})=>({
 id:code,product_code:code,product_name:name,selling_price:price,type:opts.type||"Earrings",
 created_at:opts.created_at||"2026-10-17T12:00:00Z",display_priority:opts.priority||0,
 product_variants:[{stock_quantity:opts.stock??3,active:true,color:"Gold",size:"Medium",length_cm:30,...variant}]
});
describe("catalogue discovery",()=>{
 const p=product("RG-101","Traditional Jhumka Earrings",299);
 it("matches product code and tolerates common name typo",()=>{
  expect(d.matchesText(p,"RG-101","Earrings")).toBe(true);
  expect(d.matchesText(p,"Jhumkka","Earrings")).toBe(true);
  expect(d.matchesText(p,"xyz-999","Earrings")).toBe(false);
 });
 it("constrains price, variant and stock",()=>{
  expect(d.matchesOptions(p,{minPrice:"200",maxPrice:"300",color:"Gold",size:"Medium",length:"30"})).toBe(true);
  expect(d.matchesOptions(p,{minPrice:"300"})).toBe(false);
  expect(d.matchesOptions(p,{color:"Silver"})).toBe(false);
  expect(d.matchesOptions(product("RG-102","Chain",500,{}, {stock:0}),{inStock:true})).toBe(false);
 });
 it("sorts without mutating the original",()=>{
  const rows=[product("A","A",600),product("B","B",200)];
  const low=d.sortProducts(rows,"price-low");
  expect(low.map(x=>x.product_code)).toEqual(["B","A"]);expect(rows[0].product_code).toBe("A");
 });
});
