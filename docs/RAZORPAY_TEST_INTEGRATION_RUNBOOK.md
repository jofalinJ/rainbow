# Razorpay TEST-mode implementation and release gate

> STATUS: **DEVELOPMENT BRANCH ONLY**. Never enter live credentials, merge to production,
> deploy the Worker, or enable new checkout before the checklist below passes.

## Architecture

- Browser: `order-razorpay.mjs` loads Standard Checkout only after
  `GET /api/razorpay/config` returns `enabled:true, mode:test`.
- Backend: `backend/rainbow-api/src/routes/razorpay.js` runs inside Cloudflare,
  uses the server-side Razorpay secret, and verifies callback HMAC signatures.
- Supabase: `20261021194000_razorpay_test_reservation_checkout.sql`
  **proposes** five service-role-only RPCs and a private checkout reservation table.
  None of these migrations have been applied to the current live Supabase instance.
- Stock is reserved atomically before gateway order creation. The client sends
  variant IDs, quantities and delivery address, never its claimed price.
- Retry UUID is serialized with `pg_advisory_xact_lock` and is UNIQUE; a concurrent
  retry cannot create another Razorpay order.
- Guest checkout inserts a new contact snapshot. It never updates an existing
  customer's saved details merely because they entered that phone number.
- Only a captured Razorpay payment with matching order ID, amount in INR paise,
  and verified signature becomes paid. A browser callback is not proof of capture.
- A signed `payment.captured` webhook also fetches the current payment from Razorpay
  before settlement, supporting browser closure and retries.
- The Worker cron reconciles expired reservations every five minutes.
  Reservations expire after 25 minutes plus a 10-minute grace interval.
  Late captures are marked **refund_required** and must be reviewed by staff;
  expired stock must never be silently re-allocated to an old paid order.

## Required secrets and public configuration

Cloudflare Worker **runtime secrets** (Settings → Variables and Secrets):

- `RAZORPAY_KEY_ID` = Razorpay **TEST** Key ID.
- `RAZORPAY_KEY_SECRET` = corresponding TEST secret.
- `RAZORPAY_WEBHOOK_SECRET` = separate secret entered in Razorpay's
  **Test Mode** webhook setup. Never use the API Key Secret as the webhook secret.
- `SUPABASE_URL` = official project API URL (plain text is acceptable).
- `SUPABASE_SERVICE_ROLE_KEY` = privileged Supabase secret; server-only, never GitHub,
  frontend code, screenshots, analytics or logs.

Worker public variables:

- `ALLOWED_ORIGINS` = exact comma-separated origins, e.g.
  `https://jofalinj.github.io,https://your-verified-shop-domain.example`
  (replace the example with the actual verified domain).
- `PAYMENTS_ENABLED` = leave **unset / false** until all of the release gates pass;
  even when enabled this code refuses a `rzp_live_` Key ID.

Storefront `payment-config.js`: insert only the deployed **HTTPS public Worker URL**
in `apiBaseUrl`. It is not a secret. The default blank value leaves Razorpay disabled.

Razorpay Dashboard → Account & Settings → Webhooks → Test Mode:
add the deployed Worker endpoint `https://YOUR-VERIFIED-WORKER/api/razorpay/webhook`
and subscribe to **payment.captured**. Configure an independent webhook secret
on both the Dashboard and Cloudflare. Webhook deliveries must return HTTP 2xx only
after successful database settlement; failed settlement must retry.

## Blockers before enabling test checkout

1. Apply the migration in an **isolated test database** and verify the complete SQL,
   permissions, RLS, and customer/order/inventory constraints. Do not use real customer data.
2. Run `cd backend/rainbow-api && npm run check && npm test`; run the root repository CI.
3. Add Cloudflare WAF/rate limits and bot protection to create and verify endpoints.
   An Origin/CORS allowlist is **not authentication** and can be forged by scripts.
4. Implement an admin queue and manual refund runbook for `refund_required`,
   plus an alert for delayed/missing webhooks and captured payment mismatches.
5. Verify gateway payment-capture settings and perform genuine Razorpay **test-mode**
   success, failure, double-click, cancellation, browser close, timeout, late webhook,
   amount tampering, UPI, card and mobile scenarios.
6. Verify stock is restored **once** on expiry, never restored after paid settlement,
   and never deducted twice for the same checkout UUID.
7. Fix the **existing manual UPI** checkout independently: the public
   `create_online_order` RPC currently has no idempotency and updates customer records
   based on phone number. Its old flow is NOT repaired by this payment branch.
8. Finance review: interstate IGST vs CGST/SGST and actual checkout pricing.
9. Keep production checkout on **manual UPI** until the release passes review.
   No live Razorpay payments are supported by this patch.

## Test-only API contract

`GET /api/razorpay/config` → `{enabled:false,mode:"test"}` by default.

`POST /api/razorpay/create`:
```json
{
  "checkout_id": "unique-uuid-v4",
  "items": [{"variant_id": "product-variant-uuid", "quantity": 1}],
  "customer": {
    "name": "Example", "whatsapp_number": "9999999999",
    "address": "Example address", "state": "Tamil Nadu"
  }
}
```
Server responds with public Key ID, Razorpay order ID, signed authoritative paise amount,
order number and reservation expiry. No secret keys are returned.

`POST /api/razorpay/verify`:
`checkout_id`, `razorpay_order_id`, `razorpay_payment_id`,
`razorpay_signature`. The worker verifies HMAC, fetches payment details and then
settles only a captured payment via a privileged database RPC.

## Deployment safety

This branch is **not** connected to Cloudflare Builds and should be opened as a
draft pull request first. Confirm the existing Worker is deployed from
`backend/rainbow-api`, not the repository root. Worker test keys already configured
in Cloudflare do not enable payments without `PAYMENTS_ENABLED=true` and the
remaining required settings. The `main` branch should not be advanced until
the test database, webhook, rates, CI, staff refunds and regression checks pass.

See [Razorpay Standard Checkout official guide](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
and [Razorpay webhook verification documentation](https://razorpay.com/docs/webhooks/validate-test/).
