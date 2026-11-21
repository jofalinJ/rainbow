# Rainbow Gold Covering — pending SQL migration release readiness

**Date:** 21 November 2026. **Scope:** read-only production metadata validation plus six-migration isolated PostgreSQL rehearsal. This branch is NOT a deployment instruction.

## Verified deployment starting point

- GitHub `main` is merged at `1675ca4a70a33f7c74989d43d8b0a1c49037c580`.
- GitHub Pages successfully built/deployed that code. Public storefront and read-only E2E checks passed. **A GitHub code merge does not deploy the Supabase SQL or the Cloudflare Worker.**
- Supabase live migration history ends at `20261111125902` (`normalize_whatsapp_invoice_recipient_20261111`). The six November 21 SQL files are not in the database migration history and their main new objects were confirmed absent.
- The connected Supabase workspace exposes only the production project; no isolated authenticated-Supabase test project is available.
- `scripts/production-sql-migration-preflight.sql` ran against the **real production schema using SELECT-only catalog queries**. **12 of 12 dependency checks were READY**; zero blockers discovered at the catalog/column level. This does **not** prove the live DDL would succeed, that a backup is restorable, or that all customers would retain correct authorization after migration.
- The preflight checks existing invoice-token index uniqueness/constraint ownership; critical WhatsApp columns and enum states; staff audit helper and permissions; order/consent tables; verified-email Auth schema; and both customer tracking functions.
- Supabase's security advisor still reports one anonymous security-definer function, 24 authenticated security-definer functions, four RLS tables without policy (likely deliberately private), and leaked-password protection not enabled. Those are separate from the six scheduled migrations.

## Rehearse all pending SQL **together**

The new `.github/workflows/combined-release-sql-ci.yml` builds a disposable PostgreSQL 17 service with **only synthetic customers, orders, invoices, payments, inventory and staff profiles**.

It applies the six exact repository migration files in production order, checks that RLS remains owner-only, receipts remain retrievable only for eligible orders, email tracking respects current verified identity, paid-and-consented WhatsApp claims exclude unpaid orders, provider delivery status arriving before acknowledgement is preserved, and one duplicate invoice index was removed without weakening uniqueness. It then **reapplies all six** and reruns the same checks to identify cross-migration/idempotency defects.

No CI job uses a Supabase production URL, Meta API credentials, Razorpay keys, or any real customer data. The CI result proves synthetic-schema compatibility, not compatibility with every production constraint, trigger or realtime permission.

## Ordered rollout proposal — NOT approved yet

1. **Backup/restore gate:** Obtain a verified, encrypted current Postgres backup with a securely held key. `scripts/verify-encrypted-backup.sh` validates only the archive table of contents; it does **not** demonstrate successful restoration. Restore into a separate project/database and verify invoice counts, stock totals, RLS/privileges and representative reads before changing production.
2. **Merchant settlement gate:** Confirm shop inventory physical counts, online allocations, Razorpay captured/settled/refunded amounts, and risk of partial refunds marking orders cancelled. No payment or refund should be initiated as a test.
3. **Apply approved migrations in order** during a reviewed low-traffic window (one at a time, with check-after-each and rollback plan):
   - `20261121140000_admin_audit_trail.sql` — create owner audit and triggers.
   - `20261121151500_production_whatsapp_paid_invoice_claim.sql` — service-role-only claim function; does not send messages.
   - `20261121163000_whatsapp_delivery_tracking.sql` — provider status table, trigger and service-role-only delivery RPC; does not send messages.
   - `20261121190000_deduplicate_invoice_token_index.sql` — drop only the redundant standalone index, preserving unique public URLs; requires a short DDL lock.
   - `20261121191500_minimize_public_invoice_pii.sql` — stop leaking unused email/street/city/state/pin-code in public invoice JSON while retaining rendered details.
   - `20261121203000_verified_customer_order_tracking.sql` — require a confirmed current Auth email. Note that historical guest checkout orders with no linked verified user remain invisible in signed-in tracking; do not reassign by email without consent.
4. **Validate after SQL:** Re-run the select-only status query, permission/RLS checks, invoice eligibility for approved synthetic tokens, payment/accounting reports, and staff role checks. Use no live charge/refund/WhatsApp send as a test.
5. **Backend decision:** Cloudflare Worker source changes are in GitHub but need a separately approved Worker release. Keep `WHATSAPP_SEND_ENABLED=false` and `WHATSAPP_PRODUCTION_APPROVED=false`; do not subscribe the new live refund webhook before partial-refund policy review.
6. **Hosting/security verification:** GitHub Pages is the verified deployment provider. A Cloudflare Pages `_headers` file is **not** proof that invoice pages receive `Cache-Control: no-store` or `Referrer-Policy: no-referrer` on GitHub Pages. The HTML referrer meta fallback is part of the current site; effective **HTTP response headers still require deployment-path verification**. Hosting-level header enforcement may need an edge proxy/Worker or a separately approved hosting change.
7. **Full auth E2E gate:** An isolated Supabase project, test-only admin/cashier accounts, and GitHub Actions test environment secrets are still required for actual signed-in Selenium tests; simulated localhost Chromium tests are green, but not a substitute.

## Rollback notes

Do not delete audit events, customer records, stock events, orders, or payment records to roll back a deployment. If a new SQL function breaks calls, restore its approved previous definition via an additive migration. If Worker behavior fails, roll back Worker to the prior deployed version and keep WhatsApp flags OFF. If static pages fail, use the prior GitHub Pages release/commit; do not introduce a maintenance/checkout block. Removing tables with historical audit or provider-delivery status can destroy evidence and must not be used as an emergency default.

## Release approval boundary

**No production DDL, Worker deployment, new Supabase project/branch, paid test, real refund or customer Meta WhatsApp messaging has been authorized by this draft.** Owner approval and the restore-rehearsal gate are required before applying the six production migrations.
