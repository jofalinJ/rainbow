import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read = path => readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("owner quick publishing integrates with the existing shop",()=>{
 it("uses the shared staff sidebar and keeps existing product tools in one layout",()=>{
  const html=read("admin/owner.html");
  expect(html).toContain('name="robots" content="noindex,nofollow,noarchive"');
  for(const label of ["Online Push","Saved Products","Add Product","Overview"])
   expect(html).toContain(label);
  expect(html).toContain('<aside aria-label="Admin sidebar"></aside>');
  expect(html).not.toContain('id="ownerMenu"');
  expect(html).toContain('id="saveDraft"');
  expect(html).toContain('id="publishNow"');
  expect(html).toContain('id="productPhotos"');
  expect(html).toContain('id="ownerStockConfirm"');
  expect(html).toContain('id="ownerMoreDetails"');
  expect(html).toContain('data-screen="categories" class="active"');
  expect(html).toContain('Save product for approval');
  expect(html).toContain('Product name, category, price and warranty');
  expect(html.indexOf('id="ownerName"')).toBeLessThan(html.indexOf('id="ownerMoreDetails"'));
  expect(html).not.toMatch(/salesforce/i);
  expect(html).toContain('id="roleAccessNote"');
  expect(html).toContain('id="ownerBulkBar"');
  expect(html).toContain('app.js?v=20261114-staff-access');
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
  expect(js).not.toMatch(/salesforce/i);
  expect(js).toContain('show(["categories","products","editor","dashboard"].includes(requested)?requested:"categories")');
  expect(js).toContain('toast("Product saved under "+data.cat.name+".",product.product_code,true)');
  expect(js).toContain('$("ownerMoreDetails").open=false');
  expect(js).toContain('if(!name){fieldError("Name"');
  expect(js).toContain('if(!validPrice||!priceRaw||price<=0)');
  expect(js).toContain('$("saveDraft").style.gridColumn=owner?"auto":"1/-1"');
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
 it("lists every saved product under categories and restricts online controls to the owner",()=>{
  const html=read("admin/owner.html"),js=read("admin/owner.js"),css=read("admin/owner.css");
  for(const id of ["categoryCatalogueFilter","categoryCatalogueSearch","categoryCatalogueList",
     "onlineVisibilityDialog","onlineVisibilitySource","onlineVisibilityVariant","onlineVisibilityQty"]){
    expect(html).toContain('id="'+id+'"');
  }
  expect(html).toContain("ONLINE PRODUCTS");
  expect(js).toContain("function renderCategoryCatalogue()");
  expect(js).toContain('button.textContent=online?"Hide Online":"Show Online"');
  expect(js).toContain('if(canPublish()){');
  expect(js).toContain('note.textContent=visibleOnStorefront(product)?"Visible online":"Owner controls online visibility"');
  expect(js).toContain('show("categories");');
  expect(js).toContain('state.categoryLimit=48');
  expect(css).toContain(".category-product-row");
 });
 it("publishes only after counted shop stock transfer, not by editing the online stock mirror",()=>{
  const js=read("admin/owner.js");
  const publish=js.slice(js.indexOf("async function confirmOnlineVisibility()"),js.indexOf("async function saveProduct(mode)"));
  expect(publish).toContain('await verifyOwner("publish")');
  expect(publish).toContain('qty>balance.onHand-balance.reserved');
  expect(publish).toContain('await transferOnline(product,source,variantId,qty,mode==="show")');
  expect(js).toContain('rpc("erp_allocate_online"');
  expect(js).toContain('rpc("erp_recall_and_hide_online"');
  expect(publish).not.toContain('await publication(product,true)');
  expect(js).toContain('async function publishExisting(product)');
  expect(js).toContain('if(!balances.some(b=>b.onHand>b.reserved))');
  expect(js).toContain('if(!canPublish())return sum+Math.max(0,Number(v.stock_quantity||0))');
  expect(js).not.toContain('.update({stock_quantity:');
 });
 it("offers admin-only online top-ups from recorded physical stock with current shop availability",()=>{
  const html=read("admin/owner.html"),js=read("admin/owner.js"),css=read("admin/owner.css");
  for(const id of ["onlineVisibilityAvailable","onlineVisibilityCurrent","onlineVisibilitySource",
      "onlineVisibilityVariant","onlineVisibilityQty","onlineVisibilityConfirm"]){
   expect(html).toContain('id="'+id+'"');
  }
  expect(html).toContain("Add Online Stock");
  expect(html).toContain("Online Push");
  expect(js).toContain('addStock.textContent="＋ Add Online Stock"');
  expect(js).toContain('addStock.onclick=()=>safeAction(()=>openOnlineStockDialog(product,"stock"))');
  expect(js).toContain('state.shopBalances=new Map(');
  expect(js).toContain('await Promise.all([');
  expect(js).toContain('async function loadOnlineStockAvailability()');
  expect(js).toContain('function updateShopStockPreview()');
  expect(js).toContain('available<1;source.add(opt)');
  expect(js).toContain('qty.max=String(Math.min(100000,available))');
  expect(js).toContain('await transferOnline(product,source,variantId,qty,mode==="show")');
  expect(js).toContain('if(qty>balance.onHand-balance.reserved)');
  expect(js).not.toContain('.update({stock_quantity:');
  expect(css).toContain(".online-visibility-dialog .stock-preview");
 });
 it("supports phone-width layouts and touch-friendly controls",()=>{
  const css=read("admin/owner.css");
  expect(css).toContain("@media(max-width:520px)");
  expect(css).toContain("min-height:44px");
  expect(css).toContain("--red:#8B0000");
  expect(css).toContain("--gold:#C9A227");
  expect(css).toContain("position:sticky");
  expect(css).toContain("#startup[hidden]{display:none!important}");
  expect(css).toContain(".optional-details");
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
  expect(html).toContain('href="owner.html?screen=categories"');
  const js=read("admin/owner.js");
  expect(js).toContain('document.querySelectorAll("[data-screen=\'editor\']")');
  expect(js).toContain('document.querySelectorAll("[data-admin-only]")');
  expect(js).toContain('Only the owner can publish or allocate online stock.');
 });
 it("keeps returning admins in the owner area without open redirects",()=>{
  const login=read("admin/login.html");
  expect(login).toContain('src="app.js?v=20261114-staff-access"');
  expect(read("admin/app.js")).toContain('get("next")==="owner.html"');
  const admin=read("admin/app.js");
  expect(admin).toContain('{label:"Online Products",href:"owner.html?screen=categories",roles:["admin","inventory_staff","cashier"]}');
 });
});
