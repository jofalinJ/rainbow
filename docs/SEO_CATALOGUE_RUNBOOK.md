# Rainbow Gold Covering — public catalogue SEO release

## Purpose and current architecture

The public shop is hosted on GitHub Pages at https://rainbowgoldcovering.com.
Previously the sitemap only listed three static URLs, while individual product
detail pages relied on JavaScript loading data from Supabase.

This change adds a **build-time, read-only** generator:
- `scripts/generate-seo-pages.mjs` reads public rows with the existing
  Supabase **publishable** key. It does not use a service-role key or alter data.
- For eligible, image-bearing, active products in active and storefront-visible
  categories it creates crawlable HTML at `/products/<name>-<uuid>/`.
- For categories with eligible products it creates browse pages at
  `/categories/<category>/`, with 24 products per page, plus `/categories/`.
- Each product HTML response contains a title, canonical, description, visible
  name, actual product image, INR price, description and Product JSON-LD.
- Product CTA links to the existing live `/product.html?sku=...` experience,
  where current inventory and checkout options are checked again.
- The XML sitemap is generated alongside these pages, so its listed product
  URLs exist in the same publication. Unpublished products are excluded.
- The generated site uses existing CSS/assets, without changing payment code,
  authentication, private data, or database schema.

## Important approval checks BEFORE publishing

1. **Review active product rows for demo/test records.** An active product in an
   active, storefront-visible category that has a public HTTPS image and a valid
   price may appear in Google. The generator also handles out-of-stock active
   products using `OutOfStock` markup. Archive/disable test records before launch.
2. Confirm the production domain still points to GitHub Pages (four A records
   ending in `185.199.*.153` plus the existing `www` CNAME). No DNS change
   is necessary for the SEO upgrade.
3. In GitHub **Settings → Pages → Build and deployment → Source**, switch from
   **Deploy from a branch** to **GitHub Actions**. This is required for the
   generated pages to be part of the published site. Do not change DNS.
4. Merge the reviewed SEO PR into `main`. The new Actions workflow will run on
   main pushes, every six hours, and manually via **Actions → Publish SEO
   catalogue (GitHub Pages) → Run workflow**.
5. Confirm the GitHub Pages deployment is successful and that the public
   `/categories/`, sample `/products/.../`, and `/sitemap.xml` all respond
   with actual HTML/XML. Check that no private data appears in the pages.
6. In Search Console, inspect representative category and product URLs and
   monitor indexing. Crawling/indexing is not guaranteed.

## How publication updates work

Changes to Supabase product data become reflected in generated HTML and the
sitemap **on the next successful workflow run**, currently at most roughly six
hours apart (GitHub's cron is best-effort and may be delayed). Use manual
`workflow_dispatch` for an urgent product publication or withdrawal.

The generator does not modify source-of-truth stock, pricing, payments or
customer data. A generated price/availability is a snapshot, not a live
guarantee; customers select variants on the existing live product page.
Before enabling a more real-time Merchant Center feed, consider making
the publish action trigger the workflow and tightening this refresh interval.

## Security and scope boundaries

Only `products.active=true`, `categories.active=true`,
`categories.show_in_storefront=true`, and products with real HTTPS product
images and valid prices are included. RLS continues to control the public
Supabase API. No anonymous access grants or migrations are introduced.
No private order, staff, attendance or invoice URLs are included in the sitemap.

The existing storefront app, cart, checkout, staff PWA and admin pages remain
unchanged. The Pages artifact builder excludes backend code, Supabase
migrations, documentation, tests and repository configuration.

## Known follow-up work

- Stable old-slug redirects when a product/category is renamed. Product UUIDs
  prevent collisions, but a rename changes its URL in the current generator.
- Ideally an event-driven GitHub workflow dispatch when an admin publishes,
  archives, changes price/stock or updates product images (without exposing a
  GitHub token in frontend code).
- Deeper SEO category descriptions, analytics, local business markup using
  verified business details, image size variants, and performance benchmarks.
- Search Console reporting, canonical deduplication for the old SKU query
  links, and Rich Results validation.
- Automated deployed-page smoke tests after Pages publishes, including
  structured-data comparison to current live products.

## Rollback

If the Actions deployment fails, inspect its logs. You can switch GitHub
Settings → Pages → Source back to **Deploy from a branch**, selecting
`main` and `/(root)`, to restore the previous storefront publication mode.
The DNS and Supabase database do not need to be changed.

Generated files are not committed to `main`; they are built and published
atomically as the Pages artifact. `scripts/seo-manifest.json` is a
build artifact produced during generation, not a checked-in file.
