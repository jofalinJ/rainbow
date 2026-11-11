-- Real checkout RPCs and fictional orders in disposable PostgreSQL.
\set ON_ERROR_STOP on
begin;
\set variant 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
\set customer '{"name":"Synthetic Test","whatsapp_number":"9000000001","address":"Synthetic QA Lane","state":"Tamil Nadu","pin_code":"629001"}'
\set admin '11111111-1111-4111-8111-111111111111'
\set cashier '22222222-2222-4222-8222-222222222222'

do $$
begin
 if not app_private.erp_shared_branch_stock() or
 (select stock_quantity from public.product_variants where barcode='JM001-RED')<>7
 then raise exception 'Physical opening stock was not published'; end if;
 if has_table_privilege('authenticated','app_private.erp_shared_order_reservations','select') or
 has_table_privilege('anon','app_private.erp_shared_order_reservations','select') or
 has_function_privilege('authenticated','app_private.erp_settle_shared_order_stock(uuid,boolean)','execute') or
 has_function_privilege('anon','public.create_razorpay_checkout(uuid,jsonb,jsonb)','execute')
 then raise exception 'Private checkout inventory is exposed'; end if;
end $$;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select public.create_razorpay_checkout(
 '75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 jsonb_build_array(jsonb_build_object('variant_id',:'variant','quantity',3)),:'customer'
) as first_checkout \gset
select public.attach_razorpay_order(
 '75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','order_sharedqa1',(:'first_checkout'::jsonb->>'amount_paise')::bigint);
reset role;

do $$
declare balance record;
begin
 select b.on_hand,b.reserved into strict balance from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id where l.code='BR-ONE';
 if (balance.on_hand,balance.reserved)<>(7,3) or
 (select stock_quantity from public.product_variants where barcode='JM001-RED')<>4
 then raise exception 'Checkout failed to reserve 3 of 7 physical pieces'; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
select set_config('request.jwt.claim.sub',:'cashier',true);
do $$
begin
 begin
  perform public.erp_create_local_sale(
   '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":5}]',
   '{"name":"Synthetic POS Customer"}','cash',
   (select id from public.erp_locations where code='BR-ONE'),
   '72000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  raise exception 'Expected insufficient POS stock';
 exception when raise_exception then
  if sqlerrm not like 'Insufficient stock for %' then raise; end if;
 end;
end $$;
select public.erp_create_local_sale(
 jsonb_build_array(jsonb_build_object('variant_id',:'variant','quantity',2)),
 '{"name":"Synthetic POS Customer"}','cash',
 (select id from public.erp_locations where code='BR-ONE'),
 '73000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select public.complete_razorpay_checkout(
 'order_sharedqa1','pay_sharedqa1',(:'first_checkout'::jsonb->>'amount_paise')::bigint,'evt_sharedqa1');
select public.complete_razorpay_checkout(
 'order_sharedqa1','pay_sharedqa1',(:'first_checkout'::jsonb->>'amount_paise')::bigint,'evt_sharedqa1');
reset role;

do $$
declare balance record; order_id uuid;
begin
 select b.on_hand,b.reserved into strict balance from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id where l.code='BR-ONE';
 select rc.order_id into strict order_id from public.razorpay_checkouts rc
 where checkout_id='75000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if (balance.on_hand,balance.reserved)<>(2,0) or
 (select stock_quantity from public.product_variants where barcode='JM001-RED')<>2 or
 (select count(*) from public.erp_stock_events where idempotency_key=order_id)<>1
 then raise exception 'Paid order did not settle exactly once'; end if;
 begin
  update public.product_variants set stock_quantity=1 where barcode='JM001-RED';
  raise exception 'Expected direct stock edit to be refused';
 exception when insufficient_privilege then null;
 end;
end $$;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
select set_config('request.jwt.claim.sub',:'admin',true);
select public.erp_adjust_stock(
 (select id from public.erp_locations where code='BR-TWO'),:'variant',5,
 'Add synthetic stock to second branch','73500000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$
begin
 begin
  perform public.erp_dispatch_transfer(
   (select id from public.erp_locations where code='BR-TWO'),
   (select id from public.erp_locations where code='ONLINE'),
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',2,
   'Synthetic dispatch check','73700000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  raise exception 'Expected Online Store transfer to be refused';
 exception when raise_exception then
  if sqlerrm <> 'Shared inventory transfers must be between physical shops' then raise; end if;
 end;
end $$;
update public.erp_online_listings set published=false where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
begin
 if exists(select 1 from jsonb_array_elements(public.erp_public_catalogue()->'items') v
           where v->>'variant_id'='dddddddd-dddd-4ddd-8ddd-dddddddddddd') then
  raise exception 'Hidden product still appears in the online catalogue';
 end if;
 begin
  perform public.create_razorpay_checkout(
   '75100000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":1}]',
   '{"name":"Synthetic Test","whatsapp_number":"9000000001","address":"Synthetic QA Lane","state":"Tamil Nadu"}');
  raise exception 'Expected hidden product to be unavailable for checkout';
 exception when raise_exception then
  if sqlerrm <> 'This product is not published online' then raise; end if;
 end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
update public.erp_online_listings set published=true,online_price=75 where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$
declare summary jsonb:=public.erp_location_summary();
begin
 if (summary->>'company_on_hand')::integer<>7 or (summary->>'company_reserved')::integer<>0
 then raise exception 'Show Online or rejected transfer changed physical stock'; end if;
end $$;
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
begin
 if not exists(select 1 from jsonb_array_elements(public.erp_public_catalogue()->'items') v
   where v->>'variant_id'='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
   and (v->>'available')::integer=7 and (v->>'price')::numeric=100)
 then raise exception 'Catalogue availability or checkout price differed'; end if;
end $$;
select public.create_razorpay_checkout(
 '75200000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 jsonb_build_array(jsonb_build_object('variant_id',:'variant','quantity',6)),:'customer'
) as split_checkout \gset
select public.create_razorpay_checkout(
 '75300000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 jsonb_build_array(jsonb_build_object('variant_id',:'variant','quantity',1)),:'customer'
) as second_checkout \gset
select public.attach_razorpay_order(
 '75300000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','order_sharedqa3',(:'second_checkout'::jsonb->>'amount_paise')::bigint);
reset role;

do $$
declare v_splits integer;
begin
 select count(*) into v_splits from app_private.erp_shared_order_reservations h
 join public.razorpay_checkouts rc on rc.order_id=h.order_id
 where rc.checkout_id='75200000-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and h.state='reserved';
 if v_splits<>2 then raise exception 'Six-piece order should span two shops'; end if;
 if (select stock_quantity from public.product_variants where barcode='JM001-RED')<>0
 then raise exception 'All seven pieces should be held'; end if;
end $$;

update public.razorpay_checkouts set expires_at=now()-interval '36 minutes'
where checkout_id='75200000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
do $$
begin
 if public.expire_razorpay_checkouts()<>1 or public.expire_razorpay_checkouts()<>0 then
  raise exception 'Expiry did not release the due order exactly once';
 end if;
end $$;
reset role;

do $$
begin
 if (select stock_quantity from public.product_variants where barcode='JM001-RED')<>6
 or exists(
  select 1 from public.erp_stock_balances b
  where b.reserved is distinct from (
   select coalesce(sum(h.quantity),0)::integer
   from app_private.erp_shared_order_reservations h
   join public.razorpay_checkouts rc on rc.order_id=h.order_id
   where h.location_id=b.location_id and h.variant_id=b.variant_id
   and h.state='reserved' and rc.checkout_id='75300000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
 ) then raise exception 'Expiry released stock held by the other order'; end if;
end $$;

set local role service_role;
select public.complete_razorpay_checkout(
 'order_sharedqa3','pay_sharedqa3',(:'second_checkout'::jsonb->>'amount_paise')::bigint,'evt_sharedqa3');
reset role;
do $$
begin
 if (select sum(on_hand) from public.erp_stock_balances)<>6 or
 (select sum(reserved) from public.erp_stock_balances)<>0 or
 (select stock_quantity from public.product_variants where barcode='JM001-RED')<>6 or
 exists(select 1 from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id
        where l.kind='online' and (b.on_hand<>0 or b.reserved<>0))
 then raise exception 'Final shared inventory balances, mirror or holds diverged'; end if;
 if not exists(
  select 1 from app_private.erp_shared_order_reservations h
  join public.razorpay_checkouts rc on rc.order_id=h.order_id
  join public.erp_stock_events e on e.idempotency_key=h.order_id and e.location_id=h.location_id
   and e.variant_id=h.variant_id and e.quantity_delta=-h.quantity
  where rc.checkout_id='75300000-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and h.state='paid'
 ) then raise exception 'Paid order debited the wrong branch'; end if;
end $$;
rollback;
