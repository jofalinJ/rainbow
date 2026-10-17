\set ON_ERROR_STOP on
-- Phase 5A integration, disposable Postgres 17 ONLY. Does not use real shop data.
-- Reuse the small Phase 3 fixture for an inventory schema and one stocked SKU.
\ir online_order_source_ledger.sql

do $$
begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
end $$;
grant usage on schema public,auth to anon,authenticated;
create table auth.users(id uuid primary key);
create type public.staff_role as enum ('admin','inventory_staff','cashier');
create table public.staff_profiles(
 user_id uuid primary key references auth.users(id),
 role public.staff_role not null,
 active boolean not null
);
insert into auth.users values
 ('20000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000003');
insert into public.staff_profiles values
 ('20000000-0000-4000-8000-000000000001','admin',true),
 ('20000000-0000-4000-8000-000000000002','inventory_staff',true),
 ('20000000-0000-4000-8000-000000000003','cashier',true);
grant select on public.staff_profiles,public.product_variants,public.inventory_transactions to authenticated;
\ir ../../supabase/migrations/20261017230000_supplier_purchase_and_grn.sql

-- Cashiers must not procure; direct client writes to supplier tables are denied.
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000003';
set role authenticated;
do $$
begin
 begin
  perform public.create_supplier('Unauthorized supplier',null,null);
  raise exception 'Cashier created a supplier';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.suppliers(supplier_name,created_by)
   values('Unauthorized edit','20000000-0000-4000-8000-000000000003');
  raise exception 'Client bypassed supplier write RPC';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
select public.create_supplier('Rainbow Test Wholesale','9990000000',null);
reset role;

-- Staging table values only; no PII from a live shop.
create temporary table ci_supplier as
select id from public.suppliers where supplier_name='Rainbow Test Wholesale';
grant select on ci_supplier to authenticated;
set role authenticated;
select public.create_purchase_order(
 '30000000-0000-4000-8000-000000000001',
 (select id from ci_supplier),
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":4,"unit_cost":"25.55"}]'::jsonb,
 'Approved test wholesale purchase'
);
do $$
begin
 if (select stock_quantity from public.product_variants
  where id='00000000-0000-4000-8000-000000000001')<>2 then
  raise exception 'Creating PO unexpectedly modified stock';
 end if;
 if not exists(select 1 from public.purchase_order_lines
  where purchase_order_id='30000000-0000-4000-8000-000000000001'
    and quantity_ordered=4 and unit_cost=25.55) then
  raise exception 'PO line/price snapshot missing';
 end if;
end $$;

-- The same PO ID and payload must return one document (no duplicate PO).
do $$
declare v jsonb;
begin
 select public.create_purchase_order(
 '30000000-0000-4000-8000-000000000001',
 (select id from ci_supplier),
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":4,"unit_cost":"25.55"}]'::jsonb,
 'Approved test wholesale purchase') into v;
 if v->>'replayed'<>'true' or (select count(*) from public.purchase_orders)<>1 then
  raise exception 'Purchase operation idempotency failed';
 end if;
 begin
  perform public.create_purchase_order(
  '30000000-0000-4000-8000-000000000001',(select id from ci_supplier),
  '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":2,"unit_cost":"25.55"}]'::jsonb,
  'Approved test wholesale purchase');
  raise exception 'Different PO payload unexpectedly accepted';
 exception when invalid_parameter_value then null;end;
end $$;

-- Receive part of the PO, then recover from same-operation retry.
select public.receive_purchase_order(
 '40000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001','TEST-INVOICE-001',
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb
);
do $$
declare v jsonb;
begin
 if (select stock_quantity from public.product_variants
  where id='00000000-0000-4000-8000-000000000001')<>4
  or (select status from public.purchase_orders
   where id='30000000-0000-4000-8000-000000000001')<>'partially_received'
  or (select count(*) from public.goods_receipts)<>1 then
  raise exception 'Partial receipt balance/status/count failed';
 end if;
 if not exists(select 1 from public.inventory_transactions it
  join public.goods_receipt_lines gl on gl.id=it.reference_goods_receipt_line_id
  where it.transaction_type='stock_in'
    and gl.goods_receipt_id='40000000-0000-4000-8000-000000000001'
    and it.quantity=2 and it.quantity_delta=2
    and it.stock_before=2 and it.stock_after=4) then
  raise exception 'Source linked receiving movement or balances missing';
 end if;
 select public.receive_purchase_order(
 '40000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001','TEST-INVOICE-001',
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb
 ) into v;
 if v->>'replayed'<>'true' or (select count(*) from public.goods_receipt_lines)<>1
  or (select stock_quantity from public.product_variants
  where id='00000000-0000-4000-8000-000000000001')<>4 then
  raise exception 'GRN retry allocated stock more than once';
 end if;
 begin
  perform public.receive_purchase_order(
   '40000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001','TEST-INVOICE-001',
   '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb);
  raise exception 'Same receipt id with changed details succeeded';
 exception when invalid_parameter_value then null;end;
end $$;

-- Two protections: same supplier invoice number, and outstanding ordered qty.
do $$
begin
 begin
  perform public.receive_purchase_order(
   '40000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000001','test-invoice-001',
   '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb);
  raise exception 'Duplicate invoice unexpectedly received';
 exception when unique_violation then null;end;
 begin
  perform public.receive_purchase_order(
   '40000000-0000-4000-8000-000000000003',
   '30000000-0000-4000-8000-000000000001','TEST-INVOICE-003',
   '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":3}]'::jsonb);
  raise exception 'Overreceipt unexpectedly accepted';
 exception when check_violation then null;end;
 if (select count(*) from public.goods_receipts)<>1
  or (select stock_quantity from public.product_variants
    where id='00000000-0000-4000-8000-000000000001')<>4 then
  raise exception 'Failed receipt left stock or GRN';
 end if;
end $$;

-- Final delivery completes the PO without changing pricing history.
select public.receive_purchase_order(
 '40000000-0000-4000-8000-000000000004',
 '30000000-0000-4000-8000-000000000001','TEST-INVOICE-004',
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb
);
do $$
begin
 if (select status from public.purchase_orders
  where id='30000000-0000-4000-8000-000000000001')<>'received'
  or (select stock_quantity from public.product_variants
   where id='00000000-0000-4000-8000-000000000001')<>6
  or (select count(*) from public.inventory_transactions
   where transaction_type='stock_in' and reference_goods_receipt_line_id is not null)<>2 then
  raise exception 'Final GRN failed reconciliation';
 end if;
 begin
  perform public.receive_purchase_order(
   '40000000-0000-4000-8000-000000000005',
   '30000000-0000-4000-8000-000000000001','TEST-INVOICE-005',
   '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb);
  raise exception 'Received PO unexpectedly allowed more receipts';
 exception when check_violation then null;end;
end $$;
reset role;

-- Inventory staff can open PO, cashier cannot receive stock even with an ID.
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000002';
set role authenticated;
select public.create_purchase_order(
 '30000000-0000-4000-8000-000000000002',
 (select id from ci_supplier),
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1,"unit_cost":"25.55"}]'::jsonb,
 'Another approved delivery'
);
reset role;
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000003';
set role authenticated;
do $$
begin
 begin
  perform public.receive_purchase_order(
   '40000000-0000-4000-8000-000000000006',
   '30000000-0000-4000-8000-000000000002','TEST-INVOICE-006',
   '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb);
  raise exception 'Cashier received stock without permission';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Force failure AFTER stock was incremented: all writes must roll back.
create function public.ci_block_receiving_ledger()
 returns trigger language plpgsql as $$
begin
 if pg_catalog.current_setting('rainbow_ci.reject_grn',true)='yes'
  and new.reference_goods_receipt_line_id is not null then
  raise exception 'CI forced receiving ledger failure';
 end if;
 return new;
end $$;
create trigger ci_block_receiving_ledger before insert on public.inventory_transactions
for each row execute function public.ci_block_receiving_ledger();
set rainbow_ci.reject_grn='yes';
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare prior_stock integer;prior_moves integer;prior_receipts integer;
begin
 select stock_quantity into prior_stock from public.product_variants
  where id='00000000-0000-4000-8000-000000000001';
 select count(*) into prior_moves from public.inventory_transactions;
 select count(*) into prior_receipts from public.goods_receipts;
 begin
  perform public.receive_purchase_order(
   '40000000-0000-4000-8000-000000000007',
   '30000000-0000-4000-8000-000000000002','TEST-INVOICE-007',
   '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb);
  raise exception 'Late failure not triggered';
 exception when others then
  if sqlerrm='Late failure not triggered' then raise;end if;
  if sqlerrm not like '%CI forced receiving ledger failure%' then raise;end if;
 end;
 if (select count(*) from public.inventory_transactions)<>prior_moves
   or (select count(*) from public.goods_receipts)<>prior_receipts
   or (select stock_quantity from public.product_variants
    where id='00000000-0000-4000-8000-000000000001')<>prior_stock then
  raise exception 'Receiving rollback left orphan writes or changed stock';
 end if;
end $$;
reset role;
reset rainbow_ci.reject_grn;
drop trigger ci_block_receiving_ledger on public.inventory_transactions;
drop function public.ci_block_receiving_ledger();

-- Rerunning the schema should not modify existing POs or stock.
\ir ../../supabase/migrations/20261017230000_supplier_purchase_and_grn.sql
do $$
begin
 if (select count(*) from public.goods_receipts)<>2
  or (select count(*) from public.purchase_orders)<>2
  or (select stock_quantity from public.product_variants
     where id='00000000-0000-4000-8000-000000000001')<>6 then
  raise exception 'Migration replay mutated procurement data';
 end if;
end $$;
\echo 'PASS: supplier, idempotent PO/GRN, partial/final receipt, source movement, guardrails and rollback'
