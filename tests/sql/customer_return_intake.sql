\set ON_ERROR_STOP on
-- Disposable CI-only schema fixture, never run on a real shop.
\ir online_order_source_ledger.sql
do $$
begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
end $$;
grant usage on schema public,auth to anon,authenticated;
create table auth.users(id uuid primary key);
insert into auth.users values('20000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002');
create type public.staff_role as enum ('admin','cashier');
create table public.staff_profiles(
 user_id uuid primary key references auth.users(id),
 role public.staff_role not null,
 active boolean not null
);
insert into public.staff_profiles values
 ('20000000-0000-4000-8000-000000000001','admin',true),
 ('20000000-0000-4000-8000-000000000002','cashier',true);
alter table public.orders add column updated_at timestamptz default now();
update public.orders set payment_status='paid',status='delivered'
where id=(select oi.order_id from public.order_items oi where oi.quantity=2 limit 1);
update public.payments set status='paid'
where order_id=(select id from public.orders where status='delivered');
\ir ../../supabase/migrations/20261017231000_customer_return_intake.sql
grant select on public.orders,public.order_items,public.staff_profiles,
 public.product_variants,public.inventory_transactions,public.payments to authenticated;

create temporary table ci_return_line as select oi.id,oi.order_id,oi.quantity
 from public.order_items oi join public.orders o on o.id=oi.order_id
 where o.status='delivered' and oi.quantity=2;
grant select on ci_return_line to authenticated;

set rainbow_test.actor_id='20000000-0000-4000-8000-000000000002';
set role authenticated;
do $$
begin
 begin
  perform public.intake_customer_return(
    '50000000-0000-4000-8000-000000000001',(select id from ci_return_line),
    1,'sellable','Cashier unauthorized return attempt');
  raise exception 'Cashier return unexpectedly succeeded';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
-- Customer returned an inspected sellable unit: stock increments exactly once.
select public.intake_customer_return(
 '50000000-0000-4000-8000-000000000001',
 (select id from ci_return_line),
 1,'sellable','Customer returned clean unused jewellery'
);
do $$
begin
 if (select stock_quantity from public.product_variants
 where id='00000000-0000-4000-8000-000000000001')<>3 then
  raise exception 'Sellable return was not added to stock';
 end if;
 if not exists(select 1 from public.inventory_transactions it
 join public.customer_returns r on r.id=it.reference_customer_return_id
 where r.id='50000000-0000-4000-8000-000000000001'
   and it.transaction_type='return' and it.quantity=1 and it.quantity_delta=1
   and it.stock_before=2 and it.stock_after=3) then
  raise exception 'Source-linked return stock movement missing';
 end if;
 if not exists(select 1 from public.customer_returns
 where id='50000000-0000-4000-8000-000000000001'
  and financial_status='review_required') then
  raise exception 'Return incorrectly marked financially completed';
 end if;
end $$;
-- Duplicate returns replay without adding stock.
do $$
declare response jsonb;
begin
 select public.intake_customer_return(
 '50000000-0000-4000-8000-000000000001',(select id from ci_return_line),
 1,'sellable','Customer returned clean unused jewellery') into response;
 if response->>'replayed'<>'true'
  or (select count(*) from public.customer_returns)<>1
  or (select stock_quantity from public.product_variants
    where id='00000000-0000-4000-8000-000000000001')<>3 then
  raise exception 'Retry added duplicate stock';
 end if;
 begin
  perform public.intake_customer_return(
   '50000000-0000-4000-8000-000000000001',(select id from ci_return_line),
   1,'quarantine','Changed condition rejected');
  raise exception 'Return operation changed without rejection';
 exception when invalid_parameter_value then null;end;
end $$;
-- Quarantine must track physical return without adding sellable quantity.
select public.intake_customer_return(
 '50000000-0000-4000-8000-000000000002',(select id from ci_return_line),
 1,'quarantine','Scratched item returned for quality inspection'
);
do $$
begin
 if (select stock_quantity from public.product_variants
 where id='00000000-0000-4000-8000-000000000001')<>3
 or (select count(*) from public.inventory_transactions
  where reference_customer_return_id is not null)<>1 then
  raise exception 'Quarantined goods incorrectly entered sellable stock';
 end if;
 begin
  perform public.intake_customer_return(
   '50000000-0000-4000-8000-000000000003',(select id from ci_return_line),
   1,'sellable','Attempt to return more than originally sold');
  raise exception 'Over-return unexpectedly accepted';
 exception when check_violation then null;end;
end $$;
-- For pending online orders, return intake MUST be refused.
do $$
begin
 begin
  perform public.intake_customer_return(
    '50000000-0000-4000-8000-000000000004',
    (select oi.id from public.order_items oi join public.orders o on o.id=oi.order_id
     where o.payment_status='pending' limit 1),
    1,'sellable','Pending order must never receive goods back');
  raise exception 'Pending payment return unexpectedly accepted';
 exception when check_violation then null;end;
end $$;
reset role;

-- Simulate late ledger insertion failure after the physical stock update.
create function public.ci_fail_return_movement()
returns trigger language plpgsql as $$
begin
 if new.reference_customer_return_id is not null then
  raise exception 'CI forced financial movement fault';
 end if;
 return new;
end $$;
create trigger ci_fail_return_movement before insert
on public.inventory_transactions for each row
execute function public.ci_fail_return_movement();
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
-- Create another fully-paid sold item by completing the other pending order.
update public.orders set status='delivered',payment_status='paid'
where payment_status='pending';
update public.payments set status='paid'
where order_id in(select id from public.orders where status='delivered');
set role authenticated;
do $$
declare v_item uuid;before_stock int;before_returns int;
begin
 select oi.id into v_item from public.order_items oi
 join public.orders o on o.id=oi.order_id
 where o.status='delivered' and oi.quantity=1 limit 1;
 select stock_quantity into before_stock from public.product_variants
  where id='00000000-0000-4000-8000-000000000001';
 select count(*) into before_returns from public.customer_returns;
 begin
  perform public.intake_customer_return(
  '50000000-0000-4000-8000-000000000005',v_item,
  1,'sellable','Fault injection after restocking sellable product');
  raise exception 'Injected fault did not fire';
 exception when others then
   if sqlerrm='Injected fault did not fire' then raise;end if;
   if sqlerrm not like '%CI forced financial movement fault%' then raise;end if;
 end;
 if (select stock_quantity from public.product_variants
    where id='00000000-0000-4000-8000-000000000001')<>before_stock
    or (select count(*) from public.customer_returns)<>before_returns then
  raise exception 'Failed ledger write persisted partial stock change';
 end if;
end $$;
reset role;
drop trigger ci_fail_return_movement on public.inventory_transactions;
drop function public.ci_fail_return_movement();

\ir ../../supabase/migrations/20261017231000_customer_return_intake.sql
do $$
begin
 if (select count(*) from public.customer_returns)<>2 then
  raise exception 'Migration replay duplicated returned items';
 end if;
end $$;
\echo 'PASS: original sale linked returns, quarantine, paid gate, roles, bounded quantities, retry, rollback'
