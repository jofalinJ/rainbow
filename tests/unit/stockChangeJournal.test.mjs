import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261017220000_stock_change_journal.sql");
const integration=read("tests/sql/stock_change_journal.sql");
const controller=read("admin/inventory-adjustments.mjs");
const html=read("admin/inventory.html");
const workflow=read(".github/workflows/ci.yml");

describe("staged database stock journal",()=>{
  it("does not mutate existing stock or inventory transaction history",()=>{
    expect(migration).toContain("create table if not exists public.stock_change_events");
    expect(migration).toContain("from public.product_variants");
    expect(migration).not.toMatch(/update\s+public\.product_variants\s+set/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.inventory_transactions/i);
    expect(migration).toContain("where event_kind='BASELINE'");
    expect(migration).toContain("on conflict do nothing");
  });
  it("captures inserts, changed balances and deletes atomically",()=>{
    expect(migration).toContain("after insert on public.product_variants");
    expect(migration).toContain("after update of stock_quantity on public.product_variants");
    expect(migration).toContain("old.stock_quantity is distinct from new.stock_quantity");
    expect(migration).toContain("after delete on public.product_variants");
    expect(migration).toContain("new.stock_quantity-old.stock_quantity");
    expect(migration).toContain("quantity_delta=stock_after-stock_before");
    expect(migration).toContain("lock table public.product_variants in share row exclusive mode");
    expect(migration).toContain("begin;");expect(migration).toContain("commit;");
  });
  it("guards the journal from browser writes and has role-restricted reads",()=>{
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.stock_change_events");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("s.active=true and s.role in ('admin','inventory_staff')");
    expect(migration).toContain("least(greatest(coalesce(p_limit,30),1),100)");
    expect(migration).toContain("grant execute on function public.get_variant_stock_events");
  });
  it("exposes a distinct event view without mixing the transaction ledger",()=>{
    expect(controller).toContain('rpc("get_variant_stock_events"');
    expect(controller).toContain('from("inventory_transactions")');
    expect(controller).toContain("renderObserved");
    expect(html).toContain('id="stockObserved"');
    expect(html).toContain("business reason");
  });
  it("has an isolated PostgreSQL regression suite with rollback and permissions",()=>{
    expect(integration).toContain("rollback;");
    expect(integration).toContain("set role authenticated;");
    expect(integration).toContain("deactivated staff could read stock journal");
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("tests/sql/stock_change_journal.sql");
  });
});
