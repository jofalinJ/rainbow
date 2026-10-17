# Daily operational reconciliation — staged read-only diagnostics

The new `shop_daily_reconciliation(p_day date)` RPC requires an **active admin** and returns a bounded read-only snapshot of one India shop day. It never changes transactions, payments, stock, invoices or historical audit rows.

The date boundary is **Asia/Kolkata**. Metrics are deliberately separate:

- **Settled order face value**: order totals of orders CREATED that day whose order payment state is currently `paid`; this is not net recognized revenue.
- **Paid tender total**: payments whose paid timestamp (or created timestamp if paid timestamp is missing) falls that day; cash, UPI and card are broken out. Orders and tenders may fall on different days and have valid timing differences.
- **Pending orders**: created that day and not payment verified.
- **Exceptions**: missing old signed movements, arithmetic-broken signed movements, variant stock snapshot mismatch with the database event journal, GRN lines without movements, online order lines without source movements (includes old pre-ledger orders), and duplicated paid payment references.

**Do not automatically reconcile by editing inventory or issuing new payments.** The dashboard flags candidates for manager review, not proven financial losses. Any accepted discrepancy must be traced to source documents, payment provider statements, physical stock, correct sales/return tax treatment, and the accountant-approved accounting ledger. This API does not validate e-invoice/GSTIN/HSN compliance, does not prove a bank settlement and is not a credit note.

The SQL depends on `stock_change_events` (Phase 2) and `goods_receipt_lines` (Phase 5A). Apply only to an isolated full-schema Supabase staging environment first. The disposable PostgreSQL regression fixture `tests/sql/shop_daily_reconciliation.sql` checks authorization and deliberately injected stock/ledger exception signals.

Before promotion: run with real admin/cashier auth, reproduce known stock discrepancies and same-day/next-day payment settlement, reconcile all live POs and returns, verify query performance on production-like volumes, establish daily export/retention and accountant signoff. **No production migration has been applied.**
