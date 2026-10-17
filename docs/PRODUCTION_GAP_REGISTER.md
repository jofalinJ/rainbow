# Production hardening: risk register (branch-only work)

Repository: `jofalinJ/rainbow` — static HTML/JS storefront and admin, browser-based Supabase RPCs, Supabase migrations/Edge Functions, Vitest, Selenium and GitHub Actions.

Status: **technical review, not an approved production deployment**. No migrations were applied to the live Supabase project. This register documents confirmed code paths and checks required before claiming compliance or readiness.

| ID | Priority | Current evidence | Risk | Next action / acceptance proof |
| --- | --- | --- | --- | --- |
| RGC-P0-001 | Critical | `admin/billing.js` previously called `create_local_sale` without operation ID. | A committed sale can be submitted again if the response is lost. | Introduced staged `create_local_sale_once` + UUID retries on this branch; test duplicate replay and concurrent retry in isolated Supabase before rollout. |
| RGC-P0-002 | Critical | Stock adjustments have an atomic, attributable transaction path, but `docs/INVENTORY_ADJUSTMENTS.md` acknowledges historical gaps. | Not every stock change has a reconcilable ledger record. | Inventory all mutation paths (local POS, online sales, product creation, imports, returns), require source/actor/delta, and reconcile opening balances. |
| RGC-P0-003 | Critical | `create_local_sale` lives in the deployed DB; its original DDL is not in the repository's current migration history. | Rebuilding an isolated environment can diverge from production. | Export and review baseline schema/functions into version control; produce clean staging DB from migrations; prohibit ad hoc production edits. |
| RGC-P0-004 | Critical | `admin/billing.js` and online SQL use hard-coded 3% discount and 1.5% + 1.5% GST examples. | Tax treatment may differ across items and dates. | Add HSN/effective-dated tax configuration with CA-approved scenarios and invoice templates; do not claim GST compliance yet. |
| RGC-P0-005 | Critical | Original invoice numbers use `INV-YYYYMMDD-######` in deployed function (more than 16 characters). | Invoice series requires accountant/legal review for applicable Indian GST rules. | CA review and controlled compliant sequence migration; keep issued numbers immutable and traceable. |
| RGC-P0-006 | Critical | Browser clients call a live database over network; no durable IndexedDB POS outbox present. | Billing stops offline; a device crash can lose an unsubmitted draft. | Design offline allocations, protected per-device invoice series, transaction outbox, sync conflict review and 10k replay test. |
| RGC-P0-007 | High | Supabase database exists and CI covers static/unit suites; restore test evidence not in this repository. | Backups alone do not prove recoverability. | Document and execute a non-production restore drill with measured RPO/RTO and retained proof. |
| RGC-P0-008 | High | `tests/integration` and authenticated Selenium depend on isolated test credentials and flags. | A passing static CI run cannot prove database concurrency. | Configure isolated staging credentials and execute full transaction/stock/permission test suite. |
| RGC-P0-009 | High | Face attendance is optional and should not gate billing. | Privacy and access-control risk. | Keep non-biometric fallback, restrict face data, document retention/employee notices. |
| RGC-P1-010 | Medium | `docs/SHIPMENT_TRACKING.md` and courier modules exist. | Courier failure should not block core POS. | Test Professional Couriers AWB capture and tracking failure/retry separately from sales. |

## Branch 1 scope and validation gates

1. `create_local_sale_once` wraps existing `create_local_sale` **in the same SQL transaction**, stores an operation UUID and result, and returns the first committed response to same-key retries. No customer data or complete cart is stored in the idempotency table; only a SHA-256 request digest.
2. The browser reuses its **same immutable operation ID + original request** if a response is unknown. It blocks parallel checkout attempts and warns a cashier to review Bills/payment before clearing a hold.
3. A session-scoped UUID hold survives refresh (no customer details are stored in sessionStorage). After reload, the original cart is not reconstructed; staff must manually reconcile before starting a new transaction.
4. The legacy `create_local_sale` remains enabled for compatibility; **direct legacy calls bypass the new operation guard** until all clients have migrated and access is restricted.
5. The change does **not** implement offline billing, automatic payment verification, GST certification, immutable system-wide stock movements, or tested DR.

## Release and safety boundaries

- `main`: unchanged until explicit review/merge.
- Production database: **no writes or migrations** while developing this branch.
- GitHub Pages/public site: deploy only after staging validation; if Pages is configured to deploy from `main`, this branch cannot be assumed live.
- On staging: migrate schema; verify `create_local_sale_once` callable only by active cashier/admin; repeat one UUID 50 times; verify one invoice/order/payment/inventory decrement; test concurrent same-UUID requests; test same UUID with changed payload/actor; test insufficient stock and rollback; test HTTP timeout immediately after commit. Run baseline regression for local/online flows.
- Before merging: inspect CI, have accountant review tax and numbering, plan DB-first deployment, and communicate the browser-cache transition.
- After deployment: use separate change control to restrict legacy `create_local_sale` RPC permissions, then validate that every counter is upgraded.

**Definition of done for this phase:** branch commits, unit/static checks and reviewable staging migration. These alone are not production acceptance.
