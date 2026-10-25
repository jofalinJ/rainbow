\set ON_ERROR_STOP on
begin;
-- Assign only staff A to Shop One; leave staff B unassigned.
insert into public.erp_staff_locations(user_id,location_id)
select '22222222-2222-4222-8222-222222222222',id from public.erp_locations where code='BR-ONE';
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select public.erp_adjust_stock(
 (select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',20,'Initial counted stock received',
 '44444444-4444-4444-8444-444444444444'
);
-- Retry with the same idempotency key must not double the quantity.
select public.erp_adjust_stock(
 (select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',20,'Initial counted stock received',
 '44444444-4444-4444-8444-444444444444'
);
do $$
declare total_qty integer;
begin
 select on_hand into total_qty from public.erp_stock_balances;
 if total_qty<>20 then raise exception 'Duplicate adjustment changed stock twice'; end if;
 -- Restricted staff must not mutate an unassigned shop.
 begin
  perform public.erp_adjust_stock(
   (select id from public.erp_locations where code='BR-TWO'),
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',1,'Forbidden shop adjustment',
   '55555555-5555-4555-8555-555555555555');
  raise exception 'Expected access denial';
 exception when sqlstate '42501' then null;
 end;
 -- Direct stock modifications must be denied.
 begin
  update public.erp_stock_balances set on_hand=999;
  raise exception 'Expected direct update denial';
 exception when sqlstate '42501' then null;
 end;
end $$;
reset role;
-- Verify original legacy stock source was not edited by staged branch operations.
do $$
begin
 if (select stock_quantity from public.product_variants limit 1)<>0
 then raise exception 'Staged ERP improperly changed legacy checkout stock'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
-- Admin can dispatch from Shop One to Shop Two, and destination can receive.
select public.erp_dispatch_transfer(
 (select id from public.erp_locations where code='BR-ONE'),
 (select id from public.erp_locations where code='BR-TWO'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',5,'Replenish another branch',
 '66666666-6666-4666-8666-666666666666');
select public.erp_receive_transfer(
 (select id from public.erp_transfers where request_id='66666666-6666-4666-8666-666666666666'));
select public.erp_receive_transfer(
 (select id from public.erp_transfers where request_id='66666666-6666-4666-8666-666666666666'));
-- Online stock can be allocated without making extra copies.
select public.erp_dispatch_transfer(
 (select id from public.erp_locations where code='BR-ONE'),
 (select id from public.erp_locations where code='ONLINE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',4,'Allocate to online channel',
 '77777777-7777-4777-8777-777777777777');
select public.erp_receive_transfer(
 (select id from public.erp_transfers where request_id='77777777-7777-4777-8777-777777777777'));
insert into public.erp_online_listings(product_id,published,updated_by)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',true,
'11111111-1111-4111-8111-111111111111');
select public.erp_dashboard_snapshot();
-- Supplier purchase must have a line before submission.
insert into public.erp_suppliers(id,name) values('88888888-8888-4888-8888-888888888888','Supplier One');
insert into public.erp_purchase_orders(id,supplier_id,destination_id,status)
select '99999999-9999-4999-8999-999999999999',
'88888888-8888-4888-8888-888888888888',id,'draft' from public.erp_locations where code='BR-ONE';
insert into public.erp_purchase_lines(id,purchase_id,variant_id,ordered_qty,unit_cost)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
'99999999-9999-4999-8999-999999999999',
'dddddddd-dddd-4ddd-8ddd-dddddddddddd',12,22.00);
select public.erp_submit_purchase('99999999-9999-4999-8999-999999999999');
select public.erp_receive_purchase('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',12,
'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11');
reset role;
-- Final balance: 20 original + 12 supplier = 32 across branches and online.
do $$
declare qty integer;
begin
 select sum(on_hand) into qty from public.erp_stock_balances;
 if qty<>32 then raise exception 'Incorrect company stock total: %',qty; end if;
 if (select count(*) from public.erp_stock_events where action='transfer_in')<>2
 then raise exception 'Transfer receipt duplicated'; end if;
end $$;
set local role service_role;
select public.erp_reserve_online('cccccccc-cccc-4ccc-8ccc-cccccccccc11',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',2,now()+interval '30 minutes');
select public.erp_reserve_online('cccccccc-cccc-4ccc-8ccc-cccccccccc11',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',2,now()+interval '30 minutes');
select public.erp_settle_online('cccccccc-cccc-4ccc-8ccc-cccccccccc11',true);
select public.erp_settle_online('cccccccc-cccc-4ccc-8ccc-cccccccccc11',true);
reset role;
do $$
declare qty integer; reserved_qty integer;
begin
 select sum(on_hand),sum(reserved) into qty,reserved_qty from public.erp_stock_balances;
 if qty<>30 or reserved_qty<>0 then raise exception 'Online settlement counted stock incorrectly'; end if;
 if (select count(*) from public.erp_stock_events where action='online_sale')<>1
 then raise exception 'Online payment retry duplicated sale'; end if;
end $$;
rollback;
