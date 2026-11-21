# Verified customer account tracking — staged security fix

This PR is a **non-production draft** stacked on PR #116, which is stacked on the integrated release candidate PR #115. It does not merge, deploy, alter live customer details, or send customer messages.

## Finding

`public.track_my_online_orders()` and `public.track_my_order_shipments()` are authenticated-accessible SECURITY DEFINER SQL functions. In production they currently associate orders by comparing `public.customers.email` to the `email` in the caller's JWT. The old logic checks that `auth.uid()` exists, but does not independently require email verification. It also trusts an email claim that may be stale after an account email change.

- The current project read-only check on 21 November 2026 reported **12 email-verified users and zero unverified-email users**. No exploitation has been established.
- Four online orders exist, one associated with a currently verified user's email. This change preserves the customer-facing tracking path for a verified existing account.
- The functions currently allow `authenticated` to execute and disallow `anon`; this migration preserves those privileges and return types.

## Mitigation

Use the **current** `auth.users.email` joined on `auth.uid()`, with `auth.users.email_confirmed_at IS NOT NULL`, instead of `auth.jwt()->>'email'`. This enforces verification and avoids access through a stale prior email claim. It preserves the original order status/source filters, sorting, limits, returned columns and RPC names. No direct access to `auth.users` is granted to browser roles: the restricted database functions run under their designated SECURITY DEFINER owner.

`auth.users` is an internal Supabase-managed schema, so review any future Auth schema changes before major Supabase upgrades. The client must not be granted table access.

## Test coverage

The disposable PostgreSQL workflow provisions synthetic verified Alice and Bob, an unverified Eve, two paid orders and shipment numbers, plus a third unverified order.

It asserts:
1. Verified Alice can see only her own order and shipment.
2. Verified Bob cannot see Alice's order even when the simulated JWT email claim is Alice's.
3. Unverified Eve sees no orders or shipments, even when the JWT email matches an existing order.
4. A missing login sees neither result.
5. Alice's former email claim cannot retrieve orders when her current Auth email changes.
6. Restoring the current verified Auth email restores legitimate tracking.
7. `anon` cannot execute either function and `authenticated` still can.
8. SQL migration is idempotent on the isolated database.

## Remaining privacy limits

Matching email alone is still a transitional design: an account that legitimately gains a previously used address can potentially match old orders associated with that email. A future design should bind each online order to an authenticated `auth.users.id` or separately verified claim, including a safe migration path for guest checkouts. Do not automatically transfer historical orders to a new holder of a recycled email address.

Production Auth email-confirmation settings should remain enabled, and leaked-password protection should be enabled by the owner in Supabase Auth settings separately. No changes to live Auth settings are part of this PR.

## Release and rollback

After #115 and #116 are reviewed and deployed in an approved sequence, run `supabase/migrations/20261121203000_verified_customer_order_tracking.sql` on a protected staging copy first. Verify direct permissions, legitimate order tracking, account switching and stale-email behavior in browser tests using **only isolated test credentials**.

For rollback, restore the previously reviewed original function definitions with the original grants; do not open access to `anon` or drop the functions. No tables or customer data are migrated or deleted.

Guidance: https://supabase.com/docs/guides/auth/managing-user-data and https://supabase.com/docs/guides/database/postgres/row-level-security.
