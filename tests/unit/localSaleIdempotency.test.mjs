import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261017214500_local_sale_idempotency.sql");
const billing=read("admin/billing.js");
const page=read("admin/billing.html");

describe("P0 local sale idempotency contract",()=>{
  it("makes operation IDs unique and saves the response atomically with the sale",()=>{
    expect(migration).toContain("operation_id uuid primary key");
    expect(migration).toContain("on conflict (operation_id) do nothing");
    expect(migration).toContain("returning operation_id into v_inserted");
    expect(migration).toContain("v_result := public.create_local_sale(p_items,p_customer,p_payment_method)");
    expect(migration).toContain("set response=v_result where operation_id=p_operation_id");
    expect(migration).not.toMatch(/commit\s*;/i);
  });
  it("checks staff authorization and isolates operations from other users",()=>{
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("s.active=true and s.role in ('admin','cashier')");
    expect(migration).toContain("v_saved.actor_id <> v_actor");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.local_sale_idempotency");
    expect(migration).toContain("revoke execute on function public.create_local_sale_once");
    expect(migration).toContain("grant execute on function public.create_local_sale_once");
  });
  it("protects payload replay and duplicated variants",()=>{
    expect(migration).toContain("pg_catalog.sha256");
    expect(migration).toContain("pg_catalog.convert_to");
    expect(migration).toContain("v_saved.request_hash <> v_hash");
    expect(migration).toContain("count(distinct x.value->>'variant_id')");
    expect(migration).toContain("Duplicate variants in one sale are not allowed");
  });
  it("retries the same immutable sale operation and does not call legacy RPC",()=>{
    expect(billing).toContain('rpc("create_local_sale_once"');
    expect(billing).not.toContain('rpc("create_local_sale"');
    expect(billing).toContain("pendingSale={");
    expect(billing).toContain("operationId:crypto.randomUUID()");
    expect(billing).toContain("p_operation_id:attempt.operationId");
    expect(billing).toContain("p_items:attempt.items");
    expect(billing).toContain("p_customer:attempt.customer");
    expect(billing).toContain("p_payment_method:attempt.payment");
    expect(billing).toContain("if(cart.size===0||saleInFlight)return");
    expect(billing).toContain("setSaleHold(pendingSale.operationId)");
    expect(billing).toContain("setSaleHold(null)");
  });
  it("does not silently restart an uncertain sale after reload",()=>{
    expect(billing).toContain("getSaleHold()&&!pendingSale");
    expect(billing).toContain("Review Bills");
    expect(billing).toContain('confirm("Have you checked Bills AND the payment record');
    expect(page).toContain('id="saleHoldActions"');
    expect(page).toContain('id="clearSaleHold"');
    expect(page).toContain('href="bills.html"');
    expect(page).toContain("billing.js?v=20261017-idempotent");
  });
});
