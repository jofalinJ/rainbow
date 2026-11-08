# Cloudflare Pages SEO catalogue staging

This is an opt-in Cloudflare Pages generator, not the older GitHub Pages action.
The normal storefront, admin and staff paths remain unchanged.

## What is generated
- Server-readable category pages and product pages under /categories/ and /products/
- Product JSON-LD, canonical links, images, price and availability snapshots
- An XML sitemap listing static site pages plus **online-published** products/categories
- Private orders, staff data, attendance, invoices and unpublished products are excluded

The generator uses only the Supabase publishable key and adds an explicit
`erp_online_listings!inner(published)` filter. It does not write to Supabase.

## Activation gates
1. Apply and verify the staged public product visibility RLS migration on isolated staging.
2. Remove test/dummy product records and verify category names, product images and GST/HSN classification.
3. Run `node --test tests/seo/seo-pages.test.mjs` and `npm run build:pages` in CI.
4. After safe rollout, set Cloudflare Pages build environment variable `RAINBOW_SEO_CATALOGUE_APPROVED` to `true`; the build will generate crawlable pages. If unset, it will not copy any generated category/product files.
5. For periodic regeneration after product publication, create a Cloudflare Pages deploy hook. Save the URL as GitHub Actions secret `CLOUDFLARE_PAGES_DEPLOY_HOOK_URL` and set repository variable `RAINBOW_SEO_CATALOGUE_APPROVED=true`. The optional workflow requests a rebuild every six hours (GitHub schedules are best effort).
6. Check sample /categories/, /products/.../, and /sitemap.xml on the actual domain and submit sitemap to Google Search Console.

Publication/unpublication becomes visible in generated pages after the next successful Cloudflare Pages build. For urgent unpublishing, trigger a controlled deploy immediately; a six-hour interval is not an immediate safety guarantee.

No production deployment or SEO setting change is performed by this commit.
