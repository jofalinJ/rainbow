# Shared shop stock for online sales — staged rollout notes

**Current status: NOT LIVE.** This design is behind `app_private.erp_activation_state.shared_branch_stock`, which defaults to `false`. The existing online allocation, checkout and stock rules remain in use until a separately approved cutover.

## Owner's requested workflow

A product is entered **once** in the shop catalogue, and stock is counted against its actual physical shop. The owner opens **Categories & Online** and clicks **Show Online**; there is no second product or Online Store quantity to create. Its customer-visible availability is the **sum of unreserved pieces at active physical shops**. Hiding a product changes only its published state, not any shop stock.

Physical shop sale of one piece: physical on-hand decreases by one, public available inventory decreases by one. Online checkout of one piece: a reservation reduces the available count at a physical shop until payment is settled or cancelled. Verified payment consumes one physical piece exactly once; expiry releases the reservation. Each checkout must revalidate stock under database row locks, not trust browser quantities.

## Code included in this draft

- Staged SQL migration `20261111090000_shared_branch_stock_staged.sql` defines the disabled mode flag, derived legacy stock mirror, physical shop reservation/release bridge, verified payment settlement, and protection against separate online-pool allocations when shared mode is enabled.
- Manual activation script `supabase/operations/activate_shared_branch_stock_MANUAL.sql`, **not** an automatic migration, refuses to run while online stock, pending checkout holds, or transfers remain unreconciled.
- `admin/owner.js` detects the mode through a read-only authenticated RPC. When active, owner **Show Online** publishes existing stock without transfer, **Hide Online** leaves physical stock unchanged, and quantity-entry/Online Store allocation actions disappear. Prior mode is preserved while the flag is off.
- Disposable PostgreSQL and browser tests cover payment verification, checkout hold/release, physical POS deduction, and shared-stock publication.

## Mandatory checks before production activation

1. Finish isolated SQL, browser and role-permission checks. Run the real checkout, expiry, captured-payment, duplicate webhook, manual-QR/UPI verification, and refund/cancellation regression paths against disposable data.
2. **Concurrency/locking review is a known open risk.** Checkout currently obtains the variant lock before its branch reservation, while POS and some inventory RPCs lock a branch balance first. Concurrent operations can deadlock even if they cannot oversell. Establish one lock order or bounded retries for all POS, adjustment, transfer, checkout, expiry and paid-settlement paths, and verify with concurrent database sessions.
3. Reconcile existing stock, reserved online checkout rows, manual UPI orders, paid/unpaid orders, and any in-flight transfers. Never run manual activation if the guard rejects the cutover.
4. Deploy all matching frontend and server tests before enabling the DB mode. Test signed-in staff, admin and anonymous storefront visibility on a separate hosted staging environment.
5. Verify the first no-money, synthetic transaction and then a controlled authorized production transaction. Monitor ledger totals and failed payments. Do not alter actual stock merely as a test.
6. Implement and test a **reservation-aware rollback**. Switching the flag back while checkouts hold branch stock is unsafe and must not happen without reconciling orders and reservations.

## Release/compatibility notes

- The existing `products`, `product_variants`, `erp_online_listings` and `erp_stock_balances` records remain authoritative. No duplicate product rows or physical stock copies are created.
- `product_variants.stock_quantity` is a compatibility mirror for the legacy storefront and checkout, not an independent store stock to enter.
- Existing stock in an inactive location is excluded from public availability.
- The historical `erp_online_listings.published` permission remains owner-only.
- Migrating active real-money checkout without all gates is **not approved** by this draft.

This document is part of a draft PR; it does not indicate an activated production feature.
