# Rainbow Gold Covering — Owner-requested combined merge review (21 Nov 2026)

**Review target:** merge all reviewed code from draft PRs #115, #116 and #117 **once** into GitHub `main`. This is a code merge, **not** authorization to mutate live Supabase data, enable Meta WhatsApp sends, trigger real payments/refunds, change inventory, or independently launch a release rollout.

## Integration snapshot

- Consolidated branch: `hardening/verified-order-tracking-20261121`.
- Base: `main`, retargeted for a single atomic merge rather than a sequence of intermediate potentially auto-deployed commits.
- Total changed files: **74**; includes everything in source PRs #106–#114 and the additions in #115, #116 and #117.
- No review objections were submitted on PRs #115, #116 or #117 at the time of review.
- Main was `690159d40bb360996cfac2c36258ac830823e1df` when integration review began. Confirm it remains unchanged immediately before merging.

## Automated evidence

- The integrated #115 CI/Cloudflare/SEO/Razorpay/disposable PostgreSQL workflows previously passed.
- #116's invoice privacy, duplicate-index integrity, payment regression and general repository CI workflows previously passed.
- #117's verified-customer order/shipment email-security, payment regression and general CI workflows previously passed.
- Newly added localhost-only *real Chromium browser* tests now cover the real staff login form and `admin/app.js` access routing with **fake** in-memory accounts; they require no merchant credentials or production network access. Test cases include anonymous, active admin, cashier, inventory, suspended, archived and unknown accounts; verify owner Audit History and page redirects. These fixtures are **not** evidence of actual Supabase Auth login success.
- **Before the combined merge**, run the full PR-to-`main` CI set on the latest head commit, including all new SQL test workflows, Cloudflare Worker mocks, SEO preview, browser fixtures, and Razorpay smoke. Require all triggered workflows green and acknowledge explicitly skipped jobs.

## Required isolated tests still unavailable

- `Supabase integration (isolated environment)` only runs with an independent test Supabase project and its test service-role key.
- `Authenticated Selenium E2E (isolated environment)` only runs with an isolated Supabase Auth project and test-only user credentials; CI variables `RAINBOW_TEST_ENV_READY` / `RAINBOW_E2E_READY` are unset or false at this checkpoint.
- Only the production Supabase project is connected; **never use production merchant or staff credentials for state-changing automated tests**. A new isolated Supabase project/branch may incur usage charges and requires a separate approved account setup. Until provisioned, do not describe these jobs as passed.

## Production release implications: do not confuse code merge with deployment

A GitHub main-branch merge may cause **automatic external hosting publication** depending on Cloudflare Pages/GitHub Pages settings, which are not governed by the repository's CI-only workflows. Do not assert that the hosted storefront remains unchanged after merging without checking the actual deployment source and live version. All existing public product/customer/checkout routes must remain available; no maintenance page.

The combined SQL changes are **not installed in production** merely because files are merged into GitHub. Stage/review migrations in this order before enabling dependent features:

1. `20261121140000_admin_audit_trail.sql` — Audit History UI needs the table and appropriate owner-only RLS.
2. `20261121151500_production_whatsapp_paid_invoice_claim.sql` — consent/fully-paid claim; sending remains OFF.
3. `20261121163000_whatsapp_delivery_tracking.sql` — signed provider status reconciliation.
4. `20261121190000_deduplicate_invoice_token_index.sql` — guarded single redundant index removal.
5. `20261121191500_minimize_public_invoice_pii.sql` — reduce publicly accessible invoice details.
6. `20261121203000_verified_customer_order_tracking.sql` — require currently verified Supabase Auth email for customer tracking.

These are **production DDL changes** requiring their own reviewed migration/backup/rollback approval and must not be silently run as part of a source-code merge. Until #1 is installed, the new Audit History screen may show an unavailable-state message. Until #5 and #6 are installed, the old public invoice and customer tracking database behavior remains unchanged.

## Explicit live business gates

- Verify real counted shop inventory and online allocation before any stock workflow release.
- Review Razorpay settlements, signed callbacks and partial-refund cancellation business policy. Never initiate a refund as a merge test.
- Confirm real Meta sender number, utility template, opted-in recipients and signed delivery callback. `WHATSAPP_SEND_ENABLED` and `WHATSAPP_PRODUCTION_APPROVED` remain disabled unless owner separately approves.
- Demonstrate encrypted backup restoration in an isolated database before DDL.
- Review Supabase Auth leaked-password protection, privileged RPCs, and RLS advisor warnings.
- Keep receipts and private customer PII out of CI artifacts and user-facing issue logs.

## Safe follow-up

After a single successful merge to `main`, verify the resulting commit and GitHub post-merge checks, check the public website independently, and close original PRs #115 and #116 as superseded by the final integrated merge, without merging the same changes a second time. Keep any original #106–#114 drafts marked superseded when appropriate.
