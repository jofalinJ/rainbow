import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const source=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("branch stock entry is a numeric-only action, not an online allocation",()=>{
 it("opens the quick-add modal from inventory table in ERP-live mode",()=>{
  const js=source("admin/inventory.js");
  const modal=source("admin/erp-quick-stock.mjs");
  expect(js).toContain('import(ERP_INVENTORY?"./erp-quick-stock.mjs"');
  expect(js).toContain('module.setupErpQuickStockUI');
  expect(js).toContain('>＋ Add stock</button>');
  expect(modal).toContain('const reasonLabel=reason.closest("label")');
  expect(modal).toContain("reason.required=false;");
  expect(modal).toContain("p_delta:qty");
  expect(modal).toContain('p_reason:"Shop stock added through Inventory quantity entry"');
  expect(modal).toContain("p_request:request");
  expect(modal).not.toContain('client.rpc("adjust_variant_stock"');
 });
 it("restricts multi-step transfer controls to physical branches",()=>{
  const erp=source("admin/erp.js");
  expect(erp).toContain('rows.filter(x=>x.kind==="branch")');
  expect(erp).toContain('Use Online Push to move stock into Online Store.');
  expect(source("admin/inventory.html")).toContain('class="erp-advanced"');
 });
});

describe("owner online visibility uses server-atomic stock ownership",()=>{
 it("calls a single atomic allocate-and-publish RPC",()=>{
  const js=source("admin/owner.js");
  expect(js).toContain('rpc("erp_allocate_online"');
  expect(js).toContain('p_publish:shouldPublish');
  expect(js).toContain('await transferOnline(product,source,variantId,qty,mode==="show")');
  expect(js).toContain('rpc("erp_recall_and_hide_online"');
  expect(js).toContain('onlineStock(p)>0');
  expect(js).not.toContain('if(transferred)throw new Error("Stock was transferred online');
 });
 it("lists old pending online transfers for explicit owner reconciliation",()=>{
  const js=source("admin/owner.js"),html=source("admin/owner.html");
  expect(html).toContain('id="pendingOnlinePanel"');
  expect(js).toContain('loadPendingOnlineTransfers');
  expect(js).toContain('Confirm received');
  expect(js).toContain('if(!confirm(text))return;');
 });
 it("reuses canonical owner Online Push from advanced product entry",()=>{
  const js=source("admin/products.js");
  expect(js).toContain('owner.html?screen=categories&lookup=');
  expect(source("admin/owner.js")).toContain('const lookup=params.get("lookup")');
 });
 it("installs owner-only atomic functions with positive quantity and location checks",()=>{
  const sql=source("supabase/migrations/20261112000000_atomic_online_stock_visibility.sql");
  expect(sql).toContain('create or replace function public.erp_allocate_online');
  expect(sql).toContain('create or replace function public.erp_recall_and_hide_online');
  expect(sql).toContain('app_private.erp_is_admin()');
  expect(sql).toContain('v_transfer:=public.erp_dispatch_transfer(');
  expect(sql).toContain('v_receipt:=public.erp_receive_transfer(');
  expect(sql).toContain('join public.products p on p.id=v.product_id');
  expect(sql).toContain("grant execute on function public.erp_allocate_online");
  expect(sql).not.toContain('delete from public.erp_stock_balances');
 });
});
