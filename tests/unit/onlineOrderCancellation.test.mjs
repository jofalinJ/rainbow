import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261017224500_cancel_unpaid_online_orders.sql");
const spec=read("tests/sql/online_order_cancellation.sql");
const admin=read("admin/orders.js");
const workflow=read(".github/workflows/ci.yml");

describe("guarded, repeat-safe online order cancellation",()=>{
  it("requires active admin and an explicit unpaid verification statement",()=>{
    expect(sql).toContain("s.active=true and s.role='admin'");
    expect(sql).toContain("p_payment_checked is distinct from true");
    expect(sql).toContain("length(v_reason) < 12");
    expect(sql).toContain("for update;");
  });
  it("blocks paid, shipped, older untracked or already returned stock",()=>{
    expect(sql).toContain("v_order.status <> 'pending' or v_order.payment_status <> 'pending'");
    expect(sql).toContain("pay.paid_at is not null");
    expect(sql).toContain("pay.verified_at is not null");
    expect(sql).toContain("from public.order_shipments");
    expect(sql).toContain("having count(it.id) <> 1 or coalesce(max(it.quantity),-1) <> li.qty");
    expect(sql).toContain("it.transaction_type='return'");
    expect(sql).toContain("Legacy cancelled order needs manual inventory reconciliation");
  });
  it("writes exactly-once stock release, cancellation, status audit in a transaction",()=>{
    expect(sql).toContain("order_id uuid primary key references public.orders(id)");
    expect(sql).toContain("if v_order.status='cancelled'");
    expect(sql).toContain("'already_cancelled',true");
    expect(sql).toContain("stock_quantity=v_after::integer");
    expect(sql).toContain("'return',v_line.qty,v_line.qty");
    expect(sql).toContain("insert into public.online_order_cancellations(");
    expect(sql).toContain("insert into public.online_order_status_events(");
    expect(sql).toContain("update public.orders set status='cancelled'");
    expect(sql).not.toContain("update public.payments");
    expect(sql).not.toContain("set payment_status = 'failed'");
  });
  it("restricts direct table access and offers an admin-only order action",()=>{
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.online_order_cancellations");
    expect(sql).toContain("grant execute on function public.cancel_unpaid_online_order");
    expect(admin).toContain('rpc("cancel_unpaid_online_order"');
    expect(admin).toContain("canCancelUnpaidOnlineOrder");
    expect(admin).toContain("cancelPaymentChecked");
    expect(admin).toContain("Cancel order &amp; release stock");
  });
  it("runs isolated database cases including late rollback",()=>{
    expect(spec).toContain("Unauthenticated cancellation unexpectedly succeeded");
    expect(spec).toContain("Cashier cancellation unexpectedly succeeded");
    expect(spec).toContain("Repeated cancellation incorrectly released stock");
    expect(spec).toContain("Untracked legacy order unexpectedly restored stock");
    expect(spec).toContain("Paid order cancellation unexpectedly succeeded");
    expect(spec).toContain("Shipped order unexpectedly released inventory");
    expect(spec).toContain("CI forced status audit failure after inventory release");
    expect(workflow).toContain("CREATE DATABASE rainbow_cancel_ci");
  });
});
