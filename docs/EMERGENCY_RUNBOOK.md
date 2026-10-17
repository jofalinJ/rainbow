# Rainbow Gold Covering — Emergency Operations Runbook (DRAFT)

**Not a production launch authorization.** This runbook describes safe staff actions while staging validation, external payment integration and device certification remain unfinished.

## A sale was paid but the browser timed out

Do **not** open a fresh checkout operation or charge the customer again. Review **Bills** and the payment provider/bank statement first. If the same original POS page still offers a retry, it uses the original operation ID. When reloaded, the page blocks new checkout until the cashier reviews the existing bills and payment record. Escalate unknown differences to admin.

## Internet is unavailable

Use `admin/offline-drafts.html` to record **only** SKU/quantity notes on the local tablet. These are not completed sales, tax invoices, stock allocations or payments. Never accept money or promise stock from a draft. After reconnection, check current inventory/price/tax in online Billing, complete an official transaction and remove the reconciled local draft. Supported multi-counter offline billing is NOT available yet.

## A printer fails after payment

Keep the already committed invoice. Open Bills and reprint or export its PDF, after confirming the original invoice number. Never charge again merely to reprint.

## Stock total looks wrong

Open Inventory → Manage stock for the transaction history and independent database observed changes; review the admin-only variance report after its staging deployment. Identify source order, purchase receipt, cancellation or return. Do not directly edit PostgreSQL stock. Use authorized, reasoned adjustment only after physical recount and an audit note.

## Refund or return requested

Only an active admin may receive returns. Check the original paid sale and physical item condition. Restock **only** inspected sellable units. A requested refund is not a transferred refund; record confirmation only after actual external settlement proof. Real refund provider integration and GST credit notes remain acceptance blockers.

## Supplier delivery or purchase discrepancy

Do not increase stock for a purchase order. A goods receipt after physical recount is what increases quantities. When an entry response times out, retry the **same GRN UUID** or reconcile history. Never create a second GRN for the same supplier invoice. Corrections to incorrectly posted GRNs need an approved reversal flow (not yet implemented).

## Staff access or suspected security issue

Owner/admin disables the staff profile and revokes sessions using Supabase administration; reset exposed credentials, rotate server secrets without posting them in chat/repo and collect minimal audit evidence. Escalate a suspected personal-data breach to the responsible data-protection lead for the applicable statutory process. Do not share biometric templates, customer details or tokens with support screenshots.

## Database incident

Do not delete production data or manually rerun migrations. Restore only from a validated protected backup into a **separate test project** until integrity and financial/stock reconciliation are proven. The CI disposable database restore is a development test, not proof of a production RPO/RTO. Shop go-live requires the owner to approve a measured staging restore drill and defined recovery plan.

## Operational acceptance still required

Physical hardware inventory; approved GSTIN/HSN and invoice series; actual CA-certified sample invoices/credit notes; printer/scanner supported-device matrix; full Supabase staging and last-item concurrency tests; safe offline invoice allocation; payment settlement verification; redundant backups and restore drill; documented staff training and shop-owner approval.
