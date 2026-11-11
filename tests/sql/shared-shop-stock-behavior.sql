-- Shared stock tests on disposable PostgreSQL; no live money/stock.
\set ON_ERROR_STOP on
begin;
do $$
declare v int;
begin
 if not app_private.erp_shared_branch_stock() then raise exception 'Shared flag is not activated';end if;
 select stock_quantity into v from public.product_variants
 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if v<>7 then raise exception 'Physical shop quantity did not appear as shared web availability: %',v;end if;
 if exists(select 1 from public.erp_stock_balances b
           join public.erp_locations l on l.id=b.location_id
           where l.kind='online' and (b.on_hand<>0 or b.reserved<>0))
 then raise exception 'Shared setup unexpectedly created separate online stock';end if;
end $$;
-- Simulate the already server-gated variant stock reservation from checkout.
select set_config('request.jwt.claim.role','service_role',true);
update public.product_variants set stock_quantity=stock_quantity-3
 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
declare avail integer; held integer; on_hand integer;
begin
 select b.on_hand,b.reserved,b.on_hand-b.reserved into on_hand,held,avail
 from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id
 where l.code='BR-ONE' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if on_hand<>7 or held<>3 or avail<>4 then
  raise exception 'Checkout hold did not reserve physical stock (%,%,%)',on_hand,held,avail;
 end if;
end $$;
-- More than the unreserved stock must fail.
do $$
begin
 begin
  update public.product_variants set stock_quantity=stock_quantity-5
  where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  raise exception 'Checkout oversold shared physical stock';
 exception when check_violation then null;
 when raise_exception then
  if SQLERRM='Checkout oversold shared physical stock' then raise; end if;
 end;
end $$;
-- A walk-in sale may only use pieces not held by an online checkout.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
begin
 begin
  perform public.erp_create_local_sale(
   '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":5}]'::jsonb,
   '{"name":"Test POS Buyer"}'::jsonb,'cash',
   (select id from public.erp_locations where code='BR-ONE'),
   '72000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  raise exception 'POS incorrectly oversold held items';
 exception when raise_exception then
  if SQLERRM='POS incorrectly oversold held items' then raise; end if;
 end;
end $$;
select public.erp_create_local_sale(
 '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":2}]'::jsonb,
 '{"name":"Test POS Buyer"}'::jsonb,'cash',
 (select id from public.erp_locations where code='BR-ONE'),
 '73000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
reset role;
do $$
declare v integer;
begin
 select stock_quantity into v from public.product_variants where barcode='JM001-RED';
 if v<>2 then raise exception 'Physical POS sale did not reduce online-available shared quantity: %',v; end if;
end $$;
-- Expiring a hold returns exactly its quantity to both channels.
update public.product_variants set stock_quantity=stock_quantity+1
 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $$
begin
 if (select stock_quantity from public.product_variants where barcode='JM001-RED')<>3
 then raise exception 'Checkout expiry did not restore available shop pieces'; end if;
end $$;
-- Re-reserve it; now three pieces are held for this synthetic order.
update public.product_variants set stock_quantity=stock_quantity-1
 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
insert into public.customers(id,name)
values('74000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Shared Stock Buyer');
insert into public.orders(id,order_number,customer_id,source,status,payment_status,
 subtotal,discount_amount,cgst_amount,sgst_amount,delivery_fee,total_amount)
values('75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SHARED-TEST-1',
'74000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','online','pending','pending',
150,4.5,2.18,2.18,0,149.86);
insert into public.order_items(order_id,variant_id,product_code,product_name,quantity,unit_price,line_total)
values('75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
'dddddddd-dddd-4ddd-8ddd-dddddddddddd','JM001','Jimmiki Earrings',3,50,150);
insert into public.razorpay_checkouts(checkout_id,order_id,status)
values('76000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
'75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','paid');
update public.orders set payment_status='paid'
where id='75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.orders set notes='duplicate webhook no second sale'
where id='75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $
declare v_balance record;
begin
 select bal.on_hand,bal.reserved into v_balance
 from public.erp_stock_balances bal join public.erp_locations l on l.id=bal.location_id
 where l.code='BR-ONE' and bal.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if v_balance.on_hand<>2 or v_balance.reserved<>0 then
 raise exception 'Verified payment must consume physical pieces once (%,%)',v_balance.on_hand,v_balance.reserved;end if;
 if (select stock_quantity from public.product_variants where barcode='JM001-RED')<>2 then
 raise exception 'Shared stock mirror changed incorrectly on payment';end if;
 if (select count(*) from public.erp_stock_events where idempotency_key='75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>1 then
 raise exception 'Payment stock event not exactly-once';end if;
end $$;
-- Direct staff editing the checkout availability field is rejected.
select set_config('request.jwt.claim.role','authenticated',true);
do $$
begin
 begin
  update public.product_variants set stock_quantity=1
   where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  raise exception 'Direct staff stock edit bypassed checkout';
 exception when insufficient_privilege then null;
 when raise_exception then
  if SQLERRM='Direct staff stock edit bypassed checkout' then raise; end if;
 end;
end $$;
rollback;
