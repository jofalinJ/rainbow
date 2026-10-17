import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261017235000_shop_daily_reconciliation.sql");
const fixture=read("tests/sql/shop_daily_reconciliation.sql");
const html=read("admin/reports.html"),ui=read("admin/reports.js");
const ci=read(".github/workflows/ci.yml");

describe("read-only operational reconciliation",()=>{
 it("requires active admin and bounds historical queries",()=>{
  expect(sql).toContain("s.active=true and s.role='admin'");
  expect(sql).toContain("p_day is null");
  expect(sql).toContain("date-365");
  expect(sql).toContain("revoke all on function public.shop_daily_reconciliation");
  expect(sql).toContain("grant execute on function public.shop_daily_reconciliation");
 });
 it("uses India day boundaries and separates order face value from paid tenders",()=>{
  expect(sql).toContain("at time zone 'Asia/Kolkata'");
  expect(sql).toContain("paid_tenders_total");
  expect(sql).toContain("settled_order_face_value");
  expect(sql).toContain("v_cash,v_upi,v_card");
  expect(sql).toContain("orders_pending_payment");
 });
 it("flags missing history without rewriting stock, invoices or payments",()=>{
  expect(sql).toContain("stock_snapshot_mismatches");
  expect(sql).toContain("unbalanced_signed_movements");
  expect(sql).toContain("goods_receipt_lines_without_movement");
  expect(sql).toContain("online_lines_without_source_movement");
  expect(sql).not.toMatch(/update\s+public\.(orders|payments|product_variants|inventory_transactions)/i);
  expect(sql).not.toMatch(/delete\s+from\s+public\.(orders|payments|product_variants|inventory_transactions)/i);
 });
 it("adds an accessible admin report without automatic correction",()=>{
  expect(html).toContain('id="shopReconcileRun"');
  expect(ui).toContain('rpc("shop_daily_reconciliation"');
  expect(html).toContain("never auto-correct");
 });
 it("has disposable tests for cashier/removed admin denial and variance exceptions",()=>{
  expect(fixture).toContain("Cashier accessed financial diagnostics");
  expect(fixture).toContain("Deactivated admin accessed reconciliation");
  expect(fixture).toContain("failed to flag synthetic data integrity problems");
  expect(ci).toContain("rainbow_reconcile_ci");
 });
});
