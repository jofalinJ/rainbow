# Rainbow Gold Covering — Razorpay checkout (current architecture)

Updated: 3 November 2026. This replaces the historical TEST-only, disabled-methods and manual-QR instructions. See Git history for the original setup notes.

## Production architecture

- Customer checkout is **Razorpay Standard Checkout only** (PR #52). Available UPI/cards/netbanking/wallets are handled by the gateway, not hand-built payment fields.
- Checkout UI: `order.html`, `order.js`, `order-razorpay.mjs` and `payment-config.js`.
- Trusted payment backend: Cloudflare Worker `backend/rainbow-api/src/routes/razorpay.js` deployed as `rainbow-api`. Secret credentials belong to Worker environment secrets, never public JavaScript or Git.
- Database: Supabase `razorpay_checkouts`, `orders`, `payments`, `invoices`, and payment/inventory functions. Server calculates payable totals; successful payment must be verified and captured before confirming orders and issuing paid invoices.
- Staff billing may still support in-person cash/card/UPI as a different local POS workflow. This does **not** re-enable customer website manual UPI.
- The historical static manual-QR image and related customer fallback have been retired. No shopper should be instructed to transfer money based solely on a static UPI QR or submitted reference.

## Release and reconciliation

1. Inspect `/api/razorpay/config` and the read-only provider-check endpoint. LIVE readiness is not proof of an end-to-end successful transaction.
2. Keep `PAYMENTS_MODE`, `PAYMENTS_ENABLED`, account capture settings, and webhook secrets under controlled change management. Do not display or commit keys.
3. Verify correct server-authoritative amount, single stock reservation, captured-payment verification, webhook signature validation, idempotency, and failure/expiry refunds.
4. Reconcile authorized test sales to an invoice, gateway dashboard and actual settlement. Never create false stock for a real charge.
5. GST treatment needs qualified accounting sign-off; coordinated interstate IGST work remains in [PR #56](https://github.com/jofalinJ/rainbow/pull/56) and is **not** live.
6. Run `npm run test:checkout:fixture`, all CI checks, disposable SQL tests, isolated authenticated E2E, and real production readiness checks before declaring a full launch.

See `docs/OWNER_RELEASE_GATES_20261103.md` and `docs/RAZORPAY_LIVE_RELEASE_RUNBOOK.md`. Official integration reference: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/.
