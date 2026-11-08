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
