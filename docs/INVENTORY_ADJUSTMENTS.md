# Stock adjustments and transaction history

The existing **Admin → Inventory** page now offers **Manage stock** on each active product variant.

## Staff workflow

1. Log in as an **Admin** or **Inventory Staff** account.
2. Open **Inventory**, select a category and find the product or barcode.
3. Click **Manage stock** to see the latest server quantity and the most recent 30 logged transactions.
4. Choose **Add stock** or **Remove stock**, enter a positive whole-number quantity and a clear reason (8–240 characters).
5. Review the calculated new stock and click **Save adjustment**.
6. The server locks the variant, refuses negative stock, updates the quantity, and inserts a signed transaction with the authenticated staff ID and timestamp in **one database transaction**.
7. The Inventory totals and transaction list refresh.

### Why this is safer

- No negative stock; even concurrent adjustments use `SELECT ... FOR UPDATE`.
- Existing `inventory_transactions` is reused. New manual adjustments record **quantity_delta**, **stock_before**, **stock_after**, reason, actor and time.
- Signed-in web clients can **read** transaction history if they are authorized staff, but cannot directly insert, update or delete ledger records.
- The RPC checks the staff role on the server. Cashiers and customers cannot use stock adjustments.
- **No historical stock, orders or invoices were changed** by the schema migration.

### Limitations and next steps

- This page shows the latest 30 **recorded transactions**, not a reconstruction of every stock change since the store began operating. Older variants created with initial stock may lack a corresponding movement row.
- Historical `sale_local` entries already exist, and new manual adjustments are recorded. Other legacy code paths that change stock directly may not yet record a matching `inventory_transactions` row. Comprehensive audit coverage for **every** change requires reviewing and migrating those paths; do not assume the ledger is fully reconciled.
- Manual corrections require an explanatory reason. They do not currently require a second administrator to approve them.
- Supplier purchasing, stock transfers, returns, and multiple store locations are not part of this update.
- Authenticated Selenium and isolated Supabase integration tests require a configured isolated test environment; no real staff adjustments were made by automated tests.

### Safe acceptance test

In a separate staging/test database with authorized accounts: create a sample variant, record +3 stock with a reason, verify the ledger and balance, remove 1, verify new balance, try removing more than available (must fail), and confirm a cashier has no RPC access. Never use a live customer SKU for destructive tests.

## Implementation

- Migration: `supabase/migrations/20261015195000_inventory_adjustments_and_history.sql`.
- API: `public.adjust_variant_stock(p_variant_id uuid,p_quantity_change integer,p_reason text)`.
- UI: `admin/inventory.html`, `admin/inventory.js`, `admin/inventory-adjustments.mjs`, `admin/inventory-stock.css`.
- Pure validation: `src/domain/stockAdjustmentRules.mjs`.
- Unit coverage: `tests/unit/stockAdjustments.test.mjs`.
