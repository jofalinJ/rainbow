# Rainbow paid-order finalization and WhatsApp invoices

## Customer flow
- Creating a Razorpay checkout reserves stock and stores an internal order in **pending / pending**. It is NOT placed or displayed as confirmed. Browser cancellation, failed or unverified payments must never confirm the order or issue a bill.
- A captured Razorpay payment (in the configured test or live mode) is verified server-side (HMAC signature for browser callbacks; signed webhook + server fetch for webhooks).
- **In one Postgres transaction**, changing `orders.payment_status` to `paid` confirms a valid paid Razorpay order, generates exactly one invoice with a random private bearer token, and records a `sale_online` ledger entry for each variant. Stock was reserved before payment; finalization does NOT deduct stock again.
- The browser shows **Order placed — payment verified!**, the order number and **View / Print Invoice** only after payment confirmation. Invoice at `/invoice.html?token=<opaque UUID>` is available only if the order is confirmed, the matching Razorpay checkout is `paid`, and the bill is issued.
- An unpaid manual UPI reference is **pending verification, not a placed order**. Staff verifies it through the existing admin workflow. Don't send an automated paid-order notification before staff verification.

## Invoice security
- `get_public_invoice(uuid)` retains bearer-token access for existing local-store bills. Online bills require paid Razorpay settlement, placed status and non-cancelled/non-refunded order. Protect links like password-reset links: do not log or publicly index them. Invoice reveals delivery contact information to anyone with its unguessable URL.
- The Worker returns the invoice URL only following authenticated payment verification; a webhook also finalizes and issues the invoice if the browser closes early.
- One invoice per order (`invoices_order_id_key`), one inventory ledger event per order and variant (partial unique index); webhook retries are idempotent. Any captured payment after reservation expiry remains `refund_required`, never confirmed or fulfilled.

## WhatsApp Cloud API (disabled until configured and explicitly released)
The server-side link between storefront and WhatsApp is already implemented:
1. Checkout captures the customer's WhatsApp number and optional **unchecked** consent checkbox. No message is sent on the Buy click.
2. The verified Razorpay payment (or signed capture webhook) finalizes the order and creates one invoice. PostgreSQL enqueues an outbox notification only for consented, paid Razorpay orders.
3. The `rainbow-api` Cloudflare Worker cron (every five minutes) claims eligible messages and sends the approved Utility template from Meta. It includes **customer name**, **order number**, and the **private invoice URL**. This sends an invoice **link**, not a PDF attachment.
4. The database stores the Meta message ID on API acknowledgement. `sent` does not mean delivered; a separate verified Meta webhook is needed to track delivery/read/failure.
5. Failed/unpaid/cancelled checkout attempts do not create paid-invoice messages. Staff-verified manual UPI and staff POS PDF messages are separate flows and are not enabled by this worker.

### Template preparation
In the **same WhatsApp Business Account as the selected sender phone number**, approve a **Utility** template named `rainbow_paid_order_invoice` (or configure another approved matching name) in the chosen language (e.g. `en`). The body must have exactly three text placeholders in this order:

```text
Hello {{1}}, your payment for Rainbow Gold Covering order {{2}} is confirmed.
View your invoice: {{3}}
Please keep your invoice link private.
```

Do **not** use `rainbow_api_test` or `invoice_with_pdf` unless its body component structure exactly matches the three text parameters above. The PDF-document-header template is a different integration and won't work with this sender without further implementation.

### Cloudflare secrets and variables
Store `WHATSAPP_ACCESS_TOKEN` (newly rotated, long-lived system-user access token with matching WABA permissions) and `WHATSAPP_PHONE_NUMBER_ID` as **encrypted Worker secrets**; never commit them to Git or expose them in the browser. Configure `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` (default `en`) and `WHATSAPP_GRAPH_VERSION` as Worker variables. The phone-number ID is **not** the WhatsApp Business Account ID.

`WHATSAPP_SEND_ENABLED=true` is the outer kill switch. It must remain absent/false until all other checks pass.

- **Test payments** (`PAYMENTS_MODE=test`): `RAZORPAY_KEY_ID` must start with `rzp_test_`. Set `WHATSAPP_TEST_RECIPIENT_ALLOWLIST` to explicitly opted-in test recipients in digits-only international format (e.g. `91XXXXXXXXXX`). Only these recipients can be claimed.
- **Live payments** (`PAYMENTS_MODE=live`): the existing live Razorpay release/credentials must be valid. In addition, `WHATSAPP_LIVE_SEND_ENABLED=true` is required. Even with this flag, messages are **allowlisted only** until `WHATSAPP_LIVE_SEND_ALL=true` is explicitly set. Do not set SEND_ALL before reviewing pending outbox rows, confirming Meta billing/template approval, and performing an end-to-end real-payment test. `WHATSAPP_TEST_RECIPIENT_ALLOWLIST` remains the allowlist name in both modes for compatibility.

**Safe launch sequence**: keep SEND_ALL unset; test a consented paid order to an allowlisted number; confirm Meta delivery; review pending outbox records and number/template pairing; then explicitly enable customer-wide sends. A previously exposed temporary Meta token must be revoked and replaced before launch.

### Verification and troubleshooting
- Check `public.whatsapp_notifications` for queued/sent/failed states; no messages means checkout consent, payment settlement, or enqueue configuration must be checked first.
- No send should happen when `WHATSAPP_SEND_ENABLED` is unset, payment is unverified, or the Meta template/secrets are missing.
- Meta `accepted` / `wamid` is **not proof of delivery**. Do not resend blindly: retries can duplicate bills.
- Secure invoice links are bearer tokens: never put them in logs, analytics, or publicly indexed pages.

### Deployment
- Apply `supabase/migrations/20261021234000_finalize_paid_orders_invoice_whatsapp.sql` and `supabase/migrations/20261111234500_normalize_whatsapp_recipient.sql` before relying on the queued outbox.
- Release the Cloudflare Worker only after reviewing the unit tests and payment/checkout regression suite. New production WhatsApp flags default off and cannot activate customer-wide messaging by themselves.
- Keep `keep_vars=true`, preserve existing Razorpay production release gates, and **do not change payment secrets** for this integration.
