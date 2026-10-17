\set ON_ERROR_STOP on
-- This script is for a disposable PostgreSQL 17 database ONLY.
-- It first exercises the Phase 3 online-order fixture in the SAME disposable DB,
-- then tests Phase 4 cancellation on existing fixture orders.
\ir online_order_source_ledger.sql

create role anon nologin;
create role authenticated nologin;
grant usage on schema public,auth to anon,authenticated;

create table auth.users(id uuid primary key);
insert into auth.users(id) values
 ('20000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002');
create type public.staff_role as enum ('admin','cashier','inventory_staff');
create type public.order_status as enum (
 'pending','confirmed','processing','shipped','delivered','cancelled','refunded'
);
create type public.order_source as enum ('online','local_store');
alter table public.orders
 alter column source type public.order_source using source::public.order_source,
 alter column status type public.order_status using status::public.order_status;
alter table public.payments
 add column paid_at timestamptz,
 add column verified_at timestamptz;
create table public.staff_profiles(
 user_id uuid primary key references auth.users(id),
 role public.staff_role not null,
 active boolean not null
);
insert into public.staff_profiles(user_id,role,active) values
 ('20000000-0000-4000-8000-000000000001','admin',true),
 ('20000000-0000-4000-8000-000000000002','cashier',true);
create table public.online_order_status_events (
 id bigint generated always as identity primary key,
 order_id uuid not null references public.orders(id),
 previous_status public.order_status not null,
 new_status public.order_status not null,
 actor_id uuid not null references auth.users(id),
 changed_at timestamptz not null default now()
);
create table public.order_shipments(
 order_id uuid primary key references public.orders(id)
);
\ir ../../supabase/migrations/20261017224500_cancel_unpaid_online_orders.sql

set rainbow_test.actor_id='20000000-0000-4000-8000-000000000002';
set role authenticated;
do $$
declare v_id uuid;
begin
 select id into v_id from public.orders order by order_number limit 1;
 begin
   perform public.cancel_unpaid_online_order(
     v_id,'Cashier is not authorized to release',true
   );
   raise exception 'Cashier cancellation unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

set rainbow_test.actor_id='';
set role authenticated;
do $$
declare v_id uuid;
begin
 select id into v_id from public.orders order by order_number limit 1;
 begin
   perform public.cancel_unpaid_online_order(
     v_id,'Anonymous user not authorized',true
   );
   raise exception 'Unauthenticated cancellation unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

-- Pick the first real fixture order (one line, allocated qty 2).
create temporary table ci_target_orders(id uuid,kind text);
insert into ci_target_orders(id,kind)
select o.id,
 case when oi.quantity=2 then 'cancel' else 'other' end
from public.orders o
join public.order_items oi on oi.order_id=o.id
where o.source='online';
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare v_id uuid;
begin
 select id into v_id from ci_target_orders where kind='cancel';
 begin
   perform public.cancel_unpaid_online_order(
     v_id,'Unpaid order should need bank attestation',false
   );
   raise exception 'Missing payment check was accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.cancel_unpaid_online_order(
     v_id,'too short',true
   );
   raise exception 'Short reason was accepted';
 exception when invalid_parameter_value then null;
 end;
end $$;

-- The authenticated test actor gets only public.execute RPC permissions.
select public.cancel_unpaid_online_order(
 (select id from ci_target_orders where kind='cancel'),
 'Customer cancelled; checked actual UPI statement; unpaid.',true
);

do $$
declare v_id uuid;
begin
 select id into v_id from ci_target_orders where kind='cancel';
 if (select status from public.orders where id=v_id)<>'cancelled'
    or (select payment_status from public.orders where id=v_id)<>'pending'
    or (select stock_quantity from public.product_variants
        where id='00000000-0000-4000-8000-000000000001')<>4 then
   raise exception 'Cancellation state or stock balance is wrong';
 end if;
 if (select count(*) from public.inventory_transactions
      where reference_order_id=v_id and transaction_type='return')<>1 then
   raise exception 'Expected precisely one cancellation return movement';
 end if;
 if not exists (
   select 1 from public.inventory_transactions
   where reference_order_id=v_id and transaction_type='return'
     and quantity=2 and quantity_delta=2 and stock_before=2 and stock_after=4
     and created_by='20000000-0000-4000-8000-000000000001'
     and reason like 'Online cancellation:%'
 ) then
   raise exception 'Return movement is missing source, balances or actor';
 end if;
 if (select count(*) from public.online_order_cancellations where order_id=v_id)<>1
    or (select count(*) from public.online_order_status_events
        where order_id=v_id and previous_status='pending'
          and new_status='cancelled')<>1 then
   raise exception 'Missing cancellation / order status audit event';
 end if;
 if not exists (
   select 1 from public.payments
   where order_id=v_id and status='pending'
 ) then
   raise exception 'Payment must stay pending for settlement reconciliation';
 end if;
end $$;

-- Repeated request must report already_cancelled without a second stock change,
-- even when the old response is lost and same RPC is submitted again.
do $$
declare v_id uuid; v_response jsonb;
begin
 select id into v_id from ci_target_orders where kind='cancel';
 select public.cancel_unpaid_online_order(
   v_id,'Customer cancelled; checked actual UPI statement; unpaid.',true
 ) into v_response;
 if v_response->>'already_cancelled'<>'true'
   or (select count(*) from public.inventory_transactions
       where reference_order_id=v_id and transaction_type='return')<>1
   or (select stock_quantity from public.product_variants
       where id='00000000-0000-4000-8000-000000000001')<>4 then
   raise exception 'Repeated cancellation incorrectly released stock';
 end if;
end $$;

-- Even authenticated admin is denied direct cancellation audit writes.
do $$
declare v_id uuid;
begin
 select id into v_id from ci_target_orders where kind='cancel';
 begin
   update public.online_order_cancellations set reason='Tampering attempt'
   where order_id=v_id;
   raise exception 'Browser altered protected cancellation event';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

-- A second fixture order exists with one allocated item. Verify guardrails.
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
update public.orders set payment_status='paid'
where id=(select id from ci_target_orders where kind='other');
set role authenticated;
do $$
declare v_id uuid;
begin
 select id into v_id from ci_target_orders where kind='other';
 begin
   perform public.cancel_unpaid_online_order(
      v_id,'Should not release stock for paid order',true
   );
   raise exception 'Paid order cancellation unexpectedly succeeded';
 exception when check_violation then null;
 end;
end $$;
reset role;

update public.orders set payment_status='pending'
where id=(select id from ci_target_orders where kind='other');
insert into public.order_shipments(order_id)
select id from ci_target_orders where kind='other';

set role authenticated;
do $$
declare v_id uuid;
begin
 select id into v_id from ci_target_orders where kind='other';
 begin
   perform public.cancel_unpaid_online_order(
      v_id,'Should reject orders with shipment records',true
   );
   raise exception 'Shipped order unexpectedly released inventory';
 exception when check_violation then null;
 end;
end $$;
reset role;
delete from public.order_shipments where order_id=(select id from ci_target_orders where kind='other');

-- Legacy pending orders with NO source movement must not be silently restocked.
insert into public.orders(order_number,customer_id,source,status,payment_status)
select 'LEGACY-CI',id,'online','pending','pending'
from public.customers limit 1;
insert into public.order_items(
 order_id,variant_id,product_code,product_name,quantity,unit_price,line_total
)
select id,'00000000-0000-4000-8000-000000000001',
 'RG001','CI item',1,100,100
from public.orders where order_number='LEGACY-CI';
insert into public.payments(order_id,method,amount,status,transaction_reference)
select id,'upi',100,'pending','CIREF00000003'
from public.orders where order_number='LEGACY-CI';

set role authenticated;
do $$
begin
 begin
   perform public.cancel_unpaid_online_order(
      (select id from public.orders where order_number='LEGACY-CI'),
      'Untracked historical stock cannot be restored blindly',true
   );
   raise exception 'Untracked legacy order unexpectedly restored stock';
 exception when check_violation then null;
 end;
end $$;
reset role;

-- A late failure when writing status audit MUST revert every stock change.
-- Create a new pending order using the same verified Phase 3 checkout function.
select public.create_online_order(
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
 '{"name":"Third CI purchaser","whatsapp_number":"9990000008","address":"Test address","state":"Tamil Nadu","payment_method":"upi","payment_reference":"CIREF00000009"}'::jsonb,
 null
);
create or replace function public.ci_cancel_status_insert_failure()
returns trigger language plpgsql as $$
begin
 if pg_catalog.current_setting('rainbow_ci.cancel_fail',true)='yes' then
   raise exception 'CI forced status audit failure after inventory release';
 end if;
 return new;
end $$;
create trigger ci_force_cancel_status_failure
before insert on public.online_order_status_events
for each row execute function public.ci_cancel_status_insert_failure();
set rainbow_ci.cancel_fail='yes';
set role authenticated;
do $$
declare v_id uuid; stock_before integer; history_before integer;
  cancellations_before integer; status_events_before integer;
begin
 select id into v_id from public.orders where order_number not in ('LEGACY-CI')
  and id not in (select id from ci_target_orders)
  and source='online' order by created_at desc nulls last limit 1;
 -- Fixture orders have no created_at; sorting still gets the extra order.
 select stock_quantity into stock_before from public.product_variants
   where id='00000000-0000-4000-8000-000000000001';
 select count(*) into history_before from public.inventory_transactions;
 select count(*) into cancellations_before from public.online_order_cancellations;
 select count(*) into status_events_before from public.online_order_status_events;
 if v_id is null then raise exception 'No third order available'; end if;
 begin
   perform public.cancel_unpaid_online_order(
     v_id,'Forced failure after stock release must roll back',true
   );
   raise exception 'Injected late cancellation failure did not fire';
 exception when others then
   if sqlerrm='Injected late cancellation failure did not fire' then raise; end if;
   if sqlerrm not like '%CI forced status audit failure%' then raise; end if;
 end;
 if (select stock_quantity from public.product_variants
     where id='00000000-0000-4000-8000-000000000001')<>stock_before
   or (select count(*) from public.inventory_transactions)<>history_before
   or (select count(*) from public.online_order_cancellations)<>cancellations_before
   or (select count(*) from public.online_order_status_events)<>status_events_before
   or (select status from public.orders where id=v_id)<>'pending' then
   raise exception 'Failed cancellation left partial changes';
 end if;
end $$;
reset role;
reset rainbow_ci.cancel_fail;
drop trigger ci_force_cancel_status_failure on public.online_order_status_events;
drop function public.ci_cancel_status_insert_failure();

\echo 'PASS: unpaid cancellation exactly once; pending payment unchanged; roles; legacy/paid/shipment guards; atomic rollback'
