import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("online publication is required for public product discovery",()=>{
  it("filters the paged catalogue by published ERP listing",()=>{
    const script=read("shop-catalogue.js");
    expect(script).toContain("erp_online_listings!inner(published,online_price)");
    expect(script).toContain('.gt("erp_online_listings.online_price",0)');
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
  it("reuses existing product-page cart",()=>{
    const js=read("product-page.js");
    expect(js).toContain("const items=cart();");
    expect(js).not.toContain("buy?[]:cart()");
  });
  it("merges the modal selection with existing bag before continuing",()=>{
    const js=read("content.js");
    expect(js).toContain("const mergedQty=Math.min(stock");
    expect(js).toContain("else cart.push(makeCartItem(mergedQty));");
    expect(js).not.toContain("saveCart([makeCartItem(");
  });
});
