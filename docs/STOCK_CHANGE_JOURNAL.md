# Stock change journal (staging-only)

The migration `supabase/migrations/20261017220000_stock_change_journal.sql` adds a separate, application-read-only record of *actual changes to the product_variants.stock_quantity column*. It must be deployed and tested **before** the updated Inventory page is released.

## Why a second journal?

The existing `inventory_transactions` table captures selected business operations such as store sales and signed manual adjustments. However, the current `create_online_order` SQL decreases `product_variants.stock_quantity` without a corresponding `inventory_transactions` row; the product and variant editors also set initial quantities.

A trigger captures the database update irrespective of whether a caller uses a POS RPC, storefront RPC, purchase/import path or manual adjustment RPC. It does not infer why an item changed. Do not merge the two history tables as though every entry represents a distinct stock movement: **the same change can appear in both**.

## Data and security

- Each **existing** variant gets one `BASELINE` snapshot of its stock at installation time, not a reconstructed history.
- After installation, `INSERT`, `UPDATE OF stock_quantity` (when quantity actually changes), and `DELETE` each generate an event. Unchanged updates generate no event.
- Events have variant ID, product ID, previous balance, new balance, signed delta, timestamp and `auth.uid()` when the request has an authenticated identity. The actor can be an employee or customer; service/system calls might have no actor.
- The audit row is inserted inside the SAME PostgreSQL transaction as the corresponding stock change. A rolled-back transaction does not leave a ghost event.
- There is **no foreign key** to product variants on audit events: a product deletion must not delete history.
- Browser roles are denied direct table access. The `get_variant_stock_events` RPC allows an active admin/inventory_staff to view at most 100 entries for one variant. It will not allow a cashier or anonymous viewer.
- PostgreSQL/database owners remain able to alter their database. This is an append-only **application** audit, not cryptographic tamper-evidence or independent WORM storage.
- The journal does **not** replace the full business movement ledger (source order, purchase, goods receipt, supplier, reason, authorized actor).
- Existing stock history, orders, payments, invoices and quantities are not altered by the migration.

## Deployment verification (isolated staging)

1. Make a backup of staging. Confirm its tables, roles, triggers and functions match the live schema.
2. Apply the entire migration transaction. Inspect the baseline count and compare snapshot rows against actual staging variant stock.
3. Test a product/variant insertion with opening quantity > 0: exactly one `INSERT` event.
4. Test a store sale, an online order, and a manual adjustment. Check that each real quantity change yields exactly one `UPDATE` event; verify `stock_after-stock_before=quantity_delta`. Check that core order transaction behavior is unchanged.
5. Test failed checkout and rollback. No committed stock change = no committed audit event.
6. Test metadata-only change. No extra stock event.
7. Test variant deletion (on staging only). Historical audit rows must survive and the deletion must be recorded.
8. Test 100+ simultaneous small quantity updates, compare event ordering and final stock; never allow the quantity below zero.
9. Test RPC as admin, inventory staff, cashier, deactivated staff and anonymous. Check that direct PostgREST reads/writes are denied.
10. Rerun the migration in staging; baseline must not duplicate. Verify the UI handles an uninstalled RPC gracefully.

The GitHub CI `Stock audit migration / PostgreSQL 17` job runs a **disposable PostgreSQL simulation** with an intentionally small replica of required tables. It validates SQL parsing, baseline, delta, rollback, replay and permissions; it does NOT replace full-schema staging tests.

## Limitations / next P0 work

- Correlate each UPDATE event with its order/return/purchase/source document when all business workflows have been reviewed. Prefer expanding `inventory_transactions` with consistent reference IDs rather than guessing event sources.
- Online payment-pending orders currently decrement sellable stock. Model these explicitly as reservations before calling them sales.
- Configure activity retention and secure audit exports. Add a daily reconciliation report showing gaps rather than silently editing balances.
- Do not call the whole retail system production-ready until inventory, invoice numbering, tax, offline flow, restore and concurrency gates pass.
