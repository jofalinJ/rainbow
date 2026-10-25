-- All assertions execute only inside the GitHub Actions disposable PostgreSQL service.
\set ON_ERROR_STOP on
update public.products
set category_id='44444444-4444-4444-8444-444444444444'
where product_code='TEST001';

do $$
declare
  v_first jsonb;
  v_repeat jsonb;
  v_recovered jsonb;
  v_stock integer;
  v_count integer;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
  v_first:=public.create_local_sale(
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":2}]'::jsonb,
    '{"client_sale_id":"55555555-5555-4555-8555-555555555555"}'::jsonb,'cash');
  v_repeat:=public.create_local_sale(
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":2}]'::jsonb,
    '{"client_sale_id":"55555555-5555-4555-8555-555555555555"}'::jsonb,'cash');
  if v_first->>'order_id' is distinct from v_repeat->>'order_id' then
    raise exception 'Idempotency failed: same checkout created a different order';
  end if;
  -- A timed-out cashier request is read-only recoverable without selling twice.
  v_recovered:=public.get_local_sale_receipt('55555555-5555-4555-8555-555555555555');
  if v_recovered->>'invoice_number' is distinct from v_first->>'invoice_number' then
    raise exception 'Recovered sale invoice did not match the original';
  end if;
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
  if public.get_local_sale_receipt('55555555-5555-4555-8555-555555555555') is not null then
    raise exception 'Admin must not read another cashier private retry response';
  end if;
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
  begin
    perform public.get_local_sale_receipt('55555555-5555-4555-8555-555555555555');
    raise exception 'Unauthorized inventory-only account accessed sale recovery';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
  select stock_quantity into v_stock from public.product_variants
    where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  if v_stock<>3 then raise exception 'Retry deducted stock twice: %',v_stock;end if;
  select count(*) into v_count from public.orders where source='local_store';
  if v_count<>1 then raise exception 'Duplicate local orders: %',v_count;end if;
  select count(*) into v_count from public.inventory_transactions;
  if v_count<>1 then raise exception 'Duplicate inventory events: %',v_count;end if;
  select count(*) into v_count from public.invoices;
  if v_count<>1 then raise exception 'Duplicate invoices: %',v_count;end if;
  select count(*) into v_count from public.payments;
  if v_count<>1 then raise exception 'Duplicate payment records: %',v_count;end if;
  select count(*) into v_count from public.customers
    where name='Walk-in Customer' and whatsapp_number='';
  if v_count<>1 then raise exception 'Walk-in customer phone constraint failed';end if;
  begin
    perform public.create_local_sale(
      '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
      '{"client_sale_id":"55555555-5555-4555-8555-555555555555"}'::jsonb,'cash');
    raise exception 'Mismatched retry unexpectedly accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm='Mismatched retry unexpectedly accepted' then raise;end if;
    if sqlerrm not like '%different request%' then raise;end if;
  end;
end $$;

do $$
declare
  v_product jsonb;
  v_count integer;
begin
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
  v_product:=public.create_product_with_variant(
    '{"category_id":"44444444-4444-4444-8444-444444444444","product_name":"Atomic Ring","type":"ring","selling_price":150}'::jsonb,
    '{"color":"gold","size":"8","stock_quantity":2}'::jsonb);
  if nullif(v_product->>'product_code','') is null then
    raise exception 'Atomic creation omitted product code';
  end if;
  select count(*) into v_count from public.product_variants
    where id=(v_product->>'variant_id')::uuid and barcode is not null;
  if v_count<>1 then raise exception 'Atomic product has no barcode variant';end if;
  begin
    perform public.create_product_with_variant(
      '{"category_id":"44444444-4444-4444-8444-444444444444","product_name":"Must Roll Back","type":"ring","selling_price":150}'::jsonb,
      '{"color":"gold","size":"9","stock_quantity":-4}'::jsonb);
    raise exception 'Invalid variant unexpectedly accepted';
  exception when check_violation then null;
  end;
  select count(*) into v_count from public.products where product_name='Must Roll Back';
  if v_count<>0 then raise exception 'Orphaned product survived failed variant';end if;
  if (public.search_inventory_variants(
    '44444444-4444-4444-8444-444444444444'::uuid,'Atomic',0,80)->>'total')::int<>1 then
    raise exception 'Inventory search totals were incorrect';
  end if;
end $$;

do $$
declare
  v_bills jsonb;
  v_metrics jsonb;
  v_orders jsonb;
  v_count integer;
begin
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
  v_bills:=public.search_shop_bills('INV','all',0,50);
  if (v_bills->>'total')::int<>1 or jsonb_array_length(v_bills->'rows')<>1 then
    raise exception 'Bill history pagination/search failed';
  end if;
  insert into public.orders(order_number,customer_id,source,status,payment_status,total_amount)
    values('PENDING-ONLINE-1','cccccccc-cccc-4ccc-cccc-cccccccccccc','online','pending','pending',500);
  v_metrics:=public.get_admin_operational_metrics();
  if (v_metrics->>'orders')::int<>2 or (v_metrics->>'today_sales')::numeric<=0
    or (v_metrics->>'today_sales')::numeric >= 500 then
    raise exception 'Reports count unpaid customer checkout as realized sales: %',v_metrics;
  end if;
  v_orders:=public.search_online_orders('PENDING','all',0,50);
  if (v_orders->>'total')::int<>1 or jsonb_array_length(v_orders->'rows')<>1 then
    raise exception 'Online orders pagination/search failed';
  end if;
  select count(*) into v_count from pg_policies
    where schemaname='public' and policyname like 'Online % through checked RPCs';
  if v_count<>0 then raise exception 'Permissive order/payment RLS policies remain: %',v_count;end if;
  if has_function_privilege('anon','public.search_shop_bills(text,text,integer,integer)','EXECUTE') then
    raise exception 'Anonymous user can execute staff bill-history RPC';
  end if;
  if has_table_privilege('authenticated','app_private.local_sale_requests','SELECT') then
    raise exception 'Staff can read private POS idempotency requests directly';
  end if;
end $$;
select 'PASS: seven SQL migrations, invoice recovery, sale retry, stock, product rollback, RLS and reports' as result;
