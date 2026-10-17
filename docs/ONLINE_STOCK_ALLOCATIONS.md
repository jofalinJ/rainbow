# Online order stock allocation ledger — staged change

The new unmerged migration `supabase/migrations/20261017223000_online_order_source_ledger.sql` extends the existing `public.create_online_order(jsonb,jsonb,numeric)` database RPC without changing its public signature, accepted customer payload, UPI payment verification rules, shipping rate calculation, taxes or order status transitions.

## What changes

For every new online order line that reduces a variant's available stock, the same PostgreSQL transaction creates **one** `inventory_transactions` row:

- `transaction_type='sale_online'` is the existing enum value. **It means stock allocated to an online order, not that payment was verified or sale fulfilled.**
- `variant_id`, `reference_order_id`, `quantity`, `quantity_delta=-quantity`, `stock_before`, `stock_after`.
- `reason` includes the source order number and explicitly says *payment pending* at allocation time.
- `created_by=auth.uid()` can be a customer account or NULL for an anonymous checkout; it must not be assumed to be an employee.

The RPC already locks the product variant using `FOR UPDATE OF pv`. This migration retains that lock, verifies sufficient stock in the final decrement statement, then inserts the linked stock movement before committing the online order. A failure rolls back the order, payment, stock decrement and movement together.

A partial unique index prevents a second `sale_online` movement for the same variant and order. A validated-on-new-rows CHECK requires coherent negative quantity, source order and before/after balances. Older stock history is **not reconstructed**.

## Order-status boundary

The store's online order starts with `status='pending'`, `payment_status='pending'` and a UPI reference supplied by the customer. It has not been independently settled at stock-allocation time. The existing online order therefore behaves like a *reservation/allocated stock*, not like a final paid POS sale.

**This change does not:**

- automatically release reserved stock when an order is cancelled, rejected, timed out or refunded;
- reconcile submitted UPI references with actual settlements;
- implement returns, supplier purchases or goods receipt; 
- make customer/online orders idempotent across distinct requests;
- add a reservation-expiry policy or revalidate a customer's price/tax treatment;
- provide complete source-linked stock history for activity before migration.

Before adding a cancellation/refund feature, decide whether an allocation has been shipped or paid, then create an authorized **exactly-once stock return** with a source order, required reason and operator identity. Avoid compensating adjustments outside a controlled transaction.

## Test plan and rollout gates

1. Apply this migration **only** to an isolated Supabase staging database that mirrors Rainbow's live schema and RPCs. Back up the staging environment first.
2. Run the new disposable PostgreSQL CI test `tests/sql/online_order_source_ledger.sql`. It tests allocations, source links, pending payments, invalid/duplicate carts, insufficient stock, duplicate references, balance constraints and migration replay.
3. On staging, perform real online checkouts using a test product and multiple variants. Compare `orders`, `order_items`, `payments`, `product_variants`, `inventory_transactions`, and `stock_change_events` in one database transaction.
4. Run **concurrent** checkouts for the final available unit and ensure no silent oversell or missing movement.
5. Test failure after the stock decrement (for example a forced `order_items` error), then check rollback of *all* writes.
6. Test authorized inventory history reads and that cashiers/customers cannot directly write `inventory_transactions`.
7. Compare the new migration's `create_online_order` function to the current deployed signature and behavior immediately before staging promotion. If the deployed function has changed since the audit, regenerate/review this migration rather than overwriting later fixes.
8. Deploy DB migration **before** updating the Inventory admin viewer. Do not deploy without the full regression and a rollback plan.

**Still missing for a production shop:** complete procurement/returns, financial/invoice compliance sign-off, offline-safe checkout, backup restore drills, end-to-end payment reconciliation, true source-linked ledger for every stock change.
