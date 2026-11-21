import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("integrated release candidate #106–#114",()=>{
  it("keeps owner audit history and all-order India-day paid sales in the same admin app",()=>{
    const app=read("admin/app.js");
    expect(app).toContain('{label:"Audit History",href:"audit.html",roles:["admin"]}');
    expect(app).toContain("fetchShopDayPaid");
    expect(app).toContain('timeZone:"Asia/Kolkata"');
    expect(read("admin/index.html")).toContain("app.js?v=20261121-paid-daily-sales");
    expect(read("admin/audit.html")).toContain("audit.js?v=20261121");
  });
  it("preserves the IGST review and independent paid-sales report reconciliation",()=>{
    const orders=read("admin/orders.js");
    const reports=read("admin/reports.js");
    expect(orders).toContain("Number(o.igst_amount||0)");
    expect(reports).toContain("fetchAllReportOrders");
    expect(reports).toContain('toLowerCase()==="paid"');
    expect(reports).toContain("loadDailyClose");
    expect(read("admin/reports.html")).toContain('id="closingCashCount"');
  });
  it("retains immutable offline server receipts with cash-review warnings",()=>{
    const core=read("admin/offline-pos-core.mjs");
    const sync=read("admin/offline-pos-sync.mjs");
    expect(core).toContain("reconciliationNote");
    expect(sync).toContain("needsReview");
    expect(sync).toContain("vault.markSynced(sale.id,data,note)");
    expect(read("admin/service-worker.js")).toContain("rainbow-staff-offline-pos-v5");
  });
  it("contains both provider-verified refunds and signed Meta delivery callbacks",()=>{
    const razorpay=read("backend/rainbow-api/src/routes/razorpay.js");
    const worker=read("backend/rainbow-api/src/index.js");
    const webhook=read("backend/rainbow-api/src/routes/whatsapp-webhook.js");
    expect(razorpay).toContain('event.event==="refund.processed"');
    expect(razorpay).toContain('"record_razorpay_refund"');
    expect(worker).toContain("whatsappDeliveryWebhook(request,env)");
    expect(webhook).toContain("X-Hub-Signature-256");
    expect(webhook).toContain("record_whatsapp_delivery_status");
  });
  it("keeps WhatsApp production disabled by default and consent-checked in SQL",()=>{
    const sender=read("backend/rainbow-api/src/whatsapp.js");
    const claim=read("supabase/migrations/20261121151500_production_whatsapp_paid_invoice_claim.sql");
    expect(sender).toContain('env.WHATSAPP_PRODUCTION_APPROVED!=="true"');
    expect(sender).toContain("WHATSAPP_EXPECTED_SENDER_E164");
    expect(claim).toContain("rc.whatsapp_opt_in IS TRUE");
    expect(claim).toContain("REVOKE ALL ON FUNCTION");
    expect(read("supabase/migrations/20261121163000_whatsapp_delivery_tracking.sql"))
      .toContain("ENABLE ROW LEVEL SECURITY");
  });
  it("keeps the audit journal private and SEO previews from bypassing deployment approval",()=>{
    const audit=read("supabase/migrations/20261121140000_admin_audit_trail.sql");
    const workflow=read(".github/workflows/seo-catalogue-refresh.yml");
    expect(audit).toContain("ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY");
    expect(audit).toContain("app_private.erp_is_admin()");
    expect(workflow).toContain("github.event_name != 'pull_request'");
    expect(workflow).toContain("RAINBOW_SEO_CATALOGUE_APPROVED");
    expect(read(".github/workflows/live-release-smoke.yml")).toContain("whatsappReceiptConsent");
  });
});
