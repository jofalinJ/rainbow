import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
function fixture(){
 const values={},events={};
 const element=(id)=>values[id]??(values[id]={
  hidden:true,textContent:"",value:"",disabled:false,
  addEventListener:(name,fn)=>{events[id+"."+name]=fn;},
  classList:{toggle(){}},focus(){},pause(){},srcObject:null,
 });
 const rows=[{
  product_name:"Golden chain",product_code:"RGC/CH00001",active:true,
  product_variants:[{id:"variant-1",barcode:"QRSCAN-001",stock_quantity:3,active:true},
                    {id:"variant-2",barcode:"QRSCAN-002",stock_quantity:2,active:true}]
 }];
 const added=[],searched=[];
 const context={
  document:{getElementById:element,addEventListener(){}},
  window:{addEventListener(){},RainbowBillingPos:{
   products:()=>rows,
   addVariant:id=>{added.push(id);return true;},
   search:term=>searched.push(term)
  }},
  URL,navigator:{}
 };
 runInNewContext(read("admin/billing-scanner.js"),context);
 return {api:context.window.RainbowBillingScanner,rows,added,searched,events,values};
}
describe("POS camera and keyboard barcode scanner",()=>{
 it("matches one in-stock variant by its exact barcode and only adds that variant",()=>{
  const f=fixture();
  expect(f.api.processCode("QRSCAN-001")).toBe(true);
  expect(f.added).toEqual(["variant-1"]);
  expect(f.searched).toEqual([""]);
 });
 it("accepts Rainbow product QR links but never external URLs",()=>{
  const f=fixture();
  expect(f.api.normalizeCode("https://rainbowgoldcovering.com/product.html?sku=RGC%2FCH00001")).toBe("RGC/CH00001");
  expect(f.api.processCode("https://example.org/product.html?sku=RGC%2FCH00001")).toBe(false);
  expect(f.added).toHaveLength(0);
 });
 it("does not guess when a SKU has more than one variant",()=>{
  const f=fixture();
  expect(f.api.processCode("RGC/CH00001")).toBe(true);
  expect(f.added).toHaveLength(0);
  expect(f.searched).toEqual(["RGC/CH00001"]);
 });
 it("refuses out-of-stock codes and does not perform a sale",()=>{
  const f=fixture();f.rows[0].product_variants[0].stock_quantity=0;
  expect(f.api.processCode("QRSCAN-001")).toBe(false);
  expect(f.added).toHaveLength(0);
 });
 it("offers a user-activated camera and a printer test ticket",()=>{
  const html=read("admin/billing.html");
  const print=read("admin/printer-test.html");
  expect(html).toContain('id="startScanner"');
  expect(html).toContain('id="scannerVideo"');
  expect(html).toContain('id="stopScanner"');
  expect(html).toContain('billing-scanner.js?v=');
  expect(html).toContain('href="printer-test.html"');
  expect(print).toContain('id="printTest"');
  expect(print).toContain("window.print()");
  const f=fixture();expect(f.events["startScanner.click"]).toBeTypeOf("function");
 });
});
