-- Realistic but completely synthetic stock in disposable CI Postgres.
\set ON_ERROR_STOP on
begin;
insert into public.product_images(id,product_id,is_primary,sort_order,public_url)
values('70000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
       true,0,'https://example.invalid/shared-sample.webp')
on conflict(id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.erp_adjust_stock(
  (select id from public.erp_locations where code='BR-ONE'),
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  7,'Synthetic existing physical shop stock',
  '71000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.erp_online_listings(product_id,published,updated_by)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',true,
       '11111111-1111-4111-8111-111111111111');
commit;
