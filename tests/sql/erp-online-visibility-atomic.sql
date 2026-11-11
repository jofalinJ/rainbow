-- Isolated PostgreSQL CI ONLY. The entire scenario is rolled back.
-- Owner publication and receipt are atomic; no two-step stranded transfers.
\set ON_ERROR_STOP on
begin;

insert into public.product_images(id,product_id,is_primary,sort_order,public_url)
values (
 'a0000000-0000-4000-8000-000000000111',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 true,1,'https://example.invalid/test-stock.webp'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

-- A plain physical-stock addition never changes Online Store stock.
select public.erp_adjust_stock(
 (select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 6,'Shop stock received for online allocation',
 'a0000000-0000-4000-8000-000000000112'
);
do $$
begin
 if (select stock_quantity from public.product_variants
  where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>0 then
  raise exception 'Shop stock was incorrectly added online';
 end if;
end $$;

-- Publishing a valid draft and moving 2 units succeeds as ONE transaction.
select public.erp_allocate_online(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 (select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 2,true,'a0000000-0000-4000-8000-000000000113'
);
select public.erp_allocate_online(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 (select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 2,true,'a0000000-0000-4000-8000-000000000113'
);
do $$
declare v_branch integer; v_online integer; v_legacy integer;
begin
 select b.on_hand into v_branch from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id
 where l.code='BR-ONE' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 select b.on_hand into v_online from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id
 where l.code='ONLINE' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 select stock_quantity into v_legacy from public.product_variants
 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if v_branch<>4 or v_online<>2 or v_legacy<>2 then
  raise exception 'Online stock mismatch after allocate/retry: branch %, online %, legacy %',
   v_branch,v_online,v_legacy;
 end if;
 if (select count(*) from public.erp_transfers
  where request_id='a0000000-0000-4000-8000-000000000113'
   and status='received')<>1 then
  raise exception 'Online allocation was not received exactly once';
 end if;
 if not (select published from public.erp_online_listings
  where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then
  raise exception 'Online publication did not persist';
 end if;
end $$;

-- Reject attempted duplicate/replay of an idempotency key with new quantity.
do $$
begin
 begin
  perform public.erp_allocate_online(
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   (select id from public.erp_locations where code='BR-ONE'),
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   3,true,'a0000000-0000-4000-8000-000000000113');
  raise exception 'Reused transfer key incorrectly accepted with changed quantity';
 exception when sqlstate 'P0001' then
  if sqlerrm='Reused transfer key incorrectly accepted with changed quantity' then raise; end if;
 end;
end $$;

-- Confirm hiding sends Online Store stock back before unpublishing.
select public.erp_recall_and_hide_online(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 (select id from public.erp_locations where code='BR-ONE'),
 'a0000000-0000-4000-8000-000000000114'
);
do $$
declare v_branch integer;v_online integer;
begin
 select b.on_hand into v_branch from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id
 where l.code='BR-ONE' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 select b.on_hand into v_online from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id
 where l.code='ONLINE' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 if v_branch<>6 or v_online<>0 or
  (select stock_quantity from public.product_variants where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>0 or
  (select published from public.erp_online_listings where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 then raise exception 'Hide online did not return stock and unpublish atomically'; end if;
end $$;

-- Checkout reservations, and pending dispatches, both block hiding rather
-- than silently dropping or doubling stock.
select public.erp_allocate_online(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 (select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 1,true,'a0000000-0000-4000-8000-000000000115'
);
select public.erp_dispatch_transfer(
 (select id from public.erp_locations where code='BR-ONE'),
 (select id from public.erp_locations where code='ONLINE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 1,'Review this in transit stock first',
 'a0000000-0000-4000-8000-000000000116'
);
do $$
begin
 begin
  perform public.erp_recall_and_hide_online(
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   (select id from public.erp_locations where code='BR-ONE'),
   'a0000000-0000-4000-8000-000000000117');
  raise exception 'Hide improperly ignored pending transfer';
 exception when sqlstate 'P0001' then
  if sqlerrm='Hide improperly ignored pending transfer' then raise; end if;
 end;
end $$;

-- A cashier cannot bypass the owner-only allocation/visibility controls.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
begin
 begin
  perform public.erp_allocate_online(
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   (select id from public.erp_locations where code='BR-ONE'),
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   1,true,'a0000000-0000-4000-8000-000000000118');
  raise exception 'Non-admin was allowed to allocate online';
 exception when sqlstate '42501' then null;
 end;
end $$;

rollback;
select 'Atomic publication, stock allocation, recall, and permissions passed' as result;
