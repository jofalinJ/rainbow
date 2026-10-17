\set ON_ERROR_STOP on
-- Disposable PostgreSQL test; real shop data is never touched.
\ir online_order_source_ledger.sql

do $$
begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then
  create role authenticated nologin;end if;
 if not exists(select 1 from pg_roles where rolname='anon') then
  create role anon nologin;end if;
end $$;
grant usage on schema public,auth to authenticated,anon;
create table public.staff_profiles(user_id uuid primary key,role text not null,active boolean not null);
insert into public.staff_profiles values
 ('20000000-0000-4000-8000-000000000001','admin',true),
 ('20000000-0000-4000-8000-000000000002','cashier',true);
create table public.stock_change_events (
 id bigint generated always as identity primary key,
 variant_id uuid not null,
 stock_after integer
);
insert into public.stock_change_events(variant_id,stock_after)
select id,stock_quantity from public.product_variants;
create table public.goods_receipt_lines(id uuid primary key);
alter table public.inventory_transactions
 add column reference_goods_receipt_line_id uuid;
\ir ../../supabase/migrations/20261017235000_shop_daily_reconciliation.sql

set rainbow_test.actor_id='20000000-0000-4000-8000-000000000002';
set role authenticated;
do $$
begin
 begin
  perform public.shop_daily_reconciliation((now() at time zone 'Asia/Kolkata')::date);
  raise exception 'Cashier accessed financial diagnostics';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare v jsonb;
begin
 select public.shop_daily_reconciliation((now() at time zone 'Asia/Kolkata')::date) into v;
 if v->>'timezone'<>'Asia/Kolkata'
   or (v->'diagnostics'->>'stock_snapshot_mismatches')::integer<>0
   or (v->'diagnostics'->>'goods_receipt_lines_without_movement')::integer<>0 then
   raise exception 'Expected healthy starting snapshot';
 end if;
end $$;
reset role;
insert into public.inventory_transactions(
 variant_id,transaction_type,quantity,quantity_delta,stock_before,stock_after
) values(
 '00000000-0000-4000-8000-000000000001','sale_local',1,1,1,9
);
insert into public.inventory_transactions(
 variant_id,transaction_type,quantity,reason
) values(
 '00000000-0000-4000-8000-000000000001','sale_local',1,'Legacy movement'
);
insert into public.goods_receipt_lines(id)
values('50000000-0000-4000-8000-000000000001');
update public.product_variants set stock_quantity=stock_quantity+1
where id='00000000-0000-4000-8000-000000000001';

set role authenticated;
do $$
declare v jsonb;
begin
 select public.shop_daily_reconciliation((now() at time zone 'Asia/Kolkata')::date) into v;
 if (v->'diagnostics'->>'stock_snapshot_mismatches')::integer<>1
  or (v->'diagnostics'->>'goods_receipt_lines_without_movement')::integer<>1
  or (v->'diagnostics'->>'unbalanced_signed_movements')::integer<>1
  or (v->'diagnostics'->>'legacy_missing_signed_movements')::integer<>1 then
  raise exception 'Reconciliation failed to flag synthetic data integrity problems: %',v;
 end if;
end $$;
reset role;

update public.staff_profiles set active=false
where user_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
begin
 begin
  perform public.shop_daily_reconciliation((now() at time zone 'Asia/Kolkata')::date);
  raise exception 'Deactivated admin accessed reconciliation';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

\ir ../../supabase/migrations/20261017235000_shop_daily_reconciliation.sql
\echo 'PASS: reconciliation sees real issues and blocks unauthorized staff'
