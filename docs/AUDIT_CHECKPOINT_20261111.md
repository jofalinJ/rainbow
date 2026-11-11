# Rainbow Gold Covering — verified engineering audit checkpoint
**Date:** 11 November 2026  
**Project:** https://rainbowgoldcovering.com · https://github.com/jofalinJ/rainbow  
**Scope:** 15-phase storefront, multi-shop ERP, payment, invoice, security and release audit.

## Executive status
**NOT READY FOR FULL COMMERCIAL LAUNCH.** The inspected repository, production Supabase schema and read-only reconciliation, and connected GitHub Actions provide evidence of several working foundations. However the live catalogue currently has no products or allocated stock; authenticated staff E2E is skipped without isolated test credentials; a real paid checkout/refund has not been safely demonstrated; WhatsApp Cloud API delivery is not activated; and some security/performance advisors need decisions. A passing unit suite alone is not a merchant acceptance test.

## Verified and changed in this audit
| Issue | Verified problem | Action / evidence | Status |
| --- | --- | --- | --- |
| SEC-01 | Nine legacy RLS policies permitted authenticated non-staff users to write non-online orders, items and payments | [PR #95](https://github.com/jofalinJ/rainbow/pull/95), migration `20261111223000_restrict_local_billing_rls.sql`, isolated SQL regression and CI success; deployed and re-queried all nine production policies | FIXED + DB VERIFIED |
| WA-01 | Storefront always sent `whatsapp_opt_in:false`, so existing paid-invoice outbox could not enqueue customer messages | [PR #96](https://github.com/jofalinJ/rainbow/pull/96): optional unchecked consent at checkout, state passed to Razorpay backend, privacy disclosure, unit tests. [PR #97](https://github.com/jofalinJ/rainbow/pull/97): updated outdated Public E2E test; live smoke passed | DEPLOYED; LIVE SEND BLOCKED |
| WA-02 | Ten-digit Indian checkout numbers would not match E.164 outbox allowlists | [PR #98](https://github.com/jofalinJ/rainbow/pull/98): normalization trigger and isolated PostgreSQL tests. Managed Supabase migration succeeded; production INSERT/UPDATE trigger presence verified | FIXED + DB VERIFIED |
| REPORT-01 | Admin daily sales included orders that were not cancelled/refunded even when payment failed or remained pending | [PR #99](https://github.com/jofalinJ/rainbow/pull/99): require paid payment status and exclude cancelled/refunded, with mocked dashboard unit test; CI passed | FIXED IN MAIN |

**No live payment, real refund, customer WhatsApp message, stock transfer, or customer/order modification was performed during this audit.**

## 15-phase review matrix
| Phase | What was examined or verified | Status / remaining gate |
| --- | --- | --- |
| 1. Repository & architecture | GitHub main tree, Worker routes, Supabase migrations, branch/PR history, CI workflows | VERIFIED REPOSITORY INSPECTION; historical migration IDs differ from filenames, do not blindly bulk push |
| 2. Product management | Product CRUD UI/scripts, category/variant/images, product-entry fixture and unit tests | TESTED IN ISOLATION; production has 0 products/variants, real add/edit/delete/upload not exercised |
| 3. Online stock publishing | Shared ERP catalogue, online-listing policies, owner quick-publish and fixture tests | TESTED IN ISOLATION; 0 production online listings so no live publish test |
| 4. Inventory & multi-shop ERP | ERP locations, per-location balances/transfers/reservations; staged SQL tests | TESTED IN ISOLATION; 3 ERP locations, 0 stock balances; no real POS or multi-branch transfer tested |
| 5. Order management | Admin orders filters, historical order/payment status and daily sales calculations | PARTIALLY VERIFIED; historical 4 orders (3 cancelled/failed, 1 confirmed/paid); no new customer purchase |
| 6. Razorpay payments | Worker gateway code, server-side verification and SQL regression, read-only provider smoke | TESTED IN ISOLATION; no live charge/refund/reconciliation in this audit |
| 7. Billing & invoice/WhatsApp | POS branch source, invoice function & permissions, invoice records, Supabase Edge Function and Worker sender | PARTIALLY VERIFIED; 1 invoice and no duplicate; 0 WhatsApp notifications; cloud sender test-only, Meta production onboarding blocked |
| 8. Accounts & storefront | Static customer routes, account/order source and public Selenium tests | PUBLIC E2E PASSED; authenticated purchase/order-history behavior not live tested |
| 9. Admin & staff security | Sidebar role gates, staff profiles, RLS write policies, SECURITY DEFINER function grants | MAJOR RLS FLAW FIXED; authenticated E2E and real staff/tablet access remain untested |
| 10. Supabase security & integrity | All public tables RLS-enabled; policies, privileged RPCs, duplicate invoice and negative-stock queries | ZERO invalid sampled stock/invoices; leaked-password protection disabled; advisor findings need review; restore drill pending |
| 11. SEO | robots.txt, sitemap.xml, SEO generator + gating, category/product URL sources | SOURCE REVIEW; static sitemap lacks products because catalogue empty; generated SEO requires owner approval/config |
| 12. UI/UX responsive | Existing mobile/desktop CSS, checkout Selenium viewport checks and UI fixture tests | TESTS PASS IN CI; complete manual Android tablet/device matrix not performed |
| 13. Performance/cleanup | Audit scripts, asset checks, performance advisors, duplicate indexes and FK index warnings | PARTIALLY REVIEWED; 25 unindexed foreign keys, 14 unused-index advisories and duplicate invoice index; no blind index removal |
| 14. Automated/E2E testing | GitHub CI, disposable payment/ERP SQL, public Selenium, fixture/unit tests | VERIFIED EXISTING CHECKS; isolated Supabase integration and authenticated staff Selenium jobs SKIPPED due environment switches/secrets |
| 15. Implementation/release | PRs, migrations, production Pages builds, smoke checks, rollback caveats | CHANGES DEPLOYED/VERIFIED AS ABOVE; full merchant release gate remains BLOCKED |

## Production data snapshot (read-only queries)
- `public.products`: **0**
- `public.product_variants`: **0**
- `public.erp_online_listings`: **0**
- `public.erp_stock_balances`: **0**
- `public.erp_locations`: **3**
- `public.orders`: **4**, of which **3 cancelled/failed** and **1 confirmed/paid**
- `public.payments`: **4**, of which **3 failed** and **1 paid**
- `public.invoices`: **1**, no duplicate order invoice detected
- `public.whatsapp_notifications`: **0**
- No negative legacy stock, invalid ERP balance or orphan online listing found (empty stock tables make these non-probative for a real checkout).

## Unresolved operational and security issues (do not conceal)
1. **Customer WhatsApp live invoice sending:** Existing `backend/rainbow-api/src/whatsapp.js` is deliberately restricted to Razorpay TEST keys and allowlisted test recipients; Meta Business app registration/account confirmation, approved utility template, production sender, credentials and actual delivery webhooks are not completed. Do not activate messages or send invoices to customers without opt-in. Current sender records Meta acceptance, **not delivered/read** status.
2. **Zero catalogue/stock:** Owner must add real products, photos, prices and physically reconciled branch stock, then authorize online allocations. This is an intentional business-data gate, not an instruction to invent inventory.
3. **Payment acceptance:** Use isolated test credentials and an explicitly authorized final merchant acceptance for settlement, refund, double-charge, tax rounding and invoice reconciliation. Live checkout is not tested just because read-only provider checks pass.
4. **Staff authenticated acceptance:** Isolated Supabase and Selenium test environment switches/secrets remain absent or disabled in CI. Do not use production customer data for these tests.
5. **Supabase security:** Leaked-password protection advisor warns disabled. Public `get_public_invoice(uuid)` SECURITY DEFINER access is deliberate bearer-token design; audit token leakage, rate limiting and privacy before changing grants. Other authenticated SECURITY DEFINER functions require individual guard review, not blanket revocation.
6. **Supabase performance:** Advisor reported unindexed FKs, overlapping policies and one duplicate invoice index. Benchmark and stage any changes before production, especially on order/ERP tables.
7. **SEO:** Confirm authoritative Cloudflare publication mechanism, `RAINBOW_SEO_CATALOGUE_APPROVED`, and generated pages only when real products have been published.
8. **Backup and deployment:** Restore drill, branch/staff tablet workflows, rollback rehearsal and external provider credentials/configuration remain to be verified before declaring production ready.

## Release evidence
- [PR #95](https://github.com/jofalinJ/rainbow/pull/95): RLS fix CI, staged ERP SQL, payment SQL all passed.
- [PR #96](https://github.com/jofalinJ/rainbow/pull/96) + [PR #97](https://github.com/jofalinJ/rainbow/pull/97): checkbox restoration, updated browser assertion; latest Public E2E after #97 passed.
- [PR #98](https://github.com/jofalinJ/rainbow/pull/98): isolated WhatsApp recipient SQL and main CI passed; migration and trigger verified in Supabase.
- [PR #99](https://github.com/jofalinJ/rainbow/pull/99): admin paid-sales-only fix passed branch CI.
- Production Pages builds and Public E2E successes are observable in GitHub Actions for the corresponding commits. A green status is not a substitute for real merchant-paid checkout or staff acceptance testing.

## Safe next-action checkpoint
1. Create/enable isolated Supabase database and authenticated browser QA credentials. Complete admin, cashier, online purchase, cancellation, branch isolation, printing and inventory tests with disposable data.
2. Finish Meta Developer verification and approved utility invoice template; configure secrets behind a default-OFF production flag. Complete sender security, deduplication, WhatsApp status webhook and one explicitly authorized test recipient delivery before live activation.
3. Add and reconcile physical product inventory, then allocate only merchant-approved quantities online and verify storefront listings and SEO pages.
4. Enable available Auth leaked-password protection and review Supabase advisor findings with individual function/policy audits.
5. Validate one fully controlled end-to-end payment/invoice/stock/fulfillment flow and obtain merchant/accountant release signoff.

**Final verdict: NOT READY FOR PRODUCTION** (full commercial launch), although specific audited fixes are merged and verified.
