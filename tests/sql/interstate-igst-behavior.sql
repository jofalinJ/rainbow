-- Disposable PostgreSQL only. Run AFTER the existing payment-behavior suite.
-- This test must never connect to a production database.
do $$
declare
  r jsonb;
  retry jsonb;
  row_tn record;
  row_kerala record;
  row_manual record;
  stock_before integer;
  stock_after integer;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  select stock_quantity into stock_before
    from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'::uuid;

  select public.create_razorpay_checkout(
    '33333333-3333-4333-8333-333333333334'::uuid,
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"TN tax test","whatsapp_number":"9999999999","state":"Tamil Nadu","address":"TN test delivery"}'::jsonb
  ) into r;
  if r->>'state'<>'new' then raise exception 'TN checkout not created: %',r; end if;
  select o.cgst_amount,o.sgst_amount,o.igst_amount,o.total_amount,rc.amount_paise
    into row_tn from public.razorpay_checkouts rc
    join public.orders o on o.id=rc.order_id
    where rc.checkout_id='33333333-3333-4333-8333-333333333334'::uuid;
  if row_tn.cgst_amount<>1.46 or row_tn.sgst_amount<>1.46 or
     row_tn.igst_amount<>0 or row_tn.total_amount<>149.92 or
     row_tn.amount_paise<>14992 then
    raise exception 'Wrong intra-state GST allocation: %',row_to_json(row_tn);
  end if;

  select public.create_razorpay_checkout(
    '44444444-4444-4444-8444-444444444444'::uuid,
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"Kerala tax test","whatsapp_number":"8888888888","state":"Kerala","address":"Kerala test delivery"}'::jsonb
  ) into r;
  if r->>'state'<>'new' then raise exception 'Kerala checkout not created: %',r; end if;
  select o.cgst_amount,o.sgst_amount,o.igst_amount,o.total_amount,rc.amount_paise
    into row_kerala from public.razorpay_checkouts rc
    join public.orders o on o.id=rc.order_id
    where rc.checkout_id='44444444-4444-4444-8444-444444444444'::uuid;
  if row_kerala.cgst_amount<>0 or row_kerala.sgst_amount<>0 or
     row_kerala.igst_amount<>2.91 or row_kerala.total_amount<>199.91 or
     row_kerala.amount_paise<>19991 then
    raise exception 'Wrong interstate GST allocation: %',row_to_json(row_kerala);
  end if;

  -- Legacy manual UPI RPC remains idempotent with the same interstate tax split.
  perform set_config('request.jwt.claim.role','anon',true);
  select public.create_online_order(
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"Guest Kerala","whatsapp_number":"7777777777","address":"Kerala test",
      "city":"Kochi","state":"Kerala","payment_method":"upi",
      "payment_reference":"IGSTTEST112233",
      "checkout_id":"55555555-5555-4555-8555-555555555555"}'::jsonb
  ) into r;
  if r->>'igst_amount'<>'2.91' or r->>'cgst_amount'<>'0' or
     r->>'sgst_amount'<>'0' then
    raise exception 'Manual checkout tax breakdown incorrect: %',r;
  end if;
  select cgst_amount,sgst_amount,igst_amount,total_amount
    into row_manual from public.orders where id=(r->>'order_id')::uuid;
  if row_manual.cgst_amount<>0 or row_manual.sgst_amount<>0 or
     row_manual.igst_amount<>2.91 then
    raise exception 'Manual stored GST incorrect: %',row_to_json(row_manual);
  end if;
  select public.create_online_order(
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"Guest Kerala","whatsapp_number":"7777777777","address":"Kerala test",
      "city":"Kochi","state":"Kerala","payment_method":"upi",
      "payment_reference":"IGSTTEST112233",
      "checkout_id":"55555555-5555-4555-8555-555555555555"}'::jsonb
  ) into retry;
  if retry->>'already_created'<>'true' or retry->>'igst_amount'<>'2.91' then
    raise exception 'Manual interstate retry not idempotent: %',retry;
  end if;
  select stock_quantity into stock_after
    from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'::uuid;
  if stock_after<>stock_before-3 then
    raise exception 'Three single-unit checkouts should reserve exactly three items: %, %',
       stock_before,stock_after;
  end if;
  raise notice 'Interstate GST, stored invoice tax kind, and retry tests passed';
end $$;
