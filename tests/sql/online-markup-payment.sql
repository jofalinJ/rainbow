-- Disposable payment database only: run after interstate GST behavior checks.
\set ON_ERROR_STOP on
do $$
declare
 v_shop numeric; v_online numeric; v_order record; v_line record; v_result jsonb;
 v_same jsonb; v_blocked boolean;
begin
 -- Prior migration tests consumed stock; reset only this disposable fixture.
 update public.product_variants set stock_quantity=20
 where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'::uuid;
 select selling_price into v_shop from public.products
 where product_code='TEST001';
 select online_price into v_online from public.erp_online_listings
 where product_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid;
 if v_shop<>100 or v_online<>102.50 then
  raise exception 'Online markup changed physical price or was not seeded: %, %',v_shop,v_online;
 end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 select public.create_razorpay_checkout(
  '66666666-6666-4666-8666-666666666666'::uuid,
  '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
  '{"name":"Online markup customer","whatsapp_number":"9999999999","state":"Tamil Nadu","address":"Synthetic checkout"}'::jsonb
 ) into v_result;
 select o.subtotal,o.total_amount,rc.amount_paise into v_order
 from public.razorpay_checkouts rc join public.orders o on o.id=rc.order_id
 where rc.checkout_id='66666666-6666-4666-8666-666666666666'::uuid;
 select oi.unit_price,oi.line_total into v_line
 from public.razorpay_checkouts rc join public.order_items oi on oi.order_id=rc.order_id
 where rc.checkout_id='66666666-6666-4666-8666-666666666666'::uuid;
 if v_order.subtotal<>102.50 or v_line.unit_price<>102.50 or v_line.line_total<>102.50 or
    v_order.amount_paise<>v_order.total_amount*100 then
  raise exception 'Razorpay amount and line price disagree with published online price';
 end if;
 select public.create_razorpay_checkout(
  '66666666-6666-4666-8666-666666666666'::uuid,'[]'::jsonb,'{}'::jsonb
 ) into v_same;
 if v_same->>'state'<>'creating' or v_same->>'amount_paise'<>v_order.amount_paise::text then
  raise exception 'Razorpay retry changed existing order or amount';
 end if;
 -- The legacy/manual UPI function must use the same online price even though
 -- the public checkout currently offers Razorpay only.
 perform set_config('request.jwt.claim.role','anon',true);
 select public.create_online_order(
  '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
  '{"name":"Manual test","whatsapp_number":"9999999999","address":"Synthetic checkout","state":"Kerala","payment_method":"upi","payment_reference":"MARKUPTEST112233","checkout_id":"77777777-7777-4777-8777-777777777777"}'::jsonb
 ) into v_result;
 if (v_result->>'subtotal')::numeric<>102.50 or
    (select unit_price from public.order_items where order_id=(v_result->>'order_id')::uuid limit 1)<>102.50
 then raise exception 'Manual payment did not use online price'; end if;
 update public.erp_online_listings set published=false
 where product_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid;
 v_blocked:=false;
 perform set_config('request.jwt.claim.role','service_role',true);
 begin
  perform public.create_razorpay_checkout(
   '88888888-8888-4888-8888-888888888888'::uuid,
   '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
   '{"name":"Blocked customer","whatsapp_number":"9999999999","state":"Tamil Nadu","address":"Synthetic"}'::jsonb);
 exception when others then v_blocked:=true;
 end;
 if not v_blocked then raise exception 'Hidden product allowed online checkout'; end if;
 update public.erp_online_listings set published=true
 where product_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid;
 update public.products set selling_price=99.99 where product_code='TEST001';
 select online_price into v_online from public.erp_online_listings
 where product_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid;
 if v_online<>102.49 then raise exception 'Shop-price edit did not refresh the 2.5 pct online price'; end if;
 update public.erp_online_listings set published=false
 where product_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid;
 update public.erp_online_listings set published=true
 where product_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid;
 select online_price into v_online from public.erp_online_listings
 where product_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid;
 if v_online<>102.49 then raise exception 'Republishing compounded online markup'; end if;
end $$;
select 'Online-only price markup payment checks passed' as result;
