import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
describe("Storefront branding, checkout pricing and product warranties",()=>{
 it("places Since 1996 after GOLD COVERING in the same storefront brand lettering",()=>{
  const html=read("index.html");
  const css=read("content.css");
  expect(html).toContain('<small>GOLD COVERING</small><small class="brand-since">SINCE 1996</small>');
  expect(css).toContain(".storefront-header-row .logo .brand-since{margin-top:2px}");
 });
 it("removes the online discount and redundant Razorpay details",()=>{
  const html=read("order.html"),js=read("order.js");
  expect(html).not.toContain("Discount (3%)");
  expect(html).not.toContain('id="discount"');
  expect(html).not.toContain('id="razorpayDetails"');
  expect(html).not.toContain('id="whatsappReceiptConsent"');
  expect(js).not.toContain("subtotal*.03");
  expect(js).not.toContain('$("discount")');
  expect(js).toContain("const taxable=subtotal;");
  expect(js).toContain("whatsapp_opt_in:false");
  expect(js).toContain('pricing_revision:"no-discount-20261111"');
  expect(js).toContain("gstComponentsForState(taxable");
 });
 it("offers 8-month through 5-year warranty choices on both product editors",()=>{
  const pages=[read("admin/products.html"),read("admin/owner.html")];
  for(const html of pages){
   for(const value of ["8","12","18","24","36","48","60"])
    expect(html).toContain('value="'+value+'"');
   expect(html).toContain('>Not specified</option>');
  }
  expect(read("admin/products.js")).toContain('warranty_months:$("warrantyMonths").value?Number($("warrantyMonths").value):null');
  expect(read("admin/owner.js")).toContain('warranty_months:data.warrantyMonths');
 });
 it("loads the warranty from product details and displays it on the public product page",()=>{
  expect(read("admin/catalogue-ops.js")).toContain("description,warranty_months,");
  expect(read("shop-catalogue.js")).toContain("description,warranty_months,");
  const page=read("product-page.js");
  expect(page).toContain("description,warranty_months,");
  expect(page).toContain('["Warranty",warranty?warrantyLabel:null]');
 });
 it("uses zero discount in BOTH authoritative server checkout functions, keeping staff POS unchanged",()=>{
  const sql=read("supabase/migrations/20261111170000_online_no_discount_product_warranty.sql");
  expect(sql).toContain("CREATE OR REPLACE FUNCTION public.create_razorpay_checkout");
  expect(sql).toContain("CREATE OR REPLACE FUNCTION public.create_online_order");
  expect(sql).toContain("v_discount:=0;");
  expect(sql).toContain("v_discount := 0;");
  expect(sql).toContain("v_taxable:=v_subtotal;");
  expect(sql).toContain("v_taxable := v_subtotal;");
  expect(sql).not.toMatch(/v_discount\s*:?=\s*round\(v_subtotal\s*\*\s*0\.03/i);
  expect(sql).toContain("Checkout prices have changed. Refresh the page before paying.");
  expect(sql).toContain("products_warranty_months_range");
  expect(sql).toContain("warranty_months BETWEEN 8 AND 60");
  expect(read("admin/billing.js")).toContain("const DISCOUNT_RATE=.03;");
 });
});
