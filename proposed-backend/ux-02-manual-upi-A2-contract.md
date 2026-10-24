# UX-02 / UX-09: Proposed manual UPI A2 server contract (NOT DEPLOYED)

> **Isolation:** Design proposal only. Do not apply to the live Supabase project,
> run Wrangler against `rainbow-api`, send real UPI payments, or publish a preview
> connected to real keys. Production web code is unchanged. All UI tests must stub
> `/api/upi/prepare` and `/api/upi/submit`, plus Razorpay endpoints.

## Approved decision A2

Before exposing a real-money QR, create one `orders` row in
`awaiting_payment` state (or map that external state to the existing safe
`status='pending', payment_status='pending'` enums). The server computes the
price, 3% discount, CGST 1.5%, SGST 1.5%, delivery state fee and live stock,
under a transaction lock, and returns the reference and fixed amount.
The browser never supplies an authoritative amount and never declares a payment
paid. On UTR submission update **the same order/payment**, never create another.

## Public Worker interface

All writes go through the Worker, **not through public anon Supabase RPC**.
Require allowed Origin and strict request content-type, request-size limit,
Cloudflare rate limits (by IP and checkout UUID), generic errors, and a server
service-role key kept in Worker Secrets. Do not log customer details, raw request
body, UPI identifiers or tokens.

`POST /api/upi/prepare` request:
```json
{
  "checkout_id":"uuid-v4",
  "items":[{"variant_id":"uuid","quantity":1}],
  "customer":{
    "name":"Test Buyer",
    "whatsapp_number":"9000000000",
    "email":"",
    "pin_code":"629000",
    "city":"Test City",
    "state":"Tamil Nadu",
    "address":"Example address for isolated tests"
  }
}
```

Successful response (values **illustrative only**, never live shop details):
```json
{
  "checkout_id":"same-uuid-v4",
  "state":"awaiting_payment",
  "order_number":"ISOLATED-0001",
  "subtotal":1000,
  "discount_amount":30,
  "cgst_amount":14.55,
  "sgst_amount":14.55,
  "delivery_fee":50,
  "total_amount":1049.10,
  "expires_at":"server-generated-ISO-timestamp"
}
```

`POST /api/upi/submit` request:
```json
{
  "checkout_id":"same-uuid-v4",
  "request_id":"another-stable-uuid-v4",
  "transaction_reference":"TEST-REFERENCE-123"
}
```
Successful response (never `paid`):
```json
{"order_number":"ISOLATED-0001","payment_status":"pending"}
```

On retries, the same `checkout_id` + request digest **must** return the same
order and amounts. A different request body reusing the ID must return 409.
Likewise `request_id` identifies a submitted UTR, and repeated submission
must not create another payment or deduct stock again. A different UTR on the
same request ID must return 409. Server must reject reused UTRs that belong to
another order. The merchant verifies actual settlement separately.

## Required isolated database proposal

1. Private `manual_upi_pending_checkouts` table with unique `checkout_id`,
   unique `order_id`, canonical request hash, state, expiry, last UTR
   request ID, and timestamps. No table SELECT/UPDATE for anon/authenticated.
2. `prepare_manual_upi_checkout` SECURITY DEFINER service-only operation:
   validate items (1–50 unique UUID variants, qty 1–100), input lengths,
   accepted Indian state; lock by checkout UUID and lock stock rows in a
   deterministic order; recompute prices/discount/tax/fees from DB; reserve
   stock once; create one pending order and payment placeholder; return quote.
3. `submit_manual_upi_reference` service-only operation: lock checkout and
   order; check pending state, UTR regex `^[A-Za-z0-9-]{8,64}$`, uniqueness,
   and request idempotency; attach UTR to the existing pending payment.
   It does NOT set `paid`, `confirmed` or send invoices.
4. To change customer details or basket, invalidate the browser quote and
   create a new UUID. The old pending reservation is not silently reused.
   Expiration/release must be server-controlled and reconcile potential in-flight
   transfers. Never auto-release reserved stock after receiving a UTR until a
   staff reconciliation decision resolves the payment.
5. Add a secured status and correction operation before UX-09 is marked Fixed.
   Distinguish verified, declined, expired and uncertain transactions.
   Avoid accepting references merely because they match a pattern.
6. Unit/integration tests use a fully isolated database or pure stubs. Test
   concurrent identical requests, mismatched hash, interrupted responses,
   double taps, expired reservation, corrected UTR, forged paid status,
   no inventory, price changes, and client replay. Never test real money.

## QR / merchant identity

The current browser asset `assets/brand/pay.png` is a static QR.
This proposal does NOT invent a payee UPI ID or name and does not add a
`upi://` link. Confirm the merchant ID, recipient name and approved payment
provider source before UX-08. In Phase 1, the browser can display the old static
image only *after* the Worker has returned a server-priced locked order. The
customer must visually verify the merchant and the locked total.

## Rollback plan (after isolated rollout ONLY)

1. Feature-flag `/api/upi/prepare` and `/api/upi/submit` off: both return 503.
   Browser fails closed, QR remains absent. Do **not** fall back to the old RPC.
2. Stop accepting new pending reservations; reconcile all existing held stock
   and transfer references before any migration rollback.
3. After reconciliation, revert Worker routing and UI branch commits.
4. Archive pending/order linkage and audit trail. Drop the new private table/RPCs
   only after reviewing dependencies; never mass-delete orders or automatically
   mark manual UPI pending payments as paid.
5. Never roll back captured money through frontend code; bank/manual refunds
   require a tracked shop procedure.

## Current Phase 1 limitation

The Worker route and database operations above **do not exist in production**.
The branch UI calls these endpoint names but shows an unavailable/retry state
if they respond 404/503. That is intentional until isolated backend tests pass.
