\set ON_ERROR_STOP on
-- Disposable ERP PostgreSQL fixture only. Never run against production.
begin;
create or replace function public.is_cashier() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.staff_profiles
    where user_id=(select auth.uid()) and active and role='cashier')
$$;
revoke all on function public.is_cashier() from public,anon,authenticated;
grant execute on function public.is_cashier() to authenticated;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
grant select,insert,update,delete on public.orders,public.order_items,public.payments to authenticated;
-- Reproduce the permissive policies found in the live database.
create policy "cashier read orders" on public.orders for select to authenticated
  using ((select public.is_cashier()));
create policy "Online orders insert through checked RPCs" on public.orders
  for insert to authenticated with check (source::text <> 'online');
create policy "Online orders update through checked RPCs" on public.orders
  for update to authenticated using (source::text <> 'online')
  with check (source::text <> 'online');
create policy "Online orders delete through checked RPCs" on public.orders
  for delete to authenticated using (source::text <> 'online');
create policy "Online items insert through checked RPCs" on public.order_items
  for insert to authenticated with check (
    exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'));
create policy "Online items update through checked RPCs" on public.order_items
  for update to authenticated using (
    exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'))
  with check (exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'));
create policy "Online items delete through checked RPCs" on public.order_items
  for delete to authenticated using (
    exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'));
create policy "Online payments insert through checked RPCs" on public.payments
  for insert to authenticated with check (
    exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'));
create policy "Online payments update through checked RPCs" on public.payments
  for update to authenticated using (
    exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'))
  with check (exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'));
create policy "Online payments delete through checked RPCs" on public.payments
  for delete to authenticated using (
    exists(select 1 from public.orders o where o.id=order_id and o.source::text <> 'online'));

insert into public.customers(id,name,whatsapp_number)
values('aaaaaaaa-1111-4111-8111-111111111111','Security fixture','9999999999');
insert into public.orders(id,order_number,customer_id,source,status,payment_status,
 subtotal,discount_amount,cgst_amount,sgst_amount,total_amount)
values('bbbbbbbb-1111-4111-8111-111111111111','SECURITY-LOCAL-1',
 'aaaaaaaa-1111-4111-8111-111111111111','local','confirmed','paid',100,0,0,0,100);
\i supabase/migrations/20261111223000_restrict_local_billing_rls.sql

-- Simulate a signed-in storefront customer with no staff profile.
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
do $$
declare n integer;
begin
  begin
    insert into public.orders(order_number,customer_id,source,status,payment_status,
      subtotal,discount_amount,cgst_amount,sgst_amount,total_amount)
    values('FORGED-LOCAL','aaaaaaaa-1111-4111-8111-111111111111','local',
      'confirmed','paid',100,0,0,0,100);
    raise exception 'A storefront customer created a local order';
  exception when sqlstate '42501' then null;
  end;
  begin
    insert into public.order_items(order_id,variant_id,product_code,product_name,
      quantity,unit_price,line_total)
    values('bbbbbbbb-1111-4111-8111-111111111111',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','SEC','Forged item',1,999,999);
    raise exception 'A storefront customer inserted local order items';
  exception when sqlstate '42501' then null;
  end;
  begin
    insert into public.payments(order_id,method,amount,status)
    values('bbbbbbbb-1111-4111-8111-111111111111','cash',999,'paid');
    raise exception 'A storefront customer inserted a fake paid local payment';
  exception when sqlstate '42501' then null;
  end;
  update public.orders set total_amount=999
    where id='bbbbbbbb-1111-4111-8111-111111111111';
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Customer updated a local order'; end if;
  delete from public.orders where id='bbbbbbbb-1111-4111-8111-111111111111';
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Customer deleted a local order'; end if;
end $$;
-- Active cashier retains legitimate direct local-store write compatibility.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
insert into public.orders(order_number,customer_id,source,status,payment_status,
 subtotal,discount_amount,cgst_amount,sgst_amount,total_amount)
values('CASHIER-LOCAL','aaaaaaaa-1111-4111-8111-111111111111',
 'local','confirmed','paid',100,0,0,0,100);
insert into public.order_items(order_id,variant_id,product_code,product_name,
 quantity,unit_price,line_total)
select id,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','SEC','Authorized item',1,100,100
from public.orders where order_number='CASHIER-LOCAL';
insert into public.payments(order_id,method,amount,status)
select id,'cash',100,'paid' from public.orders where order_number='CASHIER-LOCAL';
do $$
begin
  if (select count(*) from public.orders where order_number='CASHIER-LOCAL')<>1
    then raise exception 'Cashier local sale blocked'; end if;
  begin
    insert into public.orders(order_number,customer_id,source,status,payment_status,
      subtotal,discount_amount,cgst_amount,sgst_amount,total_amount)
    values('FORGED-ONLINE','aaaaaaaa-1111-4111-8111-111111111111',
      'online','confirmed','paid',100,0,0,0,100);
    raise exception 'Cashier inserted an online order directly';
  exception when sqlstate '42501' then null;
  end;
end $$;
reset role;
rollback;
