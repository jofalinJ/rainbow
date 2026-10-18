import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const sandbox={};
runInNewContext(readFileSync(new URL("../../admin/catalogue-ops.js",import.meta.url),"utf8"),sandbox);
const ops=sandbox.RainbowAdminCatalogue;
const categories=[{id:"11111111-2222-3333-4444-555555555555",name:"Earring",has_color:true,has_size:false,has_length:false},
  {id:"22222222-2222-3333-4444-555555555555",name:"Chain",has_color:false,has_size:false,has_length:true}];
const header=ops.FIELDS.join(",");
describe("bulk catalogue validation",()=>{
 it("parses quoted CSV names and commas without losing columns",()=>{
   const input=header+'\r\nRGC00001,Earring,"Jhumka, golden",Designer,299,women,Gold,0,,hello,,\r\n';
   const rows=ops.resolveImport(ops.parseImport(input),categories);
   expect(rows).toHaveLength(1);
   expect(rows[0].issues).toHaveLength(0);
   expect(rows[0].raw.product_name).toBe("Jhumka, golden");
   expect(rows[0].product.active).toBe(false);
   expect(rows[0].variant.stock_quantity).toBe(0);
 });
 it("rejects bad prices, missing category dimensions and duplicate codes",()=>{
   const input=header+'\nRGC00001,Earring,Studs,Designer,-1,women,Gold,0,,,,\n'+
     'RGC00001,Chain,Long Chain,Designer,250,women,0,0,,,,\n';
   const rows=ops.resolveImport(ops.parseImport(input),categories);
   expect(rows[0].issues.length).toBeGreaterThan(0);
   expect(rows[1].issues.join(" ")).toContain("Duplicate code");
   expect(rows[1].issues.join(" ")).toContain("length_cm");
 });
 it("limits imports to 500 products",()=>{
   const data=header+"\n"+Array.from({length:501},(_,i)=>"RGC"+String(i).padStart(6,"0")+",Earring,Studs,Designer,100,women,Gold,0,,,,").join("\n");
   expect(()=>ops.parseImport(data)).toThrow(/500/);
 });
 it("maps product image positions safely including slash-containing SKUs",()=>{
   const parsed=ops.parsePhotoName("RGC%2FC00004__5.webp");
   expect(parsed).toMatchObject({code:"RGC/C00004",position:5});
   expect(ops.parsePhotoName("RGC/C00004__1.jpg")).toBeNull();
   expect(ops.parsePhotoName("RGC%2FC00004__6.webp")).toBeNull();
 });
 it("escapes spreadsheet formulas in exported cells",()=>{
   const csv=ops.csvString([["product_code","name"],["RG01","=HYPERLINK(\"bad\")"]]);
   expect(csv).toContain("'=HYPERLINK");
 });
 it("rejects unclosed CSV quotes",()=>expect(()=>ops.csvParse('name\n"unfinished')).toThrow());
});
function mock(){
 const calls=[];
 const q={};
 for(const name of ["select","eq","or","order","range"]){
   q[name]=(...args)=>{calls.push([name,...args]);return q;};
 }
 q.then=(resolve,reject)=>{
   const r=calls.find(x=>x[0]==="range");
   const data=Array.from({length:r[2]-r[1]+1},(_,index)=>({id:r[1]+index}));
   return Promise.resolve({data,count:10000,error:null}).then(resolve,reject);
 };
 return {calls,from:(table)=>{calls.push(["from",table]);return q}};
}
describe("admin catalogue pagination",()=>{
 it("limits database requests to 40 products, with stable tie-break sorting",async()=>{
   const client=mock();
   const result=await ops.list(client,{page:249});
   expect(result.rows).toHaveLength(40);
   expect(result.pages).toBe(250);
   expect(client.calls.find(x=>x[0]==="range")).toEqual(["range",9960,9999]);
   expect(client.calls.filter(x=>x[0]==="order").map(x=>x[1])).toEqual(["created_at","id"]);
 });
 it("removes PostgREST punctuation from adversarial admin search terms",()=>{
   const cleaned=ops.cleanSearch("RGC/C00004),active.eq.false");
   expect(cleaned).toContain("RGC/C00004");
   expect(cleaned).not.toMatch(/[(),.%]/);
 });
 it("routes search to the database, never filters only the current page",async()=>{
   const client=mock();
   await ops.list(client,{search:"RGC/C00004"});
   expect(client.calls.some(x=>x[0]==="or"&&x[1].includes("product_code.ilike."))).toBe(true);
   expect(client.calls.find(x=>x[0]==="range")).toEqual(["range",0,39]);
 });
});
