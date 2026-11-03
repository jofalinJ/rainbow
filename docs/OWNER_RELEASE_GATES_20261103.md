# Rainbow Gold Covering — Merchant Release Gates
Verified on 3 November 2026. This is a checklist, not permission to collect payments or apply production SQL.

## Read-only preflight

Run:
- node --test tests/ops/owner-readiness.test.mjs
- node scripts/owner-readiness.mjs
- node scripts/owner-readiness.mjs --json

Alternatively launch GitHub Actions > Owner release preflight (read-only). Download the report artifact.

The preflight makes GET requests for public website pages, policy URLs, sitemap and robots, Razorpay configuration and provider readiness, and publicly visible active products/variants through a publishable Supabase key. It never reserves stock, creates orders, sends messages, charges cards, or changes production database rows.

## Observed production baseline

- Live Supabase currently has 0 products, 0 product variants, 0 stock balances, 0 orders and 0 invoices.
- ERP activation flag enabled, with 3 locations. No staff/POS transaction with actual inventory was tested.
- The GitHub Razorpay LIVE readiness check reported mode=live, enabled=true and provider=connected on November 3. This does NOT prove a real paid-invoice transaction succeeded.
- Current static sitemap has only 3 URLs, no products or category pages.
- GitHub repository is public. Check current GitHub Pages plan and deployment before attempting to make the repository private; otherwise publishing may break.
- Some historical runbooks still claim Razorpay TEST-only. Trust the deployed gateway and merchant dashboard, not stale runbook status.

## Payment and tax release gates

- [ ] Merchant verifies Razorpay live activation, bank account, capture settings, webhook signature and settlement reconciliation.
- [ ] Run controlled authorized payment, decline, duplicate callback, lost callback, refund and delayed capture in an isolated setup; a single captured payment must result in one invoice and one stock deduction.
- [ ] Review interstate GST and item HSN with accountant. Current code calculates CGST 1.5% plus SGST 1.5% for all destination states, including interstate. Fix database calculations, stored tax classification, checkout preview and invoice together. Do not ship a label-only fix.
- [ ] Validate shipping, discount, tax, final amount and invoice figures against gateway and backend authoritative totals.
- [ ] Only paid orders may be confirmed or have downloadable paid invoices. Verify refund-required/late settlements handling.

## Inventory and staff release gates

- [ ] Merchant provides real product codes, images, variants, classification, prices and warranty claims.
- [ ] Enter and physically reconcile initial branch and ONLINE stock separately.
- [ ] Test duplicate stock transfer, receipt, rollback and insufficient stock scenarios.
- [ ] Authenticate admin and each branch staff account on Android tablets, verify cross-branch access denied.
- [ ] Test POS retry once, unique invoice, inventory decrement once and failure rollback.
- [ ] Test attendance, AWB courier tracking, invoice printing, opt-in messages and business reports.

## Security and recovery release gates

- [ ] Inspect every privileged Supabase SECURITY DEFINER function for role checks and EXECUTE grants. Advisor warnings are not automatically vulnerabilities; do not blindly revoke required functions.
- [ ] Audit anonymous invoice token access and confirm no unpublished or unpaid invoice leaks.
- [ ] Enable leaked-password protection if available and require unique staff credentials.
- [ ] Test RLS as guest, customer, staff, branch staff and admin.
- [ ] Rehearse a backup restore into an isolated database, never production.
- [ ] Audit GitHub repository visibility, secrets handling, domain TLS, policies and support details.

## Browser and deployment release gates

- [ ] Test responsive layouts, navigation, cart, account, products and checkout at 320/360/390/428/768/1280/1440px.
- [ ] Test genuine product publication/unpublication, SEO metadata, sitemap refresh and empty catalogue.
- [ ] Complete CI, public Selenium, authenticated staff and isolated Supabase integration; skipped checks are not passes.
- [ ] Reconcile or retire old PR #39, #40, #44, #46 and review draft PR #54.
- [ ] Review rollback plan, deployment logs and live E2E before promoting changes.

## Owner decision

NOT READY FOR FULL COMMERCIAL LAUNCH until products/stock exist, tax and receipts are correct, payment reconciliation is demonstrated, and authenticated POS and security checks pass.

Owner sign-off: pending. Accountant approval: pending. Payment reconciliation: pending. Staff acceptance: pending.
