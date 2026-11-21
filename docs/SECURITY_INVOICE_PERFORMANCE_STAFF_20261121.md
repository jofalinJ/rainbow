# Security, invoice privacy, performance and staff tests — staged follow-up

**Scope:** Draft PR stacked on integration PR #115. Do not deploy or apply SQL automatically. No customer/order/stock mutation has been performed.

## Verified read-only production findings (21 November 2026)

- **Invoice bearer token:** `invoices.public_token` defaults to `gen_random_uuid()` and is protected by unique indexes. The anonymous `get_public_invoice(uuid)` function intentionally returns paid/eligible invoice details to holders of a hard-to-guess URL. Browser code uses only name, phone, items, totals and payment method; the existing response unnecessarily included email and full postal address fields. Those are removed by the proposed function migration while preserving all currently displayed fields and the order/payment eligibility conditions.
- **Browser leakage:** `invoice.html` previously did not specify no-referrer or explicit cache prevention. The staged Cloudflare Pages `_headers` adds `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store` and noindex flags for the invoice page. An HTML meta referrer fallback also applies. Invalid URL tokens are rejected before RPC, and invoice errors no longer log provider objects.
- **Staff role integrity:** `staff_profiles_archived_are_inactive` already requires archived staff to be disabled. A read-only query found zero conflicting records. Keep the existing CHECK; do not add a redundant constraint or blindly revoke authenticated staff RPCs. The UI now has additional mock-session tests of admin-only Audit History access and disabled/archived role rejection.
- **Database performance:** `idx_invoices_unique_public_token` and `invoices_public_token_uidx` are both valid, standalone unique btree indexes on the identical `invoices.public_token` column. Neither is constraint-owned. The proposed migration removes only the redundant `idx_invoices_unique_public_token`, guarded by checks that the preserved index is valid and unique. Disposable PostgreSQL verifies uniqueness and idempotence. **Do not drop both indexes**.
- **RLS:** Four service-internal tables have RLS without browser policies: `erp_online_reservations`, `erp_pos_requests`, `manual_upi_checkout_requests`, `razorpay_checkouts`. In production, no browser role SELECT grant exists for the first two checked. Absence of policies can be intentional deny-all behavior; do not add permissive policies merely to silence an advisory.
- **Security advisor:** 24 authenticated-callable SECURITY DEFINER functions, including ERP/stock, shipments, orders and role helpers, remain flagged for manual authorization review. Calling by an authenticated role is not automatically a flaw; inspect each function's `auth.uid()`, staff role/location checks, inputs, search_path, and RLS interactions. The one anonymous SECURITY DEFINER warning is the bearer-token invoice function, whose public access is intentional but now returns less PII.
- **Other advisor findings:** Leaked-password protection is not enabled in Supabase Auth; an account owner should enable this in the Auth security settings. Performance advisors report 25 unindexed foreign keys, 32 multiple permissive policies, 14 unused indexes and 1 duplicate index. Only the **confirmed identical invoice index** is removed here. Treat the rest as candidates pending query workload, FK cascade and policy-behavior analysis.

## Test evidence required before approval

1. `npm run test:unit` covers invalid invoice tokens, no provider-error logs, legitimate PDF/print display and WhatsApp button, invoice page referrer/cache rules, admin-only audit navigation, revoked/archived staff profiles.
2. `npm run build:pages` must contain `dist-pages/_headers` and `dist-pages/invoice.html`; no private SQL or service credentials may enter the static bundle.
3. Disposable PostgreSQL invoice privacy test must prove that an anonymous holder of a valid paid receipt token can still read name, phone, items, IGST, totals, payment method while email/address/pincode are absent. Unpaid, cancelled and unknown-token invoices remain inaccessible.
4. Disposable PostgreSQL invoice-index test must prove duplicate-index removal preserves token uniqueness, does not change invoice records and is safe to rerun.
5. Rerun **all** integrated #115 CI workflows after the stacked PR is reviewed; a passing individual patch does not prove combined production behavior.
6. Live external test should use **authorized test invoices only**, with no real customer PII in bug reports or CI artifacts.

## Privacy limits and proposed release sequence

The public invoice link remains a *bearer link*: anyone with the unguessable token can view an eligible invoice including the customer's name and phone. This supports existing shared invoices and the WhatsApp button. Avoid putting this URL into analytics, redirects, external messages without consent, support tickets or unredacted logs. For higher privacy, a future customer-authenticated invoice workflow is needed and would change the UX; do not silently revoke existing paid receipts.

After the approved #115 migrations, apply (in staging first) the two additional SQL migrations in order:
1. `20261121190000_deduplicate_invoice_token_index.sql` — requires a brief DDL lock, so schedule and review database activity; it does **not** change invoice records. It can be rolled back by creating the removed unique index if necessary.
2. `20261121191500_minimize_public_invoice_pii.sql` — replaces the anonymous RPC JSON projection but does not revoke/replace bearer tokens. Rollback must restore the prior reviewed function definition, not drop the public invoice endpoint.

Deploy the Pages `_headers` and changed `invoice.js` together with approved admin assets. Validate the actual HTTP response headers on production; do not assume that a successful local static build proves Cloudflare applies them. The `_headers` file must be deployed at the output root for the Pages route to be protected.

## Remaining manual/isolated acceptance

Authenticated Selenium requires the existing GitHub Actions `test` environment, dedicated test Supabase instance, non-production admin/cashier credentials and `RAINBOW_E2E_READY=true`. Do not substitute production credentials. Tests here are mocked browser authorization, not actual Supabase login or Android devices.

**Relevant Supabase guidance:** [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Privileged anonymous function warning](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [Privileged authenticated function warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [Unindexed FKs](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
