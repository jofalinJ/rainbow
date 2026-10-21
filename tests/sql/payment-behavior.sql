-- Runs ONLY in the disposable CI PostgreSQL service.
do $$
declare r jsonb;
        repeat_result jsonb;
        order_id uuid;
        qty integer;
        n integer;
        denied boolean:=false;
begin
  perform set_config('request.jwt.claim.role','anon',true);
  begin
    perform public.create_razorpay_checkout(
      '11111111-1111-4111-8111-111111111111'::uuid,
      '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
      '{"name":"Guest","whatsapp_number":"9999999999","state":"Tamil Nadu","address":"Guest address"}'::jsonb);
  exception when others then denied:=true;
  end;
  if not denied then raise exception 'Anonymous payment backend call was accepted'; end if;

  perform set_config('request.jwt.claim.role','service_role',true);
  select public.create_razorpay_checkout(
    '11111111-1111-4111-8111-111111111111'::uuid,
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"Guest","whatsapp_number":"9999999999","state":"Tamil Nadu","address":"Guest address"}'::jsonb
  ) into r;
  if r->>'state'<>'new' or (r->>'amount_paise')::bigint<>14992 then
    raise exception 'Razorpay amount or new session state wrong: %',r;
  end if;
  select stock_quantity into qty from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  if qty<>4 then raise exception 'Reservation should take one item: %',qty; end if;

  select public.create_razorpay_checkout(
    '11111111-1111-4111-8111-111111111111'::uuid,
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":3}]'::jsonb,
    '{"name":"Guest","whatsapp_number":"9999999999","state":"Tamil Nadu","address":"Guest address"}'::jsonb
  ) into repeat_result;
  if repeat_result->>'state'<>'creating' then raise exception 'Retry state was not creating'; end if;
  select stock_quantity into qty from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  if qty<>4 then raise exception 'Retry deducted stock twice'; end if;
  select count(*) into n from public.razorpay_checkouts;
  if n<>1 then raise exception 'Duplicate checkout rows created'; end if;

  select public.attach_razorpay_order(
    '11111111-1111-4111-8111-111111111111'::uuid,'order_example12345',14992) into r;
  if r->>'state'<>'ready' then raise exception 'Attach not ready'; end if;

  select public.complete_razorpay_checkout(
    'order_example12345','pay_example12345',14992,'evt_1') into r;
  if r->>'state'<>'paid' or r->>'paid'<>'true' then
    raise exception 'Captured payment not completed: %',r;
  end if;
  select public.complete_razorpay_checkout(
    'order_example12345','pay_example12345',14992,'evt_1') into repeat_result;
  if repeat_result->>'state'<>'paid' then raise exception 'Payment retry not idempotent'; end if;

  -- Another reservation expires with stock restored only once.
  select public.create_razorpay_checkout(
    '22222222-2222-4222-8222-222222222222'::uuid,
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":2}]'::jsonb,
    '{"name":"Second Guest","whatsapp_number":"8888888888","state":"Kerala","address":"Second address"}'::jsonb
  ) into r;
  if r->>'state'<>'new' then raise exception 'Second checkout rejected'; end if;
  perform public.attach_razorpay_order(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'order_example22222',(r->>'amount_paise')::bigint);
  update public.razorpay_checkouts
    set expires_at=now()-interval '15 minutes'
    where checkout_id='22222222-2222-4222-8222-222222222222';
  select public.expire_razorpay_checkouts(20) into n;
  if n<>1 then raise exception 'Expected one expired reservation: %',n; end if;
  select public.expire_razorpay_checkouts(20) into n;
  if n<>0 then raise exception 'Repeated cleanup should not re-credit stock'; end if;
  select stock_quantity into qty from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  if qty<>4 then raise exception 'Expired reservation stock mismatch: %',qty; end if;
  select public.complete_razorpay_checkout(
    'order_example22222','pay_example22222',
    (select amount_paise from public.razorpay_checkouts
      where checkout_id='22222222-2222-4222-8222-222222222222'),
    'evt_late'
  ) into r;
  if r->>'state'<>'refund_required' or r->>'paid'<>'false' then
    raise exception 'Late payment was incorrectly fulfilled: %',r;
  end if;

  -- Manual UPI: older clients are supported with a deterministic ID derived from
  -- the submitted phone + UTR; a retry must reuse the same order and stock.
  perform set_config('request.jwt.claim.role','anon',true);
  select public.create_online_order(
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"Guest entered original phone","whatsapp_number":"9999999999",
      "address":"Malicious new address","city":"Test","state":"Tamil Nadu",
      "payment_method":"upi","payment_reference":"UTRABC123456"}'::jsonb
  ) into r;
  if r->>'order_id' is null then raise exception 'Manual UPI order missing'; end if;
  order_id:=(r->>'order_id')::uuid;
  select public.create_online_order(
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"Guest entered original phone","whatsapp_number":"9999999999",
      "address":"Malicious new address","city":"Test","state":"Tamil Nadu",
      "payment_method":"upi","payment_reference":"UTRABC123456"}'::jsonb
  ) into repeat_result;
  if repeat_result->>'order_id'<>order_id::text or
     repeat_result->>'already_created'<>'true' then
    raise exception 'Manual UPI retry did not reuse order: %',repeat_result;
  end if;
  select stock_quantity into qty from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  if qty<>3 then raise exception 'Manual retry deducted stock twice: %',qty; end if;
  -- Reusing the UPI transaction reference with a different checkout UUID
  -- must NOT create another order or reserve stock.
  denied:=false;
  begin
    perform public.create_online_order(
      '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
      '{"name":"Another Guest","whatsapp_number":"8888888888",
        "address":"Another address","city":"Test","state":"Tamil Nadu",
        "checkout_id":"33333333-3333-4333-8333-333333333333",
        "payment_method":"upi","payment_reference":"UTRABC123456"}'::jsonb);
  exception when unique_violation then denied:=true;
  end;
  if not denied then raise exception 'UPI transaction reference was reused for a second order'; end if;
  select stock_quantity into qty from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  if qty<>3 then raise exception 'Rejected UPI reference changed stock'; end if;
  if (select name from public.customers where id='cccccccc-cccc-4ccc-cccc-cccccccccccc')<>'Original Customer' or
     (select address from public.customers where id='cccccccc-cccc-4ccc-cccc-cccccccccccc')<>'Saved original address' then
    raise exception 'Guest changed saved customer details using a phone number';
  end if;
  raise notice 'SQL payment checks passed';
end;
$$;
