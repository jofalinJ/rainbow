import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {buildVariantDraft,sameVariant} from "../../src/domain/variantRules.mjs";

const chain={has_color:false,has_size:false,has_length:true};
const anklet={has_color:true,has_size:true,has_length:false};
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const draft=(category,override={})=>buildVariantDraft(category,{
  color:"Pink",size:"08",length:"45.5",stock:"0",low:"0",...override
});
describe("product variant creation",()=>{
  it("accepts new chain lengths and treats distinct lengths as separate variants",()=>{
    const first=draft(chain),another=draft(chain,{length:"60"});
    expect(first).toEqual({color:"0",size:"0",length_cm:45.5,stock_quantity:0,low_stock_limit:0});
    expect(sameVariant(first,another)).toBe(false);
    expect(sameVariant(first,{...first,length_cm:"45.50"})).toBe(true);
    expect(sameVariant({...first,length_cm:null},first)).toBe(false);
  });
  it("preserves color and size for jewellery variants and finds duplicates",()=>{
    const original=draft(anklet),other=draft(anklet,{size:"10"});
    expect(original).toEqual({color:"Pink",size:"08",length_cm:null,stock_quantity:0,low_stock_limit:0});
    expect(sameVariant(original,{...original,color:" pink "})).toBe(true);
    expect(sameVariant(original,other)).toBe(false);
  });
  it("preserves zero stock and zero low-stock threshold",()=>{
    expect(draft(anklet,{stock:"0",low:"0"}).low_stock_limit).toBe(0);
    expect(draft(anklet,{stock:"25",low:"3"}).stock_quantity).toBe(25);
  });
  it.each([
    [{length:""},"length"],[{length:"0"},"positive"],[{length:"-1"},"positive"],
    [{length:"12.123"},"decimal"],[{length:"abc"},"positive"],
    [{stock:"-1"},"whole number"],[{stock:"1.2"},"whole number"],
    [{low:"-1"},"whole number"],[{stock:""},"whole number"]
  ])("rejects invalid variation input %#", (override,message)=>{
    expect(()=>draft(chain,override)).toThrow(message);
  });
  it("enforces database uniqueness including length and retains barcodes",()=>{
    const sql=read("supabase/migrations/20261015194000_variant_length_uniqueness.sql");
    expect(sql).toContain("UNIQUE NULLS NOT DISTINCT (product_id,color,size,length_cm)");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS product_variants_product_id_color_size_key");
    const client=read("admin/products.js");
    expect(client).toContain('import("../src/domain/variantRules.mjs")');
    expect(client).toContain('rules.sameVariant(v,draft)');
    expect(client).toContain('error?.code==="23505"');
    expect(client).toContain('return=representation');
    expect(client).toContain('low_stock_limit:Number($("low").value??3)');
  });
  it("keeps variant feedback visible when the separate product form is hidden",()=>{
    const html=read("admin/products.html");
    const start=html.indexOf('<form id="form"');
    const end=html.indexOf("</form>",start);
    const message=html.indexOf('id="msg"');
    expect(message).toBeGreaterThan(end);
    expect(html).toContain('id="existingVariants"');
    expect(html).toContain('id="variantFields"');
    expect(html).toContain('products-editor.css?v=20261015-variant-v1');
  });
});
