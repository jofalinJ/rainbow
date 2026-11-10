import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read = path => readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("owner quick publishing integrates with the existing shop",()=>{
 it("uses its own mobile menu and leaves storefront navigation out of the admin shell",()=>{
  const html=read("admin/owner.html");
  expect(html).toContain('name="robots" content="noindex,nofollow,noarchive"');
  for(const label of ["Dashboard","Products","Add Product","Categories","Salesforce Sync","Visit Store","Logout"])
   expect(html).toContain(label);
  expect(html).toContain('id="menuToggle"');
  expect(html).toContain('id="saveDraft"');
  expect(html).toContain('id="publishNow"');
  expect(html).toContain('id="productPhotos"');
  expect(html).toContain('id="ownerStockConfirm"');
  expect(html).toContain('id="roleAccessNote"');
  expect(html).toContain('id="ownerBulkBar"');
  expect(html).toContain('href="billing.html"');
  expect(html).toContain('href="inventory.html"');
  expect(html).not.toContain("storefront-header");
  expect(html).not.toContain("storefront-footer");
 });
 it("enforces owner role and never uses service role keys in browser code",()=>{
  const js=read("admin/owner.js");
  expect(js).toContain('state.client.auth.getUser()');
  expect(js).toContain('["admin","inventory_staff","cashier"].includes(profile.role)');
  expect(js).toContain('permission==="publish"&&!canPublish()');
  expect(js).toContain('permission==="catalog_write"&&!canEdit()');
  expect(js).toContain('await verifyOwner()');
  expect(js).toContain('createSignedUploadUrl');
  expect(js).toContain('uploadToSignedUrl');
  expect(js).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  expect(js).not.toContain("ADMIN_SESSION_SECRET");
  expect(js).not.toContain('SalesforceAccessToken');
 });
 it("publishes through existing ERP stock transfer and reserves no stock locally",()=>{
  const js=read("admin/owner.js");
  expect(js).toContain('erp_adjust_stock');
  expect(js).toContain('erp_dispatch_transfer');
  expect(js).toContain('erp_receive_transfer');
  expect(js).toContain('erp_online_listings');
  expect(js).toContain('stableOperationId');
  expect(js).toContain('if(!canPublish())return sum+Math.max(0,Number(v.stock_quantity||0))');
  expect(js).toContain('if(canPublish())await publication(created,false)');
  expect(js).toContain('else if(!previous&&canPublish())await publication(product,false)');
  expect(js).not.toContain('.update({stock_quantity:');
  const shop=read("shop-catalogue.js");
  expect(shop).toContain('.eq("erp_online_listings.published",true)');
  expect(shop).toContain('.gt("product_variants.stock_quantity",0)');
 });
 it("supports phone-width layouts and touch-friendly controls",()=>{
  const css=read("admin/owner.css");
  expect(css).toContain("@media(max-width:520px)");
  expect(css).toContain("min-height:44px");
  expect(css).toContain("--red:#8B0000");
  expect(css).toContain("--gold:#C9A227");
  expect(css).toContain("position:sticky");
 });
 it("migration safely extends the live schema rather than replacing it",()=>{
  const sql=read("supabase/migrations/20261110213000_owner_quick_publish.sql");
  expect(sql).toContain("add column if not exists archived_at");
  expect(sql).toContain("existing_count >= 6");
  expect(sql).toContain("owner_validate_online_publication");
  expect(sql).toContain("p.selling_price > 0");
  expect(sql).not.toMatch(/drop\s+table/i);
  expect(sql).not.toMatch(/delete\s+from\s+public\./i);
 });
 it("shows the quick-product entry point in existing staff navigation",()=>{
  const html=read("admin/products.html");
  expect(html).toContain('href="owner.html"');
  const js=read("admin/owner.js");
  expect(js).toContain('document.querySelectorAll("[data-screen=\'editor\']")');
  expect(js).toContain('document.querySelectorAll("[data-admin-only]")');
  expect(js).toContain('Only the owner can publish products');
 });
 it("keeps returning admins in the owner area without open redirects",()=>{
  const login=read("admin/login.html");
  expect(login).toContain('get("next")==="owner.html"');
  const admin=read("admin/app.js");
  expect(admin).toContain('{label:"Quick Products",href:"owner.html",roles:["admin","inventory_staff","cashier"]}');
 });
});
