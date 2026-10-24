# TEST checkout release and reconciliation runbook

## Approved resources

- GitHub: `jofalinJ/rainbow`, branch `main`.
- Storefront: `https://rainbowgoldcovering.com` (GitHub Pages custom domain).
- Existing Cloudflare Worker: `rainbow-api`, `https://rainbow-api.jofalin2005.workers.dev`.
- Supabase: `ajnicsvtymvvkgepjmmk`.
- Public release: `paid-invoice-20261021-v4`.

Do not deploy this code to a similarly named test Worker or replace runtime secrets. `keep_vars:true` preserves dashboard variables; Wrangler explicitly controls TEST checkout enablement and keeps WhatsApp sending and template approval false.

## Order invariant and recovery

1. Browser supplies variant IDs, quantities and contact/delivery details. PostgreSQL calculates the amount and reserves stock atomically using a unique checkout UUID.
2. Worker creates or recovers the matching TEST Razorpay order. Retrying an ambiguous creation never creates another provider order.
3. Browser success is only a request to verify. Worker verifies the callback HMAC, fetches the provider payment and requires the correct order ID, positive integer INR amount, `status=captured`, `captured=true`, no refund and exact database amount.
4. A signed capture webhook independently fetches current provider state, then uses the same settlement transaction. Webhook database failures return non-2xx for retry.
5. Settlement confirms the order, creates one invoice, and records one sale ledger per variant. Stock was reserved earlier and is not deducted again.
6. Browser recovery rechecks the backend before displaying a placed order. A saved callback or issued recovery capability never authorizes a second payment by itself. Dismissed or failed attempts stay locked for reconciliation until the server confirms both released stock and no payable provider attempt; customers can then return to checkout. Losing browser session storage requires support using the provider receipt.
7. Invoice links are private UUID bearer links. The viewer uses no-referrer/noindex, validates token format and only enables printing after the server returns an eligible invoice. Do not log or share tokens.

Manual UPI is submitted through `/api/razorpay/manual-upi`. An active administrator must verify the receipt against the receiving bank, including amount and reference, before calling the protected verification RPC. Razorpay records cannot be verified with that staff action. Neither cashiers nor direct browser writes may manufacture online paid evidence.

Guest tracking goes through `/api/razorpay/track`; the underlying RPC is service-only. Account tracking remains authenticated and restricted to the account's order ownership. Guest output excludes customer identity, contact/address and invoice tokens.

## Required server configuration

Existing encrypted Worker secrets: `RAZORPAY_KEY_ID` (TEST), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Never print or overwrite these while deploying. The webhook secret must be independent of the API secret.

Wrangler binds `CHECKOUT_RATE_LIMITER` (12 requests/minute per route/client IP within each Cloudflare location), enables a five-minute cron and preserves variables. A missing, failing or malformed limiter binding fails closed. Origin allowlisting is a browser protection, not authentication. Consider account-level bot/WAF controls before real commerce.

Set `PAYMENTS_SUSPENDED=true` as an encrypted emergency runtime flag to pause TEST gateway checkout. Manual UPI and tracking still require their own DB connection and limiter, independent of Razorpay readiness.

In Razorpay **Test Mode**, the webhook URL is `https://rainbow-api.jofalin2005.workers.dev/api/razorpay/webhook`. Subscribe to `payment.captured` and refund events (`refund.processed` / `payment.refunded`). A configured secret alone does not prove the dashboard subscriptions or delivery health; inspect the Razorpay delivery log.

## Expiry, late captures and refunds

- Gateway reservations last 25 minutes; cron cleanup allows a further ten-minute grace period. The settlement path releases a reservation itself if capture arrives after expiry, so it cannot strand stock while changing to `refund_required`.
- Late capture never confirms or reallocates previously released stock. It becomes a cancelled order with verified captured money requiring staff review.
- Pending manual UPI reservations are released once after 24 hours. Staff must reconcile late transfers rather than confirm an expired checkout.
- Refund webhooks fetch the current provider payment. Cumulative refunded amounts only increase; delayed capture events cannot undo a refund. Partial refunds stop fulfillment and enter review. Full refunds hide paid invoices and stop pending notifications.
- Sold stock is not automatically returned after a provider refund. Inspect returned goods and use the authorized stock-adjustment workflow. The original sale ledger remains auditable.
- Admin → Orders → **Payment review** shows provider order/payment/refund IDs and amounts. Match those records in the **Test** dashboard and inspect the original receipt before any action. No Worker endpoint initiates a charge or refund. Duplicate/mismatched provider payments require manual investigation.
- One historical delivered online order was found without paid evidence. Preserve it and reconcile its original bank record; do not invent a payment or rewrite business history.

## Deployment and verification

Cloudflare Workers Builds is connected to this repository: production branch `main`, root `backend/rainbow-api`, build `npm run check && npm test`, deploy `npx wrangler deploy`. The separate **Previews Base** build settings must use the same `backend/rainbow-api` root and `npm run check && npm test` build command, with `npx wrangler preview` as the preview command. Retrying a build preserves its original build-settings snapshot; trigger a new branch build after correcting settings. GitHub's Cloudflare workflow performs checks only. A green GitHub job is not proof of a deployed Worker.

After merging tested changes, check the Cloudflare build commit/version. If production does not advance, use the **existing** `rainbow-main-deploy` deploy hook for `main`; treat its URL as a secret and do not commit or log it. Retrying an old build redeploys that old commit.

Apply the reviewed settlement migration before the Worker/frontend use its new RPCs. Preserve runtime secrets. Keep `WHATSAPP_SEND_ENABLED=false` and `WHATSAPP_TEMPLATE_APPROVED=false`.

Run:

```sh
npm ci --legacy-peer-deps
npm run lint
npm test
npm run build:pages
npm run security
(cd backend/rainbow-api && npm run check && npm test)
node scripts/verify-payment-deployment.mjs
E2E_BASE_URL=https://rainbowgoldcovering.com npm run test:e2e:public
node --test tests/e2e/selenium/tests/payment-readiness.test.mjs
```

CI also runs real PostgreSQL 17 against the payment fixture, **all** gateway/finalization/hardening migrations, and payment behavior/post-settlement assertions. The browser recovery fixture intercepts payment requests; it cannot charge or send WhatsApp. Isolated Supabase integration and authenticated staff E2E need a separate configured test project and credentials. A skipped suite is not a pass.

The deployment verification script compares published assets byte-for-byte with checked-out source and requires the actual Worker release, TEST mode, CORS and provider readiness. It performs no checkout creation, charge, refund or message send.
