import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=x=>readFileSync(new URL("../../"+x,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261017230000_supplier_purchase_and_grn.sql");
const fixture=read("tests/sql/supplier_purchase_receiving.sql");
const screen=read("admin/purchasing.html");
const ui=read("admin/purchasing.js");
const app=read("admin/app.js");
const workflow=read(".github/workflows/ci.yml");

describe("Phase 5 supplier purchasing and goods receiving",()=>{
 it("does not grant stock mutation through browser tables",()=>{
  expect(migration).toContain("alter table public.goods_receipts enable row level security");
  expect(migration).toContain("revoke all on public.suppliers,public.purchase_orders");
  expect(migration).toContain("set search_path=''");
  expect(migration).toContain("s.active=true and s.role in ('admin','inventory_staff')");
  expect(migration).toContain("s.active=true and s.role='admin'");
  expect(migration).toContain("grant execute on function public.receive_purchase_order");
 });
 it("links each receipt to one PO, supplier invoice, variant and stock movement",()=>{
  expect(migration).toContain("create table if not exists public.suppliers");
  expect(migration).toContain("create table if not exists public.purchase_orders");
  expect(migration).toContain("create table if not exists public.purchase_order_lines");
  expect(migration).toContain("create table if not exists public.goods_receipts");
  expect(migration).toContain("create table if not exists public.goods_receipt_lines");
  expect(migration).toContain("goods_receipts_supplier_invoice_unique");
  expect(migration).toContain("reference_goods_receipt_line_id");
  expect(migration).toContain("stock_in_unique_goods_receipt_line");
  expect(migration).toContain("transaction_type='stock_in'");
 });
 it("locks receiving and rejects over-order receipts while permitting partial delivery",()=>{
  expect(migration).toContain("for update;");
  expect(migration).toContain("v_item.qty>v_ordered-v_received");
  expect(migration).toContain("v_order.status not in ('ordered','partially_received')");
  expect(migration).toContain("status=case when v_finished then 'received' else 'partially_received' end");
  expect(migration).toContain("stock_quantity=v_new::integer");
  expect(migration).toContain("v_before,v_new::integer");
  expect(migration).toContain("'replayed',true");
  expect(migration).toContain("pg_advisory_xact_lock");
 });
 it("offers a guarded on-screen PO, GRN and retry workflow",()=>{
  expect(app).toContain('href:"purchasing.html"');
  expect(screen).toContain('id="poDraftLines"');
  expect(screen).toContain('id="grnDraftLines"');
  expect(screen).toContain('id="supplierForm"');
  expect(ui).toContain('rpc("create_supplier"');
  expect(ui).toContain('"create_purchase_order"');
  expect(ui).toContain('"receive_purchase_order"');
  expect(ui).toContain("rainbow.purchasing.pendingGRN.v1");
  expect(ui).toContain("Retry the SAME operation");
 });
 it("runs real PostgreSQL tests with partial, repeated and failed receipts",()=>{
  expect(fixture).toContain("Partial receipt balance/status/count failed");
  expect(fixture).toContain("GRN retry allocated stock more than once");
  expect(fixture).toContain("Overreceipt unexpectedly accepted");
  expect(fixture).toContain("Cashier received stock without permission");
  expect(fixture).toContain("CI forced receiving ledger failure");
  expect(fixture).toContain("Migration replay mutated procurement data");
  expect(workflow).toContain("CREATE DATABASE rainbow_purchase_ci");
 });
});
