# Supplier Purchasing / PO / Goods Receipts — Phase 5A (draft)

Status: **committed on `feature/production-hardening-20261017`, not applied to production.** The original shop does not yet have these supplier/purchasing tables. This is a staged implementation to be tested on an isolated Supabase clone before merging PR #12.

## Workflow

1. Admin registers an active supplier (name, optional phone and GSTIN).
2. Admin or inventory staff creates an ordered purchase order with distinct variants, quantities, snapshot cost per unit and optional note. Creating a PO does **not** change inventory.
3. After physically counting delivered goods, authorized staff enter the supplier invoice/delivery-note number and exact received quantities for the PO. Partial receiving is allowed.
4. `receive_purchase_order(uuid receipt_id,uuid po_id,text supplier_invoice,jsonb items)` locks the PO row, validates unreceived ordered quantities, then locks each variant in UUID order. In **one PostgreSQL transaction** it creates the GRN header + detail, increments variant stock, and appends signed `stock_in` movements with a new unique `reference_goods_receipt_line_id`, and updates PO status to `partially_received` or `received`.
5. Same receipt ID, same payload and same staff account replays the original GRN response without new stock. Different payload with reused ID is rejected. Same supplier + case-insensitive invoice number is rejected even if a new UUID is attempted. One invoice per GRN is assumed.
6. The Admin Purchasing screen persists any unconfirmed PO/GRN operation in **sessionStorage** and offers retry with the exact original operation ID/payload or manual release after reconciliation. This is a network-recovery hold, **not offline billing**; browser data/storage loss may still require supervised reconciliation.
7. Goods receipt can appear in `inventory_transactions` as a source-linked movement and also in the separate database-level `stock_change_events` audit; these are different views of **the same** stock change and must not be added together.

## Limits

- Existing old unrecorded stock remains unchanged. No backfill or reconstructed invoices.
- This is a single-store module, without locations/transfers. Purchasing stores **cost snapshot**, not full payment/accounting/tax input credit records. CA validation is required for GST handling.
- No supplier returns or corrections to a posted GRN. An incorrect receipt requires a controlled reversal process (planned next) rather than direct UPDATE/DELETE.
- No duplicate supplier-master prevention beyond human review yet (supplier names can recur).
- The purchase-order retry key has a session-scoped browser hold; do not create a new PO after a network timeout without reviewing the previous result.
- The current UI lists at most 2,000 active variants and 250 recent POs. Pagination/search, supervisor approvals, printing, attachment/evidence storage and comprehensive procurement reports are future work.
- Customer returns, refunds and exchanges are **a separate financial and inventory workflow**. They must link an original sale and cannot be implemented safely as a generic `stock_in` adjustment.
- Active staff RLS read policies and security-definer write checks prohibit direct browser edits to supplier/PO/GRN records and sensitive stock changes. This is **application-level auditability**, not independent tamper-proof storage.

## Acceptance and safety checks

- Run `tests/sql/supplier_purchase_receiving.sql` against a **disposable PostgreSQL 17 CI database**, including permission denial, supplier creation, PO idempotency, no stock on PO, partial/final receipts, invoice duplication, overreceiving refusal, retry, rollback after simulated late failure, and migration replay.
- Apply all preceding migrations in the documented order in isolated Supabase staging; confirm existing `inventory_tx_type.stock_in`, `inventory_transactions` signed balances, `auth.users`, `staff_profiles`, and `product_variants` are available.
- Test real admin/inventory/cashier sessions through PostgREST, test concurrent 50 duplicate-receipt submissions and two different receipts of the last outstanding units, assert exact stock and source movement reconciliation, and verify no caller can circumvent RPC with table writes.
- Test network loss after DB commit, reload and repeat request using same UUID. Receipt printing, purchase cost, and source history should be verified with realistic shop-specific PO documents.
- Owner signs off on suppliers, receiving process, return process, approval threshold and policies; accountant checks GST/accounting separately.
- Only after these pass, plan a DB-first deployment, device cache refresh and rollback/repair procedure. **No production database change, merge or storefront deployment is authorized by this work.**
