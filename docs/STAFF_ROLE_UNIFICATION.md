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
