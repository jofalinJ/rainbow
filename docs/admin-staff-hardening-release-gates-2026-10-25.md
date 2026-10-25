# Rainbow Gold Covering — Admin / Staff Hardening Release Gates (25 October 2026)

**Branch:** `fix/ux-audit`. **Deployment:** NOT performed. **Production SQL:** NOT executed.

## What changed
- Tab-scoped Supabase admin/staff sessions (same storage configuration on login and protected pages).
- POS retry IDs, exactly-once settlement claim in `app_private.local_sale_requests`, duplicate variant rejection, mandatory walk-in customer, post-sale receipt recovery.
- Removed permissive local-order, order-item and payment RLS write policies that allowed a non-staff authenticated account to submit writes.
- Product + first variant in one transactional invoker-RLS database routine; product is not recreated on photo-upload failure.
- Admin/report aggregate totals computed server-side, not from arbitrary 50/1,000-row samples.
- POS catalogue bounded by name/code/type/description search plus exact barcode lookup.
- Server paginated/searchable staff bills, inventory, online orders and customers.

## Staged migrations — apply IN ORDER only in isolated staging first
1. `20261025120100_idempotent_local_sales.sql` — requires updated billing client; preserves existing RPC signature but now requires `p_customer.client_sale_id`.
2. `20261025120200_harden_local_order_rls.sql` — verify customer checkout uses checked backend functions and staff read policies remain usable.
3. `20261025120300_atomic_product_creation.sql` — `create_product_with_variant`.
4. `20261025120400_admin_exact_metrics.sql` — `get_admin_operational_metrics`.
5. `20261025120500_paginated_bill_history.sql` — `search_shop_bills`.
6. `20261025120600_paginated_inventory.sql` — `search_inventory_variants`.
7. `20261025120700_paginated_online_orders.sql` — `search_online_orders`.

Do not deploy modified JS/HTML before its dependent migrations. Do not apply a migration directly to the real shop until isolated tests and explicit production rollout approval. Avoid applying only part of this release and leaving the admin UI incompatible with the database.

## Mandatory isolated tests
- CI lint, Vitest unit suite, static build, Pages build, dependency audit.
- PostgreSQL migration lint, read/write RLS role matrix: anonymous storefront customer, authenticated customer, active cashier, active admin, archived staff.
- POS single sale with and without customer details; retry same `client_sale_id`, two simultaneous requests with same ID, changed request payload, invalid/duplicate variant IDs, lost HTTP response after commit, simultaneous sales against last stock unit.
- Create new product and variant; force variant failure to verify transaction rollback; force photo upload failure to verify recoverable completed product.
- Admin and staff login simultaneously in two browser tabs; navigate each page and reload, then sign out in one tab.
- Admin staff create/deactivate/remove; verify archived staff cannot call any privileged RPC while preserving history.
- Inventory/bills/orders/customers first/middle/last pages, search by name/code/barcode/phone; verify global counts.
- Bill PDF/print, invoice-token privacy, WhatsApp sending in a sandbox, attendance check-in/check-out and photo-review warnings on an Android tablet.
- Payment verification/refund/settlement regressions; never use real Razorpay transactions for tests.

## Remaining release blockers
- Authenticated Selenium and Supabase integration jobs may be skipped if isolated test credentials are not configured. Skipped is not passed.
- Production currently has no product/order/invoice fixtures; genuine billing and shipment flows require dedicated staging fixtures.
- Public invoice token access is deliberate, but its data-exposure policy and token handling must be reviewed.
- Supabase leaked-password protection is currently disabled; it requires an authentication setting change, not an application code change.
- Existing `fix/ux-audit` branch has a separate, extensive mobile checkout history and diverges from `main`; reconcile safely before any merge.

## Deployment order once approved
1. Back up database and record production migrations; test all seven migrations against staging.
2. Run isolated staff/admin and checkout E2E; verify CI is green.
3. Reconcile branch divergence, review checkout scope and security diff.
4. Apply SQL in a controlled maintenance release, immediately deploy compatible admin assets.
5. Perform read-only smoke tests and test staff transactions in a safe environment; monitor auth, API, orders and invoices.
6. Record rollback/forward-fix plan. Do not delete staff, orders, payments, audit rows or stock history.
