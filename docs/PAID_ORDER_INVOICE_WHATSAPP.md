# Rainbow paid-order finalization and WhatsApp invoices

## Customer flow
- Creating a Razorpay checkout reserves stock and stores an internal order in **pending / pending**. It is NOT placed or displayed as confirmed. Browser cancellation, failed or unverified payments must never confirm the order or issue a bill.
- A captured Razorpay test payment is verified server-side (HMAC signature for browser callbacks; signed webhook + server fetch for webhooks).
- **In one Postgres transaction**, changing `orders.payment_status` to `paid` confirms a valid paid Razorpay order, generates exactly one invoice with a random private bearer token, and records a `sale_online` ledger entry for each variant. Stock was reserved before payment; finalization does NOT deduct stock again.
- The browser shows **Order placed — payment verified!**, the order number and **View / Print Invoice** only after payment confirmation. Invoice at `/invoice.html?token=<opaque UUID>` is available only if the order is confirmed, the matching Razorpay checkout is `paid`, and the bill is issued.
- An unpaid manual UPI reference is **pending verification, not a placed order**. Staff verifies it through the existing admin workflow. Don't send an automated paid-order notification before staff verification.

## Invoice security
- `get_public_invoice(uuid)` retains bearer-token access for existing local-store bills. Online bills require paid Razorpay settlement, placed status and non-cancelled/non-refunded order. Protect links like password-reset links: do not log or publicly index them. Invoice reveals delivery contact information to anyone with its unguessable URL.
- The Worker returns the invoice URL only following authenticated payment verification; a webhook also finalizes and issues the invoice if the browser closes early.
- One invoice per order (`invoices_order_id_key`), one inventory ledger event per order and variant (partial unique index); webhook retries are idempotent. Any captured payment after reservation expiry remains `refund_required`, never confirmed or fulfilled.

## WhatsApp Cloud API (disabled until configured)
1. Create a Meta WhatsApp Business Platform app and configure an approved **Utility** template matching the name configured in `WHATSAPP_TEMPLATE_NAME`. The message body must accept three text parameters: **customer name**, **order number**, **secure invoice URL**. The phone-number ID and permanent/system-user token must be stored as encrypted Cloudflare Worker secrets, never in GitHub or Supabase browser config.
2. Cloudflare `rainbow-api` encrypted secrets: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`; dashboard variable `WHATSAPP_TEMPLATE_NAME`, optional `WHATSAPP_TEMPLATE_LANGUAGE=en`, `WHATSAPP_GRAPH_VERSION=v24.0`.
3. Current `rainbow-api` requires Razorpay **TEST** keys. To allow test notifications, configure `WHATSAPP_TEST_RECIPIENT_ALLOWLIST` as comma-separated test numbers with international country code and no plus sign. Each recipient must explicitly consent with the unchecked checkout checkbox. After verifying template approval, set `WHATSAPP_TEMPLATE_APPROVED=true`. The source-controlled Wrangler defaults keep both this flag and `WHATSAPP_SEND_ENABLED=false`; enabling any test sends requires a separate reviewed configuration change. Keep both false until the template and API are verified. **Never put customer or staff credentials in source code.**
4. The scheduled Worker (every five minutes) claims pending paid-invoice notifications only for approved allowlisted test recipients, sends the approved template via Meta Graph `/messages`, and records Meta's `wamid` acknowledgement. An accepted ID does NOT prove delivery to the handset. Unknown delivery outcomes are marked failed and require manual review, rather than blindly resending and risking duplicates.
5. No notification is created without recorded opt-in, verified Razorpay payment, and generated invoice. Currently a paid order created before this migration defaults to `whatsapp_opt_in=false`, so backfills will not send messages.

### Deployment
- Apply `supabase/migrations/20261021234000_finalize_paid_orders_invoice_whatsapp.sql` before deploying frontend/Worker referencing its RPCs.
- Keep `PAYMENTS_ENABLED` TEST-only and `keep_vars=true`; never add real Razorpay API keys to this Worker.
- Test checkout start, cancel, payment capture, webhook-first capture, webhook retry, duplicate checkout, expired reservations, sale ledger quantity, invoice token, WhatsApp opt-in/out, invalid Meta template and no API secret. Verify no real WhatsApp is sent in default configuration.
- When testing a real user's order, preserve consent and ensure the actual invoice is valid before sending. Verify WhatsApp delivery in Meta dashboard; this job currently records acceptance only.

## Legacy direct senders

The old Supabase `send-order-alert` and `send-whatsapp-bill` endpoints are retired and return disabled/503 even if old provider secrets remain. They previously bypassed recipient consent/template/allowlist controls. Only the gated Worker outbox is supported for online invoice API delivery. No messages were sent during this audit.

Provider refund events stop pending invoice notifications and make the paid invoice unavailable. Existing accepted Meta message IDs do not prove handset delivery, and unknown outcomes are never blindly retried. Refund processing and stock returns require staff reconciliation; see the current checkout runbook.
