import {describe,it,expect} from "vitest";
import {readFileSync,existsSync} from "node:fs";
import {Script} from "node:vm";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
describe("existing admin screen multi-shop integration",()=>{
 it("does not add a separate ERP page or menu entry",()=>{
  expect(existsSync(new URL("../../admin/erp.html",import.meta.url))).toBe(false);
  const source=read("admin/app.js");
  expect(source).not.toMatch(/href:"erp\.html"/);
  for(const href of ["index.html","products.html","inventory.html","billing.html","staff.html","reports.html"]){
   expect(source).toContain('href:"'+href+'"');
  }
 });
 it("retains the original Inventory and billing interfaces",()=>{
  const inventory=read("admin/inventory.html");
  for(const marker of ['id="categoryTabs"','id="rows"','id="stockDialog"','id="stockAdjustmentForm"','id="branchInventoryTools"','id="erpSearch"','id="erpTransferForm"'])
   expect(inventory).toContain(marker);
  const billing=read("admin/billing.js");
  expect(billing).toContain('rpc("create_local_sale"');
  expect(inventory).toContain("inventory.js");
 });
 it("adds existing-product reuse instead of a second product editor",()=>{
  const products=read("admin/products.html");
  for(const marker of ['id="form"','id="existingBox"','id="lookupProductCode"','id="sharedProductSearch"','id="onlineListingDialog"'])
   expect(products).toContain(marker);
  expect(read("admin/products.js")).toContain("function findSharedProducts");
  expect(read("admin/products.js")).toContain("lookupProductByCode");
 });
 it("keeps old staff creation, dashboard and reports with inline branch tools",()=>{
  const staff=read("admin/staff.html");
  expect(staff).toContain('id="staffForm"');
  expect(staff).toContain('id="staffRows"');
  expect(staff).toContain('id="staffBranchPanel"');
  for(const p of ["admin/index.html","admin/reports.html"]){
   expect(read(p)).toContain('id="branchSummaryPanel"');
   expect(read(p)).toContain('branch-summary.js');
  }
 });
 it("does not auto-activate new ERP controls on production without opt-in",()=>{
  for(const page of ["admin/index.html","admin/reports.html"]){
   expect(read(page)).toContain('id="branchSummaryPanel" hidden');
  }
  expect(read("admin/inventory.html")).toContain('id="branchInventoryTools" hidden');
  expect(read("admin/staff.html")).toContain('id="staffBranchPanel" hidden');
  expect(read("admin/products.html")).toContain('id="sharedProductLookupSection" hidden');
  expect(read("admin/erp.js")).toContain("window.RAINBOW_MULTI_SHOP_ENABLED!==true");
  expect(read("admin/staff-branches.js")).toContain("window.RAINBOW_MULTI_SHOP_ENABLED!==true");
  expect(read("admin/branch-summary.js")).toContain("window.RAINBOW_MULTI_SHOP_ENABLED!==true");
  expect(read("admin/products.js")).toContain("window.RAINBOW_MULTI_SHOP_ENABLED===true");
  expect(read("admin/config.js")).not.toContain("RAINBOW_MULTI_SHOP_ENABLED=true");
 });
 it("stages optional UI scripts with valid JavaScript",()=>{
  for(const p of ["admin/erp.js","admin/staff-branches.js","admin/branch-summary.js","admin/products.js"]){
   expect(()=>new Script(read(p),{filename:p})).not.toThrow();
  }
 });
});
