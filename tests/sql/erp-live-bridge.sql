\set ON_ERROR_STOP on
begin;
-- Existing legacy catalogue starts EMPTY and the new bridge is initially OFF.
do $$
begin
 if (select enabled from app_private.erp_activation_state where singleton)
 then raise exception 'Activation must default off'; end if;
end $$;
update app_private.erp_activation_state set enabled=true,activated_at=now() where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
-- Admin receives 12 units of a shared variant into physical Shop One.
select public.erp_adjust_stock(
 (select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',12,'Shop One opening counted stock',
 '10000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$
begin
 if (select stock_quantity from public.product_variants
     where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>0
 then raise exception 'Physical branch receiving wrongly published online stock'; end if;
end $$;
-- Product publication alone does not duplicate inventory.
insert into public.erp_online_listings(product_id,published,updated_by)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',true,
'11111111-1111-4111-8111-111111111111');
select public.erp_dispatch_transfer(
 (select id from public.erp_locations where code='BR-ONE'),
 (select id from public.erp_locations where code='ONLINE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',5,'Move allocated items online',
 '20000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.erp_receive_transfer(
 (select id from public.erp_transfers where request_id='20000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
reset role;
do $$
begin
 if (select stock_quantity from public.product_variants where barcode='JM001-RED')<>5
 then raise exception 'Online allocation should expose exactly 5 units';end if;
end $$;
-- Simulate the existing Razorpay/UPI reservation algorithm, no real payment.
update public.product_variants set stock_quantity=stock_quantity-2
where barcode='JM001-RED';
do $$
declare b record;
begin
 select b.on_hand,b.reserved into b from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id
 where l.kind='online' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if b.on_hand<>5 or b.reserved<>2 then
 raise exception 'Online reserve must retain 5 physical and hold 2';end if;
end $$;
-- Captured money would require an independently paid checkout row.
insert into public.customers(id,name) values
 ('30000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Example Customer');
insert into public.orders(id,order_number,customer_id,source,status,payment_status,
 subtotal,discount_amount,cgst_amount,sgst_amount,delivery_fee,total_amount)
values('40000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','RG-TEST-1',
'30000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','online','pending','pending',
100,3,1.46,1.46,0,99.92);
insert into public.order_items(order_id,variant_id,product_code,product_name,quantity,unit_price,line_total)
values('40000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd','JM001','Jimmiki Earrings',2,50,100);
insert into public.razorpay_checkouts(checkout_id,order_id,status)
values('50000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
'40000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','paid');
update public.orders set payment_status='paid'
where id='40000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
-- Repeat changing another order property: must not settle same stock again.
update public.orders set notes='duplicate provider notification'
where id='40000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare b record;
begin
 select b.on_hand,b.reserved into b from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id
 where l.kind='online' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if b.on_hand<>3 or b.reserved<>0 then
 raise exception 'Payment must consume exactly two online units once';end if;
 if (select stock_quantity from public.product_variants where barcode='JM001-RED')<>3
 then raise exception 'Legacy online availability diverged after payment';end if;
 if (select count(*) from public.erp_stock_events
 where idempotency_key='40000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>1 then
 raise exception 'Duplicate paid ledger entry';end if;
end $$;
-- Expired checkout: reserve then release, physical stock does not change.
update public.product_variants set stock_quantity=stock_quantity-1 where barcode='JM001-RED';
update public.product_variants set stock_quantity=stock_quantity+1 where barcode='JM001-RED';
do $$
declare reserved_qty int;
begin
 select b.reserved into reserved_qty from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id where l.kind='online'
 and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if reserved_qty<>0 then raise exception 'Expired checkout hold leaked';end if;
end $$;
-- Staff at Shop One can bill from branch's own stock without changing online.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select public.erp_create_local_sale(
 '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":2}]'::jsonb,
 '{"name":"Walk-in Shopper","whatsapp_number":"9999999999"}'::jsonb,
 'cash',(select id from public.erp_locations where code='BR-ONE'),
 '60000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.erp_create_local_sale(
 '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":2}]'::jsonb,
 '{"name":"Walk-in Shopper","whatsapp_number":"9999999999"}'::jsonb,
 'cash',(select id from public.erp_locations where code='BR-ONE'),
 '60000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
reset role;
do $$
declare shop_qty integer;
begin
 select b.on_hand into shop_qty from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id
 where l.code='BR-ONE' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if shop_qty<>5 then raise exception 'POS sale did not correctly deduct branch stock'; end if;
 if (select stock_quantity from public.product_variants where barcode='JM001-RED')<>3
 then raise exception 'Branch POS changed online sellable stock';end if;
 if (select count(*) from public.erp_pos_requests)<>1 then raise exception 'POS retry duplicated sale'; end if;
 if (select count(*) from public.invoices)<>1 then raise exception 'POS retry duplicated invoice'; end if;
end $$;
rollback;
