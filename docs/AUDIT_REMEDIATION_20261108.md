# Rainbow audit remediation — November 8, 2026

## Changes staged for review
- Public catalogue and SKU detail views now require an explicit published ONLINE listing. A separate RLS migration closes the direct anonymous API route while preserving staff access.
- Buy Now adds/updates its item in the existing bag instead of discarding other cart lines; checkout reviews the entire bag.
- Interstate tax calculation, stored breakdown, and invoice rendering are staged from PR #56. The merchant/accountant must verify HSN/product rate and supplier place of supply before the tax migration is promoted.
- Adds an isolated SQL GST test, unit coverage for the tax split, and publication/cart source regression checks.

## Production migration lineage — do NOT blindly push
The live Supabase project contains 48 migration-history entries (checked November 8).
The repository currently has 36 SQL migration filenames, but only 10 filenames share the same version ID with live history.
Numerous applied changes used different IDs/names. This is NOT evidence that 26 migrations are unapplied.
Before any Supabase CLI migration push, compare object definitions and reconcile each migration's applied version with a verified mapping in an isolated clone.
Do not insert dummy rows into supabase_migrations.schema_migrations or change production migration history based on filenames alone.

## Outstanding release gates
- Provision isolated Supabase integration and authenticated staff E2E secrets. They are currently skipped; a green CI summary is not proof these tests passed.
- Run staged ERP SQL and GST SQL on disposable Postgres, then authenticated branch-role checks.
- Confirm correct invoice, sale, refund, rounding, delivery, and gateway totals using a controlled isolated payment test; do not run production payment transactions for testing.
- The online location had zero available units while two branches held 82 units as of November 8. No production inventory was moved. The merchant should select a physical quantity to allocate and reconcile transfer receipts.
- Enable leaked-password protection in Supabase Auth if the project's plan supports it; review each SECURITY DEFINER RPC before changing access.
- Crawlable product/category pages and generated sitemap are implemented in the staged Cloudflare build and remain disabled unless `RAINBOW_SEO_CATALOGUE_APPROVED=true` is configured on Cloudflare Pages. For scheduled updates, configure the separate GitHub deploy-hook workflow. Inspect live catalogue first.

## Safe promotion order
1. Review source changes and payment/tax classification, confirm all required CI checks pass.
2. Reconcile migration lineage and apply schema changes to isolated staging first.
3. Deploy compatible storefront code with controlled rollout coordinated with the matching DB migration (a mismatched checkout version must not charge customers).
4. Verify storefront/publication, payments, staff branch permissions and invoice PDF before production promotion.

---

# Rainbow Gold Covering — Production release report (8 November 2026)

## Confirmed deployed state
- PR #68 was squash-merged to `main` as commit `98dfbe1875a44827fb8de680f38bd694536e9fd3`.
- The GitHub Pages build/deploy and CI for that commit completed successfully.
- Post-deployment public Selenium smoke checks passed.
- Production Supabase migrations applied using the managed migration API:
  - `20261108092953 interstate_igst_checkout_20261108`
  - `20261108093009 restrict_public_product_visibility_20261108`
- Read-only verification confirmed the IGST order column, tax-aware checkout/invoice functions, and published-only product RLS; anonymous gateway SQL EXECUTE remains revoked.
- No real orders, refunds, stock transfers, or charges were made as part of the release.

## Residual operational gates — not silently changed
- **Online inventory:** the only verified online allocation was zero units on 8 November 2026 (physical branch stock was 82 units). An authorized operator must decide which variants/quantities to allocate.
- **SEO:** Cloudflare generator/code shipped but `RAINBOW_SEO_CATALOGUE_APPROVED` is not confirmed enabled. The live GitHub Pages build is also active. Confirm the authoritative site provider and enable the matching SEO build workflow before claiming generated category/product URLs or automatic sitemap publishing.
- **Authentication security:** Supabase leaked-password protection remains disabled; change it in Supabase Auth settings when available. Public invoice token RPC has intentional anonymous access; do not revoke blindly without replacing the token-based invoice workflow.
- **CI test coverage:** isolated Supabase integration and authenticated staff Selenium E2E jobs remained skipped due missing nonproduction test-environment switches/secrets. Their absence is a release assurance limitation; create a separate isolated environment to close it.
- **Tax scope:** official 3% GST guidance supports imitation jewellery HSN 7117 except excluded lac/shellac bangles. Product-by-product HSN/place-of-supply compliance remains a merchant/accountant obligation.
- **Migration lineage:** previous live migration IDs do not align one-to-one with repository filenames. Never run a blind bulk push; use the managed applied versions or reconcile on a verified isolated clone.

## Monitoring
The `live-release-smoke.yml` workflow checks public checkout tax markup and publication filtering against the canonical live domain after future source changes. Green CI alone must not be interpreted as proof that connected Cloudflare builds deployed; use this live asset check.
