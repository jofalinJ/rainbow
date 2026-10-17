# Phase 6A — offline draft persistence (NOT offline checkout)

`src/domain/offlineDrafts.mjs` offers an IndexedDB store for product variant IDs and quantities from the POS cart, with a generated UUID for each **UNSUBMITTED_CART_DRAFT**. The draft survives reload if browser storage survives. No customer name, phone, address, payment credentials, invoice number or payment receipt is copied to storage. Staff may save and review drafts while the app is already open.

`admin/offline-drafts.mjs` exposes save/list/delete controls on Billing, with explicit no-bill warnings. On reconnection, the cashier **manually** reviews/restores a draft; the code fetches the **current** server catalog, validates each variant, stock and price, and then populates the ordinary POS cart. Only subsequent ordinary, online, authenticated checkout uses the server-side `create_local_sale_once` idempotency RPC. The original draft is retained until staff manually deletes it.

**This is not offline-safe billing.** No customer purchase, invoice, stock reservation, tax document, or accepted payment is created by saving a draft. The user must not collect payment or promise stock based on an unsent cart. `navigator.onLine` is just a UI hint; only a successful authenticated RPC confirms server availability and a committed sale. A crash before the draft write succeeds or cleared browser storage may lose drafts. The app may not reload offline without a future tested service worker and authenticated session strategy. The server catalogue and identity are not cached for full offline operation. Data on a shared Android device requires device encryption, screen lock and logout cleanup policy.

## What true offline shop billing STILL requires

1. Record a certified device ID and active staff policy; determine cash receipt handling.
2. Server-preallocate sellable quantities **per device** using locked stock, and reserve a conflict-proof invoice series/range, before losing connectivity.
3. Implement a durable IndexedDB transaction **outbox** with operation UUID, device sequence, frozen price/tax and customer payload protections. It must never claim a committed invoice before a server-authoritative acceptance policy exists.
4. Build an authenticated sync endpoint that validates device allocations, invoice numbers, stock, paid tenders, product price/tax policy and sequence; atomically emits immutable sale/invoice/payment/stock/audit records; processes the same UUID 10,000× as one sale.
5. Simulate multiple disconnected counters selling the last item; test intentional conflicts, quotas and cash management. E-commerce stock visibility must reflect reserved device allocations.
6. Certify on the actual Android tablets and invoice/thermal printers; test airplane mode, process kill, repeated network flaps, refresh, signing out and shared-device data deletion. Obtain accountant review for GST invoice series.
7. Restore backups, perform multi-counter shadow trading and staff UAT before enabling live offline billing.

No service worker offline checkout or automatic transaction sync is enabled by this phase. Staging/live migrations were not applied.
