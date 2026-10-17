# Staged unpaid online cancellation + stock release

**Branch only.** Not deployed to Rainbow's live Supabase database. Requires the source-linked online allocation migration and original order status auditing migration first.

## Business conditions and flow

An online checkout presently creates a **pending** payment and removes inventory at order placement even before anyone verifies the manually entered UPI reference. It should be treated as a *stock allocation*, not proof that money was received.

The Phase 4 RPC `public.cancel_unpaid_online_order(p_order_id uuid, p_reason text, p_payment_checked boolean)` is accessible only to active shop administrators. The dashboard offers cancellation only for a **pending/unverified** online order, requires a 12–240-character reason and an explicit checkbox affirming the administrator reviewed the actual UPI/bank statement and verified no payment was received. **Checking a box is not bank payment verification.** The business must implement a real reconciliation policy.

The database independently rejects cancellation if:
- The caller isn't an active admin; the order is absent/non-online/not pending; or the payment is marked paid/part-paid/failed, already verified or has a paid timestamp.
- Any shipment record exists (even `packed`, as it may imply physical handling).
- The original online order's product lines lack corresponding **exactly one** `sale_online` stock allocation movement for each variant and matching quantity. Old, untracked orders must go to manual reconciliation rather than guessing stock from order lines.
- The order already has an order-linked `return` movement, which may represent a previous stock release or a customer return.
- The requested action hasn't been accompanied by affirmative payment checking and a meaningful reason.

The RPC locks the order row `FOR UPDATE`. `verify_online_order_payment` and order status RPCs use the same lock, so their updates serialize; a successfully verified payment blocks cancellation. It locks each product variant and adds stock back exactly once. The same DB transaction writes an inbound `inventory_transactions` movement with source order, signed delta and balances, creates a unique `online_order_cancellations` audit row, changes the order status to `cancelled`, and appends an existing `online_order_status_events` audit record. Any error rolls back every step.

A repeated call for the same order returns `already_cancelled=true` **without changing stock** if the cancellation event exists. If an old cancelled order has no cancellation event, the RPC errors for manual reconciliation.

**Deliberately unchanged:** `payments` and `orders.payment_status` remain as they were, even when the order status becomes `cancelled`. This avoids falsely asserting an external UPI settlement or refund. Staff must separately reconcile financial records. There is no automatic refund, payment gateway call, automatic expiry or customer notification.

## Rollout order

1. Full-schema **isolated** Supabase staging copy, never production: apply Phase 1 local-sale idempotency, Phase 2 stock audit, Phase 3 online stock allocation, Phase 4 cancellation in order.
2. Confirm current deployed `create_online_order` matches the staged Phase 3 migration before replacing any RPC; verify all `online_order_status_events` and `order_shipments` tables exist.
3. Run the PostgreSQL 17 `tests/sql/online_order_cancellation.sql` fixture from CI. It covers admin/cashier/non-user roles, customer payment attestation, stock restoration, duplicate request, missing ledger, paid order, shipments, and forced late failure after stock return.
4. Test real staging staff credentials/RLS, authenticated/unauthed PostgREST and UI. Confirm stock correction appears both in source ledger (as `return`) and trigger audit.
5. **Race test:** in two database sessions, try verifying and cancelling one pending order simultaneously. Whichever order row lock wins must make the other action fail safely. Also run 50 concurrent duplicate cancellations and assert one release.
6. Test corrupted records, missing variant, partial/legacy return and shipment cases. Test browser timeout after commit and repeat RPC. Check that cancel events are inaccessible for writes via PostgREST.
7. Verify payment externally before staff cancellation. Write a manual SOP for bank reconciliation and exceptions; never equate `payment_status='pending'` with no money being received.
8. DB-first staged rollout with rollback plan. Do not merge or deploy the UI to production before the migration exists.

## Not implemented yet

Refunds and returned goods for **paid or shipped** orders require a separate authorization, physical item inspection, financial settlement, and exactly-once restock/credit record. Supplier purchasing/GRN, offline POS, GST compliance, restore drills and full Supabase staging remain incomplete.
