# Rainbow Gold Covering — scalable 10,000-product storefront

This change is a stacked branch based on PR #19 (the non-payment UX upgrade). **Merge PR #19 first.** Payment logic, tax logic, inventory writes and existing customer records remain untouched.

## What changed

- **Server pagination** in `shop-catalogue.js`: Supabase PostgREST selects at most 24 products per page by default (never over 48), uses `count: "exact"`, and applies filters *before* `range(start,end)`.
- **Server-side search** against product name, SKU, type and description, plus category IDs matching the search. Inputs are stripped of PostgREST control punctuation and bounded to 70 characters. The search is substring-based, *not server-side typo tolerance*. We intentionally avoid claiming cross-catalogue fuzzy search.
- **Server-side filters**: product category, men's/women's audience, valid positive-stock active variants, variant colour, size and numeric length, price minimum/maximum, and local wishlist UUIDs. Selected size, colour and length must match **the same in-stock variant** because they filter a single `product_variants!inner` relation. Stable sorting always adds product UUID to avoid nondeterministic page order.
- **Incremental loading**: The accessible Browse all jewellery action enters the actual products list from the default category-tiles view. IntersectionObserver fetches next pages when the customer reaches the bottom. A visible, keyboard-accessible **Load more** fallback supports all browsers and stops accidental auto-loading after 8 pages. Loaded UUIDs are deduplicated; a request epoch discards stale results when the customer changes filters.
- **Dedicated server queries** for newest arrivals and selected promotional product IDs so these sections do not depend on the 24 products already loaded.
- **Global categories** come from the indexed `categories` table, not from a partial first page; some inactive-stock categories can still appear until stock is added. Filter values accept free text so the available variant choices are not incorrectly limited to the current page's suggestions.
- **Responsive photo uploads**: new images are resized client-side to max 1600px WebP (85% quality) plus 480px WebP thumbnails (76%) in the existing public `product-images` Storage bucket. Naming convention is `<sku>/<uuid>-optimized.webp` plus `<sku>/<uuid>-thumb.webp`; **only the full image gets a database row**, preserving the 5-photo limit. Old JPEG/PNG URLs stay compatible and render without thumbnail transformations. The editor cleans up files if a related upload fails.
- **Responsive delivery**: product cards use the 480px image with an optional 1600w `srcset`; full-resolution detail image is retained, with tiny thumbnails for product gallery and related designs when optimized images exist.
- Product price and stock are **still revalidated on the checkout page**; paginated catalogue results are not inventory reservations.

## SQL/migrations

No database schema change, storage overwrite or production SQL migration is needed; this uses the existing `products`, `categories`, `product_variants`, `product_images` and their RLS policies and indexes.

If query performance degrades at scale, measure using `EXPLAIN (ANALYZE, BUFFERS)` on a **staging copy**; consider trigram indexes for `ILIKE` search, category/price indexes, and keyset pagination for highly active large catalogues. Never add indexes blindly to production.

## What is not solved by this change

- 50,000 images will **not fit within the current Supabase Free Storage plan**. Upgrade storage later before exceeding quotas.
- Free plan does not include Supabase's on-the-fly Storage Image Transformations. Our generated WebP thumbnails avoid that requirement for **new** uploads; existing photographs are not silently recompressed or rewritten.
- The optional visual colour-search button searches **only currently loaded product images**; whole-catalogue visual recognition requires a separate indexed similarity-search service.
- Server search matches substrings; it does not do cross-product fuzzy/typo search. Search suggestions come from loaded results, not all 10,000.
- Long scroll sessions can accumulate cards. Auto-fetch stops after 8 pages and the site uses `content-visibility` to reduce rendering cost. Virtualized item windows could be introduced if telemetry shows many shoppers scrolling through hundreds of pages.
- **Follow-up PR #21** adds 40-row server pagination, SKU lookup and bulk import to the staff product editor; PR #20 alone does not include those changes.
- The product detail pages from PR #19 are client-rendered; search-engine crawling still needs static prerendering or SSR for reliable product indexing.
- Cost, database load, Lighthouse/Core Web Vitals, bandwidth and RLS throughput at 10,000 actual products **have not been benchmarked**. This is a scalability-ready architecture, not a claim that 10,000 production records have been load-tested.

## Acceptance checks

1. Merge/deploy PR #19, then deploy this branch safely. No new SQL migration needed.
2. On a **staging Supabase project**, generate 10,000 synthetic products, 50,000 metadata rows and a realistic number of variants; benchmark searches, stock filters, full category counts, stable sorts, and pagination across all 400+ pages without touching real products.
3. Confirm the API requests return at most 24 product rows, not 1,000; verify zero accidental full-table queries in the customer storefront.
4. Use Chrome/Android tablet/iPhone Safari to test endless scroll, slow/offline network retries, keyboard Load more, rapid category switching and latest/promotion visibility.
5. Test two variants with different colours and sizes to ensure a mixed non-existent variant combination does *not* match.
6. Upload five JPEG/PNG photos on a staging product and verify exactly five `product_images` records and ten optimized assets, with full quality photo on the detail page.
7. Confirm old pre-optimized images still display normally.
8. Use Lighthouse and field Core Web Vitals: p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1. Measure real device memory and downloaded bytes.
9. Check stock changes in another session, failed filter calls, wishlist count and the cart's authoritative stock check.
10. CI lint, unit, build and authenticated E2E must pass in the isolated environment before declaring ready.
