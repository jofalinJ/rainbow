\set ON_ERROR_STOP on
-- CI ONLY. Build a disposable Supabase-like schema and a paid sale.
\ir online_order_cancellation.sql
\ir ../../supabase/migrations/20261017232000_customer_returns_and_refund_evidence.sql

-- Create local paid test sale, separate from pending/cancelled fixtures.
insert into public.orders(order_number,source,status,payment_status,total_amount)
values ('RETURN-CI-001','local_store','confirmed','paid',400.00);
insert into public.order_items(order_id,variant_id,product_code,product_name,
 quantity,unit_price,line_total)
select id,'00000000-0000-4000-8000-000000000001','RG001','CI test',4,100,400
from public.orders where order_number='RETURN-CI-001';
insert into public.payments(order_id,method,amount,status,paid_at)
select id,'cash',400,'paid',now()
from public.orders where order_number='RETURN-CI-001';

-- Authenticated admin should be able to read fixture rows through SELECT.
grant select on public.orders,public.order_items,public.payments,
 public.customer_returns,public.customer_return_lines,
 public.customer_refund_confirmations to authenticated;
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000002';
set role authenticated;
do $$
declare o uuid;item uuid;
begin
 select id into o from public.orders where order_number='RETURN-CI-001';
 select id into item from public.order_items where order_id=o;
 begin
  perform public.receive_customer_return(
    '50000000-0000-4000-8000-000000000001',o,
    jsonb_build_array(jsonb_build_object('order_item_id',item,'quantity',1,'restockable',true)),
    'Cashier may not restock customer returns',100);
  raise exception 'Cashier received refund-return';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Return one inspected sellable unit, request ₹100 refund, no money sent.
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare o uuid;item uuid;starting_stock integer;resp jsonb;
begin
 select id into o from public.orders where order_number='RETURN-CI-001';
 select id into item from public.order_items where order_id=o;
 select stock_quantity into starting_stock from public.product_variants
  where id='00000000-0000-4000-8000-000000000001';
 select public.receive_customer_return(
    '50000000-0000-4000-8000-000000000001',o,
    jsonb_build_array(jsonb_build_object('order_item_id',item,'quantity',1,'restockable',true)),
    'Customer returned inspected unopened earrings',100) into resp;
 if resp->>'replayed'<>'false'
 or (select stock_quantity from public.product_variants
    where id='00000000-0000-4000-8000-000000000001')<>starting_stock+1 then
  raise exception 'Return restocking failed';
 end if;
 if not exists(select 1 from public.inventory_transactions t
    where t.reference_customer_return_line_id is not null
      and t.reference_order_id=o and t.transaction_type='return'
      and t.quantity=1 and t.quantity_delta=1
      and t.stock_after-t.stock_before=1) then
  raise exception 'Return lacked source-linked inventory ledger';
 end if;
 select public.receive_customer_return(
    '50000000-0000-4000-8000-000000000001',o,
    jsonb_build_array(jsonb_build_object('order_item_id',item,'quantity',1,'restockable',true)),
    'Customer returned inspected unopened earrings',100) into resp;
 if resp->>'replayed'<>'true'
 or (select stock_quantity from public.product_variants
    where id='00000000-0000-4000-8000-000000000001')<>starting_stock+1 then
  raise exception 'Duplicate return restocked twice';
 end if;
 begin
  perform public.receive_customer_return(
    '50000000-0000-4000-8000-000000000001',o,
    jsonb_build_array(jsonb_build_object('order_item_id',item,'quantity',2,'restockable',true)),
    'Customer returned inspected unopened earrings',200);
  raise exception 'Changed return payload accepted';
 exception when invalid_parameter_value then null;end;
end $$;

-- Damaged/nonrestockable return creates a line but no stock movement.
do $$
declare o uuid;item uuid;starting_stock integer;before_moves integer;
begin
 select id into o from public.orders where order_number='RETURN-CI-001';
 select id into item from public.order_items where order_id=o;
 select stock_quantity into starting_stock from public.product_variants
  where id='00000000-0000-4000-8000-000000000001';
 select count(*) into before_moves from public.inventory_transactions
  where reference_customer_return_line_id is not null;
 perform public.receive_customer_return(
    '50000000-0000-4000-8000-000000000002',o,
    jsonb_build_array(jsonb_build_object('order_item_id',item,'quantity',2,'restockable',false)),
    'Damaged jewellery cannot go back on sale',150);
 if (select stock_quantity from public.product_variants
    where id='00000000-0000-4000-8000-000000000001')<>starting_stock
 or (select count(*) from public.inventory_transactions
   where reference_customer_return_line_id is not null)<>before_moves then
  raise exception 'Damaged return unexpectedly changed sellable inventory';
 end if;
 begin
  perform public.receive_customer_return(
    '50000000-0000-4000-8000-000000000003',o,
    jsonb_build_array(jsonb_build_object('order_item_id',item,'quantity',2,'restockable',true)),
    'These quantities were already returned',100);
  raise exception 'Excess return accepted';
 exception when check_violation then null;end;
end $$;

-- No financial transfer happened yet. Refund evidence is admin-recorded only.
do $$
declare r jsonb;
begin
 if (select count(*) from public.customer_refund_confirmations)<>0 then
  raise exception 'Creating a return falsely posted a refund';
 end if;
 begin
  perform public.confirm_customer_refund(
    '50000000-0000-4000-8000-000000000001','upi','CI-REFUND-001',false);
  raise exception 'Refund attestation skipped';
 exception when invalid_parameter_value then null;end;
 select public.confirm_customer_refund(
   '50000000-0000-4000-8000-000000000001','upi','CI-REFUND-001',true) into r;
 if r->>'replayed'<>'false' then raise exception 'First refund evidence not recorded';end if;
 select public.confirm_customer_refund(
   '50000000-0000-4000-8000-000000000001','upi','CI-REFUND-001',true) into r;
 if r->>'replayed'<>'true'
  or (select count(*) from public.customer_refund_confirmations)<>1 then
  raise exception 'Refund evidence retry duplicated confirmation';
 end if;
 begin
  perform public.confirm_customer_refund(
    '50000000-0000-4000-8000-000000000002','upi','CI-REFUND-001',true);
  raise exception 'Duplicate provider reference accepted';
 exception when unique_violation then null;end;
end $$;
reset role;

-- A late ledger failure must rollback new return + stock change atomically.
create function public.ci_fail_customer_return_ledger()
returns trigger language plpgsql as $$
begin
 if new.reference_customer_return_line_id is not null then
  raise exception 'CI forced return ledger failure';
 end if;
 return new;
end $$;
create trigger ci_fail_return_ledger
 before insert on public.inventory_transactions
 for each row execute function public.ci_fail_customer_return_ledger();

set role authenticated;
do $$
declare o uuid;item uuid;stock_before integer;returns_before integer;
begin
 select id into o from public.orders where order_number='RETURN-CI-001';
 select id into item from public.order_items where order_id=o;
 select stock_quantity into stock_before from public.product_variants
  where id='00000000-0000-4000-8000-000000000001';
 select count(*) into returns_before from public.customer_returns;
 begin
  perform public.receive_customer_return(
    '50000000-0000-4000-8000-000000000004',o,
    jsonb_build_array(jsonb_build_object('order_item_id',item,'quantity',1,'restockable',true)),
    'Return database failure simulation case',100);
  raise exception 'Late stock return failure did not trigger';
 exception when others then
  if sqlerrm='Late stock return failure did not trigger' then raise;end if;
  if sqlerrm not like '%CI forced return ledger failure%' then raise;end if;
 end;
 if (select stock_quantity from public.product_variants
     where id='00000000-0000-4000-8000-000000000001')<>stock_before
  or (select count(*) from public.customer_returns)<>returns_before then
  raise exception 'Late return failure left partial stock/financial writes';
 end if;
end $$;
reset role;
drop trigger ci_fail_return_ledger on public.inventory_transactions;
drop function public.ci_fail_customer_return_ledger();

-- Replay migration: schema remains valid and stock unchanged.
\ir ../../supabase/migrations/20261017232000_customer_returns_and_refund_evidence.sql
do $$
begin
 if (select count(*) from public.customer_returns)<>2 or
    (select count(*) from public.customer_refund_confirmations)<>1 then
  raise exception 'Migration replay altered completed return data';
 end if;
end $$;
\echo 'PASS: paid returns, partial/damaged returns, refund evidence, role controls, retry and rollback'
