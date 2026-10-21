import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const file=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const gateway=file("supabase/migrations/20261021194000_razorpay_test_reservation_checkout.sql");
const manual=file("supabase/migrations/20261021202500_manual_upi_guest_idempotency.sql");
const worker=file("backend/rainbow-api/src/routes/razorpay.js");
const opts=file("backend/rainbow-api/src/payment-crypto.js");
const publicConfig=file("payment-config.js");

describe("payment security release gates",()=>{
  it("refuses new Razorpay payments until explicitly enabled with TEST keys",()=>{
    expect(opts).toContain('env.PAYMENTS_ENABLED === "true"');
    expect(opts).toContain("rzp_test_");
    expect(publicConfig).toContain('apiBaseUrl:""');
    expect(worker).toContain("verifyHmac");
    expect(worker).toContain('payment.status!=="captured"');
  });
  it("keeps secrets in the backend and uses private service-role-only checkout RPCs",()=>{
    expect(gateway).toContain("alter table public.razorpay_checkouts enable row level security");
    expect(gateway).toContain("grant execute on function public.create_razorpay_checkout");
    expect(gateway).toContain("to service_role");
    expect(gateway).toContain("auth.role() is distinct from 'service_role'");
    expect(gateway).toContain("pg_advisory_xact_lock");
    expect(gateway).toContain("for update of pv");
  });
  it("never modifies an existing guest customer's record by knowing only the phone",()=>{
    expect(gateway).not.toContain("update public.customers");
    expect(manual).not.toContain("update public.customers");
    expect(manual).toContain("insert into public.customers");
    expect(manual).toContain("manual_upi_checkout_requests");
    expect(manual).toContain("pg_advisory_xact_lock");
    expect(manual).toContain("already_created");
  });
  it("restores expired inventory but flags late capture for manual refunds",()=>{
    expect(gateway).toContain("stock_quantity=stock_quantity+v_item.quantity");
    expect(gateway).toContain("status='expired'");
    expect(gateway).toContain("status='refund_required'");
    expect(gateway).toContain("p_amount_paise is distinct from v_checkout.amount_paise");
  });
});
