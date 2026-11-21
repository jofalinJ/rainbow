# Razorpay refund.processed reconciliation (staged)

This Worker change is **record-only**: it never initiates refunds, adjusts stock, sends WhatsApp messages, or triggers a second payment. It processes verified `refund.processed` events only.

## Before deploying

- In Razorpay, enable the `refund.processed` event for the existing signed webhook endpoint. Other events (including `refund.failed`) remain ignored; review failed refunds directly in the merchant dashboard.
- Keep production and test webhook secrets separate. The Worker validates the raw Razorpay webhook signature with the configured mode-specific secret.
- The webhook fetches refund details by ID and the linked payment from Razorpay, verifies INR, matching IDs, successful processed state and cumulative refunded amount, and only then calls the existing service-role-only `record_razorpay_refund` RPC.
- A retry/out-of-order event is reconciled by the SQL RPC's cumulative max(refunded amount) logic and row lock. Validate this again in an isolated environment before enabling the event in production.
- The database records a partially refunded checkout as `refund_required`, and a fully refunded checkout as `refunded`. A partial refund may mark an order `cancelled` under the current SQL policy; review that business behavior before enabling automatic refund processing.
- Refund events must not automatically increase available branch/online stock: the physical return, payment refund and inventory receipt are separate operations.
- Keep the existing `payment.captured` event subscription active. Do not remove it.

## Safe verification

1. Run `cd backend/rainbow-api && npm test && npm run check` against mocks; inspect the GitHub Cloudflare API checks.
2. Use Razorpay test-mode payments and test refunds with their separate test credentials. Confirm the signed webhook, the provider GET lookups, a single server-side record update, full vs partial totals, duplicate events and invalid signatures.
3. Compare the provider refund record and the order/payments/invoice history; do not mutate live customers to create samples.
4. Confirm merchant policy before enabling a refund event on the live webhook. There are currently no refunded production orders to use for acceptance.
5. Enable production event subscription only after explicit approval. Deploy Worker code and configuration together through the established release process; do not activate a refund route that hasn't passed isolated tests.

Razorpay official docs: https://razorpay.com/docs/webhooks/refunds/ and https://razorpay.com/docs/api/refunds/
