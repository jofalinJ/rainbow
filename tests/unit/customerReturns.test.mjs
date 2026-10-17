import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const get=f=>readFileSync(new URL("../../"+f,import.meta.url),"utf8");
const sql=get("supabase/migrations/20261017232000_customer_returns_and_refund_evidence.sql");
const test=get("tests/sql/customer_returns_refund_evidence.sql");
const ui=get("admin/returns.js");
describe("customer return handling",()=>{
 it("enforces permissions and paid-order requirements",()=>{
  expect(sql).toContain("enable row level security");
  expect(sql).toContain("s.active=true and s.role='admin'");
  expect(sql).toContain("v_order.payment_status<>'paid'");
 });
 it("blocks excess quantities and repeated stock releases",()=>{
  expect(sql).toContain("v_prev+v_item.qty>v_order_item.quantity");
  expect(sql).toContain("reference_customer_return_line_id");
  expect(sql).toContain("if v_item.restockable then");
  expect(sql).toContain("'replayed',true");
 });
 it("keeps refunds separate from transactions and requires evidence",()=>{
  expect(sql).toContain("customer_refund_confirmations");
  expect(sql).toContain("p_settlement_checked is distinct from true");
  expect(sql).toContain("customer_refunds_unique_payment_evidence");
  expect(sql).not.toMatch(/update\s+public\.payments/i);
 });
 it("uses controlled admin UI and disposable DB tests",()=>{
  expect(ui).toContain('rpc("receive_customer_return"');
  expect(ui).toContain('rpc("confirm_customer_refund"');
  expect(ui).toContain("rainbow.returns.unconfirmed.v1");
  expect(test).toContain("Late return failure left partial stock/financial writes");
  expect(test).toContain("Duplicate return restocked twice");
 });
});
