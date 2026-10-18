# Unified Staff Role — Billing + Inventory

## Goal
Rainbow Gold Covering displays **Staff** as the only non-admin role. A staff login can manage products, variants, stock adjustments, billing, bills, orders, customers and personal attendance. Admin-only dashboard, staff administration, reports, settings and oversight remain restricted.

## Compatibility
The existing Supabase enum contains `admin`, `inventory_staff` and `cashier`. The canonical stored value for unified Staff is **`cashier`** to keep the deployed `create-staff-user` Edge Function and existing `create_local_sale` RPC working without a breaking change. `inventory_staff` remains a deprecated enum value for old clients; a BEFORE trigger maps new or changed `inventory_staff` assignments to `cashier`.

## Deployment
1. Confirm a recent encrypted Supabase database backup and a maintenance window.
2. Apply `supabase/migrations/20261018222000_unify_billing_inventory_staff.sql` using the normal, reviewed database migration process **before** deploying the new website.
3. Deploy the web frontend revision and refresh/reopen staff sessions to update navigation.
4. Verify with staff test accounts: create/view products, read stock, add/remove stock with audited reasons, create a local sale, print an invoice, update customer details, view orders, record attendance.
5. Check a non-admin cannot reach staff management, reports or admin dashboard, including on direct URL access and through Supabase policies.
6. Confirm the admin can still create/deactivate staff and that pre-existing staff retain their logins, attendance and transaction history.

Read-only verification SQL:

```sql
select role::text, count(*) from public.staff_profiles group by role order by role;
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.staff_profiles'::regclass
  and tgname = 'canonicalize_shop_staff_role_trigger';
```

Existing inventory-only staff get expanded billing permissions **by design**. Do not deploy this change without accepting that access expansion. The migration does not delete accounts, products, invoices or historical records. Rolling back the frontend does **not** safely reverse these expanded permissions; a rollback requires a separately reviewed security migration and staff-role decisions.

## Safe staff removal (with order and inventory history)

Historical order, stock and payment records can reference `auth.users` without `ON DELETE CASCADE`, so deleting a login fails when it was used in a sale. The admin **Remove** button calls the existing `delete-staff-user` Edge Function, but now archives the account (`active=false`, `archived_at` set) and bans sign-in for 100 years. Non-admin data access remains blocked by RLS even with an unexpired token. The account disappears from the active staff list, but sales and stock records preserve the original employee ID.

Apply `20261018224500_archive_removed_staff.sql` before deploying the new Edge Function and frontend. **Deactivate** is for temporary inactivity; **Remove** is an archived employee and isn't restored by the UI. Names/usernames remain reserved while archived. Use a separately reviewed admin-only restore workflow if recovery is needed.

Verify using a test user with a test order: remove the test user, confirm login is rejected and the user is hidden from staff management, and confirm the order's `created_by` and stock ledger `created_by` are unchanged.
