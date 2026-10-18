# Non-payment UX upgrade — 18 October 2026

Branch: `feat/storefront-ux-nonpayment-20261018`. Keep production checkout/payment untouched.

## Delivered on branch
- Catalogue min/max price, colour, size, length, sort, zero-result search improvements and reusable pure discovery functions.
- Homepage shows an actual in-stock product first when product photographs exist. Existing promotion carousel remains.
- Shareable `product.html?sku=...` pages with current catalogue price/stock, a five-photo gallery, variant select, related products, and the existing cart format.
- Optional consent-gated `rainbow_*` shopping events; **no provider installed**, and no measured KPI claims.
- Transparent shipping/returns information pages, deliberately not invented return rules.
- Private staff-app Android installation manifest and offline warning service worker. **No offline billing** and no customer/account data caching.
- `get_public_invoice(uuid)` already has a grant for authenticated users in the live Supabase project; still needs logged-in printing acceptance.
- Unit tests for catalogue search and filters.

## Launch approval blockers (do not present these as completed)
1. Get store-owner/legal approval for binding terms, return/refund conditions, delivery estimates, pickup and courier escalation.
2. Authenticated invoice preview, A4 and actual thermal receipt-printer tests with correct paper width, plus original order lookup.
3. Staging inventory concurrence, stock journal, offline pilot and database-restore acceptance before merging separate draft PRs.
4. Android tablet install, login, permission denial, sign out, network loss and device size acceptance.
5. Real-user Lighthouse/PageSpeed Insights mobile and desktop metrics; improve LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 at p75.
6. Product-level Google indexing: GitHub Pages cannot server-render database-driven product pages. Query-based pages and client-inserted JSON-LD need static pre-rendering or a future server/edge-rendered storefront for reliable crawler/social previews.
7. Optionally connect an analytics provider through a consent-aware dataLayer setup and test a fully anonymized event funnel. No customer names, phones, addresses, or payment refs in events.
8. Payment integration and any payment logic are **out of scope**.

## Verification commands
`npm run lint`, `npm run build`, `npm run test:unit`, and public Selenium tests in staging.
Approve release only after the test environment is configured and observed checks pass. Never copy mock product rows to production.

The shipping, returns and terms pages are visible for customer transparency but intentionally marked `noindex` until owner-approved; they are not included as unfinished indexable XML sitemap entries.
