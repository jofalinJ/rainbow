import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261017223000_online_order_source_ledger.sql");
const dbtest=read("tests/sql/online_order_source_ledger.sql");
const history=read("admin/inventory-adjustments.mjs");
const workflow=read(".github/workflows/ci.yml");

describe("source-linked online stock allocations",()=>{
  it("preserves the existing client-facing RPC while writing a linked movement",()=>{
    expect(migration).toContain("create_online_order(p_items jsonb, p_customer jsonb, p_delivery_distance_km numeric");
    expect(migration).toContain("insert into public.orders(");
    expect(migration).toContain("insert into public.payments(");
    expect(migration).toContain("insert into public.order_items(");
    expect(migration).toContain("insert into public.inventory_transactions (");
    expect(migration).toContain("reference_order_id,reason,created_by");
    expect(migration).toContain("v_product.stock_quantity,v_product.stock_quantity-v_qty,v_order_id");
    expect(migration).toContain("v_id,'sale_online',v_qty,-v_qty");
  });
  it("retains pending UPI status and protects the final stock decrement",()=>{
    expect(migration).toContain("where id=v_id and stock_quantity >= v_qty");
    expect(migration).toContain("for update of pv");
    expect(migration).toContain("'pending','pending'");
    expect(migration).toContain("v_payment_method is distinct from 'upi'");
    expect(migration).toContain("payment pending");
    expect(migration).toContain("payment_method");
  });
  it("adds unique source references, signed balances and no historical mutation",()=>{
    expect(migration).toContain("online_stock_allocation_balances");
    expect(migration).toContain("stock_after = stock_before - quantity");
    expect(migration).toContain("online_allocations_unique_variant_order");
    expect(migration).toContain("where transaction_type='sale_online'::public.inventory_tx_type");
    expect(migration).not.toMatch(/delete\s+from\s+public\.inventory_transactions/i);
    expect(migration).not.toMatch(/update\s+public\.inventory_transactions/i);
  });
  it("shows order refs without calling anonymous customers staff",()=>{
    expect(history).toContain("Online order stock allocation");
    expect(history).toContain("reference_order_id");
    expect(history).toContain(" · Actor ID ");
    expect(history).not.toContain(' · Staff ID "+String(tx.created_by)');
  });
  it("runs an isolated SQL migration test against a new disposable database",()=>{
    expect(dbtest).toContain("online order");
    expect(dbtest).toContain("transaction_type='sale_online'");
    expect(dbtest).toContain("Insufficient stock unexpectedly accepted");
    expect(dbtest).toContain("Duplicate variants unexpectedly accepted");
    expect(dbtest).toContain("Migration rerun duplicated history or orders");
    expect(workflow).toContain("CREATE DATABASE rainbow_online_ci");
    expect(workflow).toContain("tests/sql/online_order_source_ledger.sql");
  });
});
