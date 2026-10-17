# Rainbow — Supabase advisor review (17 October 2026)

**Read-only inspection of the current live project. No permission changes were applied.**

Security advisor: [Supabase security lints](https://supabase.com/docs/guides/database/database-linter). The service reported five anonymously callable elevated (`SECURITY DEFINER`) functions: `audit_order_shipment`, `create_online_order`, `get_public_invoice`, `track_guest_order_shipments`, and `track_online_order`. It also reported signed-in callers can execute other elevated functions, including checkout and inventory RPCs. **These are warnings, not proof each function is exploitable.**

## Triage / safe remedies

- **`create_online_order`:** anonymous use is currently expected for guest checkout. Before production, add verified rate limiting/abuse controls, inventory reservation expiry and payment verification. Revoking public execution without a replacement would break checkout.
- **`get_public_invoice`:** public token access is intentional for invoice links, but can disclose customer identity/address to anyone with the token. Review token lifetime, PII minimization, leakage into analytics/logging and revocation policy. Do not switch this function to logged-in only while existing WhatsApp/customer links depend on it.
- **`track_guest_order_shipments`, `track_online_order`:** guest product-code + phone lookup may enable enumeration or reveal address/shipping details. Prefer unguessable order tracking tokens, rate limits and minimal response fields. Review before retaining anonymous execute grants.
- **`audit_order_shipment`:** apparently a trigger function. Verify its actual signature, return type, privileges and use sites. If trigger-only, remove unnecessary direct anonymous/signed-in EXECUTE grants **in a reviewed migration**, testing shipment insert/update paths. Do not disable shipment auditing.
- **Signed-in admin/staff RPCs:** grants to the broad `authenticated` database role are acceptable only when each SECURITY DEFINER function checks its authenticated user, active staff profile and permitted role server-side. Test deactivated cashiers, nonstaff customer accounts, shipment updates and direct table mutations.
- **Database RLS:** verify every new and existing data table, including biometric attendance, payments and staff records. Run Supabase advisors again after each migration.

Performance advisor: [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). Six missing FK-covering indexes were flagged around online order status events, order shipments, shipment events, notification confirmations and storefront promotion. Plan indexes from query plans/table sizes and schedule a low-risk migration. Other unused-index notices should **not** trigger automated index deletion without workload evidence.

## Release gate

Reproduce the above role matrix in an isolated full-schema Supabase staging environment. Investigate authorization and rate-limit abuse under permitted test traffic; never exercise spam/DoS tests against the live shop. Keep `main` unchanged and new checkout/return/grn functions undeloyed until review.
