# Phase 5B — Customer returns are not refunds

This new staging migration `20261017231000_customer_return_intake.sql` and `admin/returns.html` implement controlled **physical intake** of customer goods linked to the original completed, paid order line.

An active admin selects a paid and completed original sale, specific sold item, quantity, reason and inspected condition. The RPC locks the parent order and rejects a return exceeding the original sold quantity minus prior return intakes. A stable client-generated operation UUID allows retry without duplicate intake. The record links the source `order_id`, `order_item_id`, variant, quantity, actor, condition and time.

**Sellable** condition: after physical inspection, the database adds the quantity back into saleable stock and writes a signed and source-linked `inventory_transactions` movement in the same transaction. A rolled-back transaction leaves neither. **Quarantine** condition: stores a physical intake record but does *not* increase saleable stock. Quarantined goods require a future supervisor inspection/release or disposal workflow.

Every intake has `financial_status='review_required'`. **No bank/UPI refund, no credit note, no order balance modification, no GST reversal, no order marked refunded, no exchange.** This is not a complete refund system. Customer refunds require separate authorization, settlement evidence, tax treatment, a permanent credit note and once-only payout reconciliation. Never tell a customer money was refunded based only on the intake record.

Older online orders without original source-ledger allocation are blocked for manual reconciliation. Local orders must have a source-linked `sale_local` record. Original paid evidence and completion status are checked, but external settlement and accounting must still be confirmed by shop staff.

### Release gates

1. Complete isolated PostgreSQL SQL test `tests/sql/customer_return_intake.sql` plus Vitest contracts.
2. Apply all migrations in a fresh full-schema Supabase staging DB, verify no deadlocks with online payment/cancellation, and enforce RLS on original read tables.
3. Run concurrent returns to the same order line and 50 duplicate retries; prove no cumulative over-return and no extra stock.
4. Test cashier/removed-staff rejection and direct PostgREST table write denial, invalid/legacy order references, external inventory changes, and after-commit network timeout.
5. Validate warehouse handling for quarantined stock (never shown as sellable), inspection and returns SOP.
6. Consult the shop accountant for GST, credit note and refund requirements before implementing payouts or marking financial refunds complete.

**Main/production remain unchanged.** Customer refunds and exchanges are still distinct production blockers.
