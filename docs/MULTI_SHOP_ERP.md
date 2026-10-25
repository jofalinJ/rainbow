# Rainbow Gold Covering — Multi-Shop ERP staging guide

**DRAFT: DO NOT MERGE, DEPLOY, APPLY SQL TO PRODUCTION OR ENABLE THE PUBLIC ERP CATALOGUE YET.**
Branch: feature/multi-shop-erp. Does not modify fix/ux-audit or main.

## Verified existing system (25 October 2026)

Production database already has shared products, product_variants, product_images,
staff_profiles, branches, orders, inventory_transactions, Razorpay checkout,
and RLS. Existing product_variants.stock_quantity is a **global** stock count
used by physical billing and Razorpay reservations. Existing product management
already supports paginated catalogue and CSV imports. Two branch records exist
at inspection, but no per-branch stock records were present.

## New logical architecture

- erp_locations: one physical location per branch plus one ONLINE location.
- erp_stock_balances: on_hand and reserved for each (location, variant).
- erp_staff_locations: assignment for staff; super admin reads all shops.
- erp_stock_events: immutable auditable records; clients cannot edit directly.
- erp_transfers: dispatch deducts source; receipt increases destination.
- erp_online_listings: only admin-published products qualify for new online listing.
- erp_online_reservations: service-role-only atomic *whole-cart* reservation and
  settlement for 1–50 distinct variants; verified payment is required before
  the backend calls paid settlement. No live checkout integration is enabled.
- erp_suppliers, erp_purchase_orders, erp_purchase_lines, erp_purchase_receipts:
  basic supplier purchasing and idempotent goods receipt.
- Existing products, variants and images remain shared across all shops.

Example: Shop One 20 + Shop Two 15 + ONLINE 5 = 40 physical units in company
possession. Transfers in transit are company-owned but not available to sell.

## Features staged in branch

1. Schema, RLS, transactional stock changes and branch access assignments.
2. Staff ERP page: search by product name/code/barcode, reuse images, add stock,
   optional barcode camera scan, CSV preview/import, dispatch/receive transfers.
3. Admin online publication and pricing, isolated online allocation and reserved
   stock RPCs. Optional public read-only catalogue endpoint at GET /api/erp/catalogue
   requires ERP_CATALOGUE_ENABLED=true. Default: **disabled**.
4. Search indexes for 10k+ products, shared image lookups, small search batches,
   pagination, mobile-friendly tablet display and database-side admin metrics.
5. Shop dashboards with per-branch quantity breakdown and total company stock,
   permissions, purchases, receipts, transfer ledger and reorder settings.

## Critical incomplete integrations — mandatory before production

- Legacy physical sale RPCs and Razorpay payment-reservation RPCs still read/write
  product_variants.stock_quantity, NOT the new location-based balances.
- There is NO safe automatic attribution of old stock to branches. Perform a
  physical stock count, reconcile signed totals, backfill with an auditable
  one-time migration and choose one authoritative stock source.
- Ensure each POS order/invoice identifies the selected shop, with server-side
  shop-membership authorization and atomic location stock deduction.
- Ensure Razorpay and manual UPI flows correctly reserve ONLINE allocated stock,
  check server-verified payment, finalize exactly once, release expired
  reservations, handle late captures/refunds and never double deduct stock.
- Confirm concurrent checkout vs shop sales, failed requests, supplier and
  transfer retries, RLS negative cases and refunds in an isolated environment.
- Do not enable a dual-write period without a proven reconciliation scheme.
- Verify backups and rehearse restore/rollback before main merge or deployment.

## Test and deployment sequence (isolated environment only)

1. Create a disposable Postgres or local Supabase instance. NEVER production.
2. Load fixture: tests/sql/erp-fixture.sql (only for disposable PostgreSQL).
3. Apply staged migrations in order:
   - supabase/migrations/20261025210000_multi_shop_erp_staged.sql
   - supabase/migrations/20261025211000_erp_catalogue_indexes.sql
   - supabase/migrations/20261025212000_erp_public_catalogue.sql
4. Run tests/sql/erp-behavior.sql. GitHub workflow erp-sql-ci.yml performs this
   against PostgreSQL 17 in a disposable CI container.
5. Run npm ci, npm run lint, npm run test, npm run build and backend npm test,
   npm run check. Run browser/E2E with isolated staff accounts and database.
6. Set up three test staff users (admin, Shop A, Shop B) and verify cross-branch
   denials, retries/idempotency, transfer-in-transit totals, bulk import partial
   failure, purchase receipt, online reservations and payment retry safety.
7. Point test admin config at test Supabase and visit /admin/erp.html.
   Continue to use the existing public storefront with ERP catalogue disabled.
8. Only after a separate reviewed cutover, migrate authoritative live inventory
   and integrate checkout/billing with location stock; promote to main and deploy
   only after explicit approval and successful reconciliation.

## Operational rules

Products are uniquely identified by product code plus variant ID, not a shared
name. Similar names may refer to distinct sizes, colours, or designs.
Images are stored once per master product. Staff shop-specific changes must use
idempotent RPCs and never manually overwrite a stock field. CSV imports are
per-row transactions and can partially succeed; do not re-import completed
batches. Online listing publication alone does not add physical stock.
