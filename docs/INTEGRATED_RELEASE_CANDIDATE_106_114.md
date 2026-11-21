# Rainbow Gold Covering — Integrated Release Candidate #115

**Status:** Non-production draft; integration PR to `main`. All production changes require separate owner approval. The public storefront, payment configuration, database, inventory, Meta account, and hosted assets remain unchanged by this release-candidate branch.

## Source branches

This draft assembles exactly the code changes proposed in PRs #106–#114, plus a regression test for cross-feature coexistence and this release plan. The sole overlapping file was `admin/app.js`: it retains the owner-only Audit History entry from #110 and the full India-day paid-sales query from #114. All other PR-head file contents were reused unchanged.

| PR | Focus | Safe behavior |
| --- | --- | --- |
| #106 | Live storefront smoke test | Checks WhatsApp opt-in checkbox and current script version |
| #107 | Reporting, offline POS, backup inspection | Paid-only revenue; cash mismatch records are review-only; encrypted archive TOC check never writes to production |
| #108 | Interstate IGST | Shows IGST correctly in admin order breakdown |
| #109 | Razorpay refund reconciliation | Fetches verified provider refund/payment; records status only; never initiates refunds or restocks |
| #110 | Operational audit | Staged RLS-restricted owner audit journal and UI; no raw customer PII |
| #111 | SEO preview | Generates reviewable public product/category pages without bypassing deployment approval |
| #112 | Production WhatsApp | Default-off, paid+opt-in restricted outbox claim, Meta sender-number verification |
| #113 | WhatsApp delivery | Signed callback with latest-status storage and pre-ack handling |
| #114 | Owner daily sales | Paged paid order totals over Asia/Kolkata business day |

## Combined test plan

All nine source PRs previously passed individual CI. The integration PR must also pass:
1. Repository lint, asset audit, unit tests, checkout and product/offline POS fixture browser tests, static build, and security audit.
2. Cloudflare Worker syntax, payment/refund mocks, WhatsApp opt-in/sender mocks, signed delivery webhook mocks.
3. Disposable PostgreSQL payment/GST/online-markup/WhatsApp recipient tests.
4. Disposable PostgreSQL audit RLS/triggers, production consent claim, and WhatsApp delivery status/idempotency tests.
5. Read-only live-readiness smoke and preview-only SEO generation.
6. Combined `tests/unit/releaseCandidateIntegration.test.mjs` surface-preservation and non-deploy assertion.

**Not covered automatically unless separately provisioned:** Authenticated staff Selenium E2E, isolated Supabase integration, actual Razorpay provider settlement/refund, Meta delivery to a consenting device, real Android tablets, scanner/thermal printer, physical stock count, or backup restoration.

Never mark skipped acceptance checks as passed.

## Production execution order (requires owner approval)

1. **Preflight:** Verify the production branch/release fingerprint, inspect Supabase security and performance advisors, confirm Razorpay payment/outbox balances, record a protected encrypted backup, and complete an isolated restore exercise. Ensure prior Cloudflare Pages/Worker deployments are available for rollback. Confirm accurate physical stock and branch online allocation before any inventory cutover.
2. **Stage SQL:** Review and apply `20261121140000_admin_audit_trail.sql` (owner audit), then `20261121151500_production_whatsapp_paid_invoice_claim.sql` (default-off live outbox claim), then `20261121163000_whatsapp_delivery_tracking.sql` (Meta status inbox and RPC). Apply exactly once after checking current live schema. SQL permissions and RLS must be independently verified after each migration.
3. **Deploy backend:** Deploy combined Worker with existing live payment mode and credentials unchanged. Keep `WHATSAPP_SEND_ENABLED=false` and `WHATSAPP_PRODUCTION_APPROVED=false`. The Meta callback route may exist but does not send customer messages. Do not activate a refund event before the merchant approves partial-refund handling and provider reconciliation.
4. **Deploy frontend:** Use established approved release process for storefront/admin/static assets. Clear stale versions through script cache busting and the updated offline PWA cache only. Keep public catalogue pages and payment availability uninterrupted.
5. **Public read-only smoke:** Verify home/catalogue, category images, product detail, cart, empty checkout, IGST admin review and reports. Reconcile release check and SEO preview. No production paid test without owner-approved test purchase/refund procedures.
6. **Staff acceptance:** Authenticate an admin and cashier/inventory staff in isolated test accounts, check protected Audit History RLS, offline POS conflict/reconciliation, shop transfers, scanner and printer, role isolation and actual tablet behavior. Record discrepancies without destructive inventory mutations.
7. **WhatsApp onboarding:** Verify the actual sender ID/number in Meta, approved utility template/language/parameters, webhook challenge and signature, and status callback. Only after opt-in and explicit merchant approval activate the separate production sender flags for a controlled recipient; provider message-ID acceptance does **not** prove delivery.
8. **Monitor and rollback:** Watch webhook failures, reconciliation warnings, stock, invoice mismatches, outbox status and owner audit history. Disable WhatsApp send switches immediately on unexpected traffic. Revert frontend/Worker deploy via previous release if needed; database rollback requires a separate reviewed, non-destructive migration plan. Do not drop audit/history tables to roll back a frontend issue.

## Business-policy decisions to resolve outside code

- Current `record_razorpay_refund` database function marks an order cancelled for partial refund and refunded for a full refund. Confirm whether this is appropriate before subscribing to `refund.processed`; returns and exchanges need separate physical stock receipt and merchant authorization.
- The existing logical Online Store stock location must not be counted as additional physical jewellery without matching shop counts and transfers.
- Offline POS across two disconnected devices cannot guarantee the last item is not sold twice; designate an offline tablet per branch or implement stronger per-device stock allocation.
- Meta WhatsApp invoice send consent and delivery tracking must be verified; no unsolicited customer messaging.
- The audit journal records changes only after deployment, not retroactive events; define retention and restricted operator access.

## Approval boundaries

No integration commit merges to `main` or deploys itself. No service shutdown, maintenance screen, checkout suspension, customer/order/stock record mutation, real payments/refunds, or customer WhatsApp sends are authorized by this draft. The shop stays available throughout review.
