\set ON_ERROR_STOP on
\ir ../../supabase/migrations/20261017234500_inventory_variance_report.sql
update public.staff_profiles set active=true
 where user_id='20000000-0000-4000-8000-000000000001';
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
begin
 if (select count(*) from public.inventory_variance_report(100)
  where status='MATCH')<>1 then
  raise exception 'Original baseline should match stock';
 end if;
end $$;
reset role;
-- This deliberate mismatch is created ONLY in disposable CI.
alter table public.product_variants disable trigger rainbow_variant_stock_update_audit;
update public.product_variants set stock_quantity=8
 where id='00000000-0000-4000-8000-000000000001';
alter table public.product_variants enable trigger rainbow_variant_stock_update_audit;
set role authenticated;
do $$
begin
 if (select count(*) from public.inventory_variance_report(100)
  where status='MISMATCH' and actual_qty=8 and recorded_qty=10)<>1 then
  raise exception 'Drift detection failed';
 end if;
end $$;
reset role;
update public.staff_profiles set active=false
 where user_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
begin
 if (select count(*) from public.inventory_variance_report(100))<>0 then
  raise exception 'Inactive admin can read inventory audit';
 end if;
end $$;
reset role;
\echo 'PASS: admin inventory variance report detects missing journal balance'
