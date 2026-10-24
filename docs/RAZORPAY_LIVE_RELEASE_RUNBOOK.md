# Rainbow Gold Covering — Razorpay LIVE release runbook

Status: **code prepared only**. TEST mode has been exercised; LIVE **has not been activated**.
Production charges must stay disabled until the merchant completes this checklist.

## Existing architecture

- Website: https://rainbowgoldcovering.com (GitHub Pages).
- Public Razorpay integration: `order-razorpay.mjs` → Cloudflare Worker `rainbow-api`.
- Database: Supabase project `ajnicsvtymvvkgepjmmk`; existing privileged checkout RPCs reserve stock and settle captured payments.
- Webhook: `https://rainbow-api.jofalin2005.workers.dev/api/razorpay/webhook`.
- Existing TEST secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Do not delete test secrets merely to configure live.
- New separate LIVE secrets: `RAZORPAY_LIVE_KEY_ID`, `RAZORPAY_LIVE_KEY_SECRET`, `RAZORPAY_LIVE_WEBHOOK_SECRET`.
- Public checkout NEVER receives any secret. Public `rzp_live_...` Key ID is expected in Razorpay Standard Checkout *only when* server-side live release is active.

## Production prerequisite checklist

1. **Razorpay account activated:** Check Razorpay Dashboard → Account & Settings → Activation Details for status **Activated**. Do not confuse working test transactions with account approval. Ensure the settlement bank account is verified.
2. **Site policies approved:** Publish the final Shipping, Returns/Refunds, Contact and Terms pages and truthful merchant details. Existing placeholder/pending approval text must be replaced.
3. **Inventory ready:** Active database product records currently contain test names, e.g. `anklet1` and `coir chchchch`. Deactivate all demo inventory and confirm real stock, variants, product images, rates and tax treatment before taking real orders.
4. **Tax review:** Checkout currently uses 1.5% CGST + 1.5% SGST for all Indian states. Obtain accountant signoff, particularly on IGST for interstate supply, before selling outside applicable intra-state cases.
5. **Finance operations:** Shop staff must be able to reconcile captured payments, lost browser callbacks, refunds, disputes and `refund_required` late captures; verify paid invoice creation and shipment readiness. A duplicate UPI reference must not be treated as bank verification.
6. **Provider capture:** Confirm Razorpay Orders API and automatic capture settings in the LIVE dashboard. Only `captured` payments are marked paid by our server. Authorized payments alone do not create confirmed orders.

## Configure Cloudflare LIVE secrets (never paste values into chat)

Razorpay Dashboard → switch to **Live Mode** → Account & Settings → API Keys → Generate Key.

Within Cloudflare Dashboard → Workers & Pages → **rainbow-api** → Settings → Variables and Secrets:

- Add encrypted secret `RAZORPAY_LIVE_KEY_ID` containing the `rzp_live_...` Key ID.
- Add encrypted secret `RAZORPAY_LIVE_KEY_SECRET` containing the corresponding live Key Secret.
- Choose a new independent random webhook signing secret; enter it as encrypted `RAZORPAY_LIVE_WEBHOOK_SECRET`.

Razorpay Dashboard in **Live Mode** → Account & Settings → Webhooks:
- URL: `https://rainbow-api.jofalin2005.workers.dev/api/razorpay/webhook`
- Event: `payment.captured`
- Secret: exactly the `RAZORPAY_LIVE_WEBHOOK_SECRET` value.
- Verify the correct **LIVE** dashboard and the actual active Worker deployment. Do not paste key values into GitHub or `payment-config.js`.

The `PAYMENTS_MODE` variable is intentionally absent from `wrangler.jsonc`: existing deployments default to `test`.
Merely adding live secrets will **NOT** enable charges.

## Release order

1. Merge/review the live-capable Worker and storefront PR only after CI and checkout regressions pass. The default remains test mode; this merge by itself cannot activate live charges.
2. Verify Worker deployed with the new config contract, rate-limit binding, Supabase RPC access, valid CORS, and signature-handling logic. Verify no outstanding TEST reservations (especially `creating`/`ready`) before changing modes.
3. For a controlled live switch, temporarily set encrypted `PAYMENTS_SUSPENDED=true`. Confirm new gateway checkout is unavailable.
4. Once the business prerequisites are signed off, set Cloudflare Worker runtime `PAYMENTS_MODE=live` and encrypted `LIVE_PAYMENTS_RELEASED=true`. Preserve `PAYMENTS_ENABLED=true`, rate limiter and all existing secrets. These are **two independent live gates** and must be set deliberately. A live API Key without them is rejected.
5. Verify `GET /api/razorpay/config` exposes `mode:"live", enabled:false` while suspended, without revealing secrets. Keep public frontend payment selector disabled during cutover.
6. Remove the `PAYMENTS_SUSPENDED` secret only when ready to accept a controlled first charge. Confirm `/api/razorpay/config` reports `enabled:true, mode:"live"` and the public Key ID begins `rzp_live_`. The browser separately checks a rate-limited provider-readiness endpoint before enabling Razorpay.
7. Conduct a merchant-authorized low-value, real-money transaction with a genuine product only after the above checks: compare Razorpay captured payment, authoritative amount, invoice, one order, one stock reservation, WhatsApp opt-in and email/settlement monitoring. This is a REAL charge. Do not test using someone else's payment method without permission.
8. Test cancellation, failure, duplicate callback, lost browser callback and webhook reconciliation without retrying or charging an already paid order. Audit app logs without logging payment details or customer PII.
9. Document actual live charge, gateway fee, capture, bank settlement, tax and refund procedures separately.
10. After successful completion, notify shop staff; keep monitoring unresolved payment mismatches and refunds.

## Guardrails and emergency stop

- Switching to `PAYMENTS_MODE=live` is insufficient unless `LIVE_PAYMENTS_RELEASED=true` and the LIVE credentials exist.
- Live requests from `https://jofalinj.github.io` are rejected; checkout is limited to `rainbowgoldcovering.com` and its www hostname.
- Set `PAYMENTS_SUSPENDED=true` to block **new** gateway checkouts instantly. Captured-payment webhooks remain verifiable and can still settle existing payments while suspended.
- A browser success popup does not confirm orders. The Worker independently checks HMAC, gateway payment ID, order ID, currency, paise amount and `captured` status.
- Keep the `razorpay_checkouts` inventory release/reconciliation cron running. Late captured payments flagged `refund_required` must be reviewed, not silently fulfilled.
- To roll back new checkouts, set `PAYMENTS_SUSPENDED=true` first. Do not delete live secrets while live payments may still have pending webhooks. Coordinate with provider before changing mode back to test.
- No changes to customer data, stock, database schema or live Worker runtime variables were made by this PR.

## Tests and dependencies

- `cd backend/rainbow-api && npm run check && npm test`
- Root `npm run lint && npm run test:unit && npm run build`
- Production HTTP smoke checks are read-only; never automate a real charge on every deployment.
- Only enable real payments after successful QA, finance approval and merchant dashboard activation.

Official references:
- https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- https://razorpay.com/docs/webhooks/


## Standard Checkout integration verification (24 October 2026)

This repository already has the three requested integration steps:
- Backend: `POST /api/razorpay/create` in `backend/rainbow-api/src/routes/razorpay.js` creates a database-priced INR order via the Razorpay Orders HTTPS API, with stock reservation and idempotency. The authoritative checkout amount must be an integer of at least **100 paise**.
- Frontend: `order.html`, `order.js` and `order-razorpay.mjs` load the Razorpay Standard Checkout SDK from `https://checkout.razorpay.com/v1/checkout.js` and handle cancel, `payment.failed`, and success. A failed attempt never confirms an order; successful callbacks are sent to the backend.
- Backend: `POST /api/razorpay/verify` HMAC-verifies the signed payment using the **server-side order ID**, fetches Razorpay's payment status, checks amount, currency, order ID, and requires **captured** before settling the order in Supabase. Signed capture webhooks also reconcile completed payments after the buyer closes the browser.

Both routes use the existing `/api/razorpay/` namespace rather than duplicate `/api/create-order` or `/api/verify-payment` endpoints. No Razorpay Node SDK needs installing: Cloudflare Workers uses the provider's documented HTTPS API with native `fetch` and Web Crypto.

Secrets: `.env` is already ignored. Local Wrangler development uses `backend/rainbow-api/.dev.vars`, ignored by Git, created by copying `.dev.vars.example` and filling values **locally**. Production always uses encrypted Cloudflare Worker Secrets. Do not commit any filled secret file.

Error responses: malformed JSON returns HTTP 400, oversized bodies return 413, insufficient verified amount returns 422, invalid signature returns 401, and provider failures fail closed without leaking upstream diagnostics. The merchant's upstream credential problems appear as temporary service unavailability to buyers rather than asking customers to authenticate.

GitHub verification on this branch: **190/190** unit tests passed, **35/35** Cloudflare API tests passed, no detected npm audit vulnerabilities. These CI checks do not substitute for a merchant-authorized LIVE transaction, provider approval or a tax/legal review.
