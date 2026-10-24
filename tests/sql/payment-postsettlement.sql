-- Disposable PostgreSQL only. Test the complete transaction, never real providers.
-- Earlier payment-behavior.sql leaves one paid Razorpay order, one late capture,
-- and one pending manual UPI reservation. Roll back all additional fixtures.
begin;
do $$
declare r jsonb; receipt jsonb; v_id uuid; v_manual uuid; v_invoice_token uuid;
        v_amount bigint; qty integer; n integer; denied boolean;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  select order_id into v_id from public.razorpay_checkouts
    where checkout_id='11111111-1111-4111-8111-111111111111';
  if (select status from public.orders where id=v_id)<>'confirmed'
    or (select count(*) from public.invoices where order_id=v_id)<>1
    or (select count(*) from public.inventory_transactions where reference_order_id=v_id and transaction_type='sale_online')<>1
    or (select stock_quantity from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')<>3 then
    raise exception 'Paid finalization did not atomically confirm, invoice and record reserved stock once';
  end if;
  perform public.complete_razorpay_checkout('order_example12345','pay_example12345',14992,'evt_replay');
  perform app_private.finalize_paid_razorpay(v_id);
  if (select count(*) from public.invoices where order_id=v_id)<>1
    or (select count(*) from public.inventory_transactions where reference_order_id=v_id and transaction_type='sale_online')<>1
    or exists(select 1 from public.whatsapp_notifications where order_id=v_id) then
    raise exception 'Repeated finalization duplicated effects or ignored WhatsApp opt-out';
  end if;
  r:=public.get_razorpay_checkout('11111111-1111-4111-8111-111111111111');
  if r->>'gateway_payment_id'<>'pay_example12345' or r->>'order_number' is null
    or r->>'expires_at' is null or not (r ? 'reservation_released_at') then
    raise exception 'Private recovery lookup lacks payment or expiry reconciliation evidence';
  end if;
  denied:=false;
  begin
    -- Even two matching order/payment edits cannot change the captured amount.
    update public.payments set amount=amount+1 where order_id=v_id;
    update public.orders set total_amount=total_amount+1 where id=v_id;
  exception when others then denied:=true; end;
  if not denied then raise exception 'Confirmed amount no longer matches verified gateway capture'; end if;
  receipt:=public.get_paid_razorpay_receipt('11111111-1111-4111-8111-111111111111','order_example12345');
  if receipt->>'invoice_url' is null then raise exception 'Verified payment receipt missing'; end if;
  if public.get_paid_razorpay_receipt('11111111-1111-4111-8111-111111111111','order_other') is not null then
    raise exception 'Receipt accepted a different provider order';
  end if;
  if public.get_public_invoice('ffffffff-ffff-4fff-8fff-ffffffffffff') is not null then
    raise exception 'Unknown invoice token was accepted';
  end if;

  select order_id into v_manual from public.manual_upi_checkout_requests limit 1;
  denied:=false;
  begin update public.orders set status='confirmed',payment_status='paid' where id=v_manual;
  exception when others then denied:=true; end;
  if not denied then raise exception 'Raw status/payment flag bypassed verification'; end if;
  -- Even a correctly formed invoice token must not reveal an unpaid checkout.
  insert into public.invoices(order_id,invoice_number) values(v_manual,'TEST-UNPAID') returning public_token into v_invoice_token;
  if public.get_public_invoice(v_invoice_token) is not null then raise exception 'Unpaid invoice exposed'; end if;
  delete from public.invoices where order_id=v_manual;

  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
  denied:=false;
  begin perform public.verify_online_order_payment(v_manual);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Non-admin verified manual UPI'; end if;
  perform set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
  denied:=false;
  begin
    update public.payments set amount=amount-1 where order_id=v_manual;
    perform public.verify_online_order_payment(v_manual);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Manual verification accepted a payment amount mismatch'; end if;
  r:=public.verify_online_order_payment(v_manual);
  if r->>'success'<>'true' or (select status from public.orders where id=v_manual)<>'confirmed'
    or (select count(*) from public.invoices where order_id=v_manual)<>1
    or (select count(*) from public.inventory_transactions where reference_order_id=v_manual and transaction_type='sale_online')<>1 then
    raise exception 'Staff-verified manual UPI did not finalize exactly once';
  end if;
  perform public.verify_online_order_payment(v_manual);
  if (select count(*) from public.invoices where order_id=v_manual)<>1 then raise exception 'Manual verification duplicated invoice'; end if;
  denied:=false;
  begin perform public.verify_online_order_payment(v_id);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Admin manually verified a gateway checkout'; end if;
  insert into public.orders(order_number,customer_id,source,total_amount)
    values('TEST-CARD','cccccccc-cccc-4ccc-cccc-cccccccccccc','online',123) returning id into v_id;
  insert into public.payments(order_id,method,amount,transaction_reference) values(v_id,'card',123,'TESTCARD123');
  denied:=false;
  begin perform public.verify_online_order_payment(v_id);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Manual UPI verifier accepted another payment method'; end if;

  -- Opt-in queues a receipt; only an approved test allowlist can claim it.
  perform set_config('request.jwt.claim.role','service_role',true);
  r:=public.create_razorpay_checkout('44444444-4444-4444-8444-444444444444',
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]',
    '{"name":"Opt-in TEST","whatsapp_number":"7777777777","state":"Tamil Nadu","address":"Test address"}');
  v_amount:=(r->>'amount_paise')::bigint;
  perform public.set_razorpay_whatsapp_opt_in('44444444-4444-4444-8444-444444444444',true);
  perform public.attach_razorpay_order('44444444-4444-4444-8444-444444444444','order_optin',v_amount);
  perform public.complete_razorpay_checkout('order_optin','pay_optin',v_amount,'evt_optin');
  select order_id into v_id from public.razorpay_checkouts where checkout_id='44444444-4444-4444-8444-444444444444';
  select public_token into v_invoice_token from public.invoices where order_id=v_id;
  if public.get_public_invoice(v_invoice_token) is null then raise exception 'Paid invoice unavailable'; end if;
  if (select count(*) from public.whatsapp_notifications where order_id=v_id)<>1 then raise exception 'Opt-in outbox missing'; end if;
  if public.claim_paid_invoice_whatsapp(5,null)<>'[]'::jsonb
    or public.claim_paid_invoice_whatsapp(5,array['6666666666'])<>'[]'::jsonb then
    raise exception 'WhatsApp receipt escaped test allowlist';
  end if;
  r:=public.claim_paid_invoice_whatsapp(5,array['7777777777']);
  if jsonb_array_length(r)<>1 or r->0->>'whatsapp_opt_in'<>'true' or r->0->>'payment_verified'<>'true' then
    raise exception 'WhatsApp claim lacks consent or verified payment proof';
  end if;
  if public.claim_paid_invoice_whatsapp(5,array['7777777777'])<>'[]'::jsonb then raise exception 'WhatsApp outbox claimed twice'; end if;

  -- Partial/full/refund replays revoke receipts, stop fulfillment and never
  -- return sold physical items to stock without a separate audited return.
  r:=public.record_razorpay_refund('order_optin','pay_optin',v_amount,100,'evt_partial','rfnd_partial');
  if r->>'state'<>'refund_required' or r->>'paid'<>'false'
    or public.get_public_invoice(v_invoice_token) is not null
    or public.get_paid_razorpay_receipt('44444444-4444-4444-8444-444444444444','order_optin') is not null
    or (select stock_quantity from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')<>2
    or exists(select 1 from public.whatsapp_notifications where order_id=v_id and status='pending') then
    raise exception 'Partial refund left fulfillment, invoice, message or stock unsafe';
  end if;
  denied:=false;
  begin update public.orders set status='confirmed',payment_status='paid' where id=v_id;
  exception when others then denied:=true; end;
  if not denied then raise exception 'Refunded checkout was re-confirmed'; end if;
  perform public.record_razorpay_refund('order_optin','pay_optin',v_amount,50,'evt_stale','rfnd_stale');
  if (select amount_refunded_paise from public.razorpay_checkouts where order_id=v_id)<>100
    or (select last_refund_id from public.razorpay_checkouts where order_id=v_id)<>'rfnd_partial' then
    raise exception 'Stale event reduced refund total or overwrote newer refund evidence';
  end if;
  r:=public.get_razorpay_payment_review();
  if not exists(select 1 from jsonb_array_elements(r) x where x->>'order_id'=v_id::text
    and x->>'checkout_status'='refund_required' and x->>'amount_refunded_paise'='100')
    or exists(select 1 from jsonb_array_elements(r) x where
      (select count(*) from jsonb_object_keys(x))<>7
      or x ? 'public_token' or x ? 'customer_name' or x ? 'recipient') then
    raise exception 'Admin refund review missing partial refund or exposing private customer/token data';
  end if;
  r:=public.record_razorpay_refund('order_optin','pay_optin',v_amount,v_amount,'evt_full','rfnd_full');
  perform public.record_razorpay_refund('order_optin','pay_optin',v_amount,100,'evt_old','rfnd_partial');
  r:=public.complete_razorpay_checkout('order_optin','pay_optin',v_amount,'evt_capture_replay');
  if r->>'state'<>'refunded' or r->>'paid'<>'false'
    or (select status from public.orders where id=v_id)<>'refunded'
    or (select stock_quantity from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')<>2
    or (select count(*) from public.inventory_transactions where reference_order_id=v_id and transaction_type='sale_online')<>1 then
    raise exception 'Refund/capture replay reversed refund or credited sold stock';
  end if;
  denied:=false;
  begin perform public.record_razorpay_refund('order_optin','pay_other',v_amount,v_amount,null,null);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Refund accepted another payment'; end if;
  denied:=false;
  begin perform public.record_razorpay_refund('order_optin','pay_optin',v_amount,v_amount+1,null,null);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Refund accepted amount above the order total'; end if;

  -- Regression: capture arrives after expiry BEFORE scheduled cleanup. The old
  -- function changed state first, making the reservation invisible to cleanup.
  r:=public.create_razorpay_checkout('55555555-5555-4555-8555-555555555555',
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]',
    '{"name":"Late TEST","whatsapp_number":"6666666666","state":"Tamil Nadu","address":"Test address"}');
  v_amount:=(r->>'amount_paise')::bigint;
  perform public.attach_razorpay_order('55555555-5555-4555-8555-555555555555','order_late_before_cleanup',v_amount);
  update public.razorpay_checkouts set expires_at=now()-interval '1 minute' where checkout_id='55555555-5555-4555-8555-555555555555';
  r:=public.complete_razorpay_checkout('order_late_before_cleanup','pay_late_before_cleanup',v_amount,'evt_late_before');
  select order_id into v_id from public.razorpay_checkouts where checkout_id='55555555-5555-4555-8555-555555555555';
  if r->>'state'<>'refund_required' or (select status from public.orders where id=v_id)<>'cancelled'
    or exists(select 1 from public.invoices where order_id=v_id)
    or exists(select 1 from public.inventory_transactions where reference_order_id=v_id)
    or (select stock_quantity from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')<>2 then
    raise exception 'Late capture before cleanup did not release reservation safely';
  end if;
  perform public.complete_razorpay_checkout('order_late_before_cleanup','pay_late_before_cleanup',v_amount,'evt_late_repeat');
  perform public.expire_razorpay_checkouts(100);
  r:=public.get_razorpay_checkout('55555555-5555-4555-8555-555555555555');
  if r->>'reservation_released_at' is null then raise exception 'Recovery cannot prove reservation release'; end if;
  perform public.record_razorpay_refund('order_late_before_cleanup' ,'pay_late_before_cleanup',v_amount,v_amount,'evt_late_refund','rfnd_late');
  if (select stock_quantity from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')<>2 then raise exception 'Late capture stock released twice'; end if;

  -- A refund event may arrive before the captured webhook; it must terminate
  -- and release an unfinalized reservation without ever creating a sale.
  r:=public.create_razorpay_checkout('66666666-6666-4666-8666-666666666666',
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]',
    '{"name":"Refund first TEST","whatsapp_number":"5555555555","state":"Tamil Nadu","address":"Test address"}');
  v_amount:=(r->>'amount_paise')::bigint;
  perform public.attach_razorpay_order('66666666-6666-4666-8666-666666666666','order_refund_first',v_amount);
  perform public.record_razorpay_refund('order_refund_first','pay_refund_first',v_amount,v_amount,'evt_refund_first','rfnd_first');
  r:=public.complete_razorpay_checkout('order_refund_first','pay_refund_first',v_amount,'evt_later_capture');
  if r->>'state'<>'refunded' or (select stock_quantity from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')<>2 then
    raise exception 'Refund before capture created a sale or leaked reservation';
  end if;

  perform set_config('request.jwt.claim.role','anon',true);
  r:=public.create_online_order('[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]',
    '{"name":"Manual expiry TEST","whatsapp_number":"4444444444","state":"Tamil Nadu","address":"Test address","payment_method":"upi","payment_reference":"UTREXPIRE123"}');
  v_id:=(r->>'order_id')::uuid;
  update public.manual_upi_checkout_requests set created_at=now()-interval '25 hours' where order_id=v_id;
  -- An older paid manual checkout must not consume a limited cleanup batch.
  update public.manual_upi_checkout_requests set created_at=now()-interval '26 hours' where order_id=v_manual;
  perform set_config('request.jwt.claim.role','service_role',true);
  n:=public.expire_manual_upi_checkouts(1);
  if n<>1 or public.expire_manual_upi_checkouts(100)<>0
    or (select status from public.orders where id=v_id)<>'cancelled'
    or (select stock_quantity from public.product_variants where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')<>2 then
    raise exception 'Manual UPI reservation cleanup not idempotent';
  end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  denied:=false;
  begin perform public.verify_online_order_payment(v_id);
  exception when others then denied:=true; end;
  if not denied then raise exception 'Expired manual UPI checkout was fulfilled'; end if;
  raise notice 'Full post-settlement, refund, consent and cleanup checks passed';
end $$;

-- Check actual Postgres role privileges, not only the request JWT role helper.
set local role anon;
do $$ begin
  if has_function_privilege(current_user,'public.complete_razorpay_checkout(text,text,bigint,text)','execute')
    or has_function_privilege(current_user,'public.record_razorpay_refund(text,text,bigint,bigint,text,text)','execute')
    or has_function_privilege(current_user,'public.claim_paid_invoice_whatsapp(integer,text[])','execute')
    or has_function_privilege(current_user,'public.get_paid_razorpay_receipt(uuid,text)','execute')
    or has_function_privilege(current_user,'public.audit_order_shipment()','execute')
    or has_function_privilege(current_user,'public.get_razorpay_checkout(uuid)','execute')
    or has_function_privilege(current_user,'public.create_online_order(jsonb,jsonb,numeric)','execute')
    or has_function_privilege(current_user,'public.track_online_order(text,text)','execute')
    or has_function_privilege(current_user,'public.track_guest_order_shipments(text,text)','execute')
    or has_function_privilege(current_user,'public.get_razorpay_payment_review()','execute')
    or has_table_privilege(current_user,'public.razorpay_checkouts','select') then
    raise exception 'Anonymous role can access a private payment API or table';
  end if;
  if public.get_public_invoice('ffffffff-ffff-4fff-8fff-ffffffffffff') is not null then raise exception 'Unknown invoice exposed to anon'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  if has_function_privilege(current_user,'public.complete_razorpay_checkout(text,text,bigint,text)','execute')
    or has_function_privilege(current_user,'public.record_razorpay_refund(text,text,bigint,bigint,text,text)','execute')
    or has_function_privilege(current_user,'public.claim_paid_invoice_whatsapp(integer,text[])','execute')
    or has_function_privilege(current_user,'public.create_online_order(jsonb,jsonb,numeric)','execute')
    or has_function_privilege(current_user,'public.track_online_order(text,text)','execute')
    or has_function_privilege(current_user,'public.track_guest_order_shipments(text,text)','execute')
    or has_function_privilege(current_user,'public.audit_order_shipment()','execute')
    or has_function_privilege(current_user,'public.get_razorpay_checkout(uuid)','execute')
    or has_table_privilege(current_user,'public.razorpay_checkouts','select') then
    raise exception 'Signed-in shopper can access private payment APIs';
  end if;
end $$;
reset role;
-- Real browser roles still cannot manufacture payment evidence despite the
-- historical broad admin ALL policies. Checked staff UPI RPC still succeeds.
set local role authenticated;
do $$
declare n integer; denied boolean; v_id uuid; v_paid uuid; r jsonb;
begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
  denied:=false;
  begin perform public.get_razorpay_payment_review();
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Non-admin inspected payment reconciliation'; end if;
  perform set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
  r:=public.get_razorpay_payment_review();
  if jsonb_array_length(r)<1 then raise exception 'Admin cannot inspect refund reconciliation'; end if;
  select id into v_id from public.orders where order_number='TEST-CARD';
  if v_id is null then raise exception 'Missing browser tampering fixture'; end if;
  update public.payments set method='upi',status='paid',verified_at=now(),
    verified_by='dddddddd-dddd-4ddd-8ddd-dddddddddddd' where order_id=v_id;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Admin browser forged online paid evidence'; end if;
  update public.orders set source='local_store',status='pending',payment_status='paid' where id=v_id;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Admin browser changed online checkout into a local sale'; end if;
  denied:=false;
  begin
    insert into public.payments(order_id,method,amount,status,transaction_reference,verified_by,verified_at)
      values(v_id,'upi',123,'paid','FORGEDUPI123','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now());
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Admin browser inserted fake verified UPI payment'; end if;
  delete from public.payments where order_id=v_id;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Admin browser deleted online payment evidence'; end if;
  select id into v_paid from public.orders where status='confirmed' limit 1;
  update public.order_items set quantity=99 where order_id=v_paid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Admin browser rewrote reserved quantities'; end if;
  delete from public.orders where id=v_paid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Admin browser deleted a finalized order'; end if;
  raise notice 'Browser admin cannot forge online commerce evidence';
end $$;
reset role;
-- Offline POS writes retain their existing permissions.
insert into public.orders(order_number,customer_id,source,total_amount)
  values('TEST-OFFLINE','cccccccc-cccc-4ccc-cccc-cccccccccccc','local_store',100);
set local role authenticated;
do $$ declare v_id uuid; n integer; begin
  select id into v_id from public.orders where order_number='TEST-OFFLINE';
  insert into public.payments(order_id,method,amount,status) values(v_id,'cash',100,'paid');
  update public.orders set payment_status='paid',status='confirmed' where id=v_id;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Online hardening broke offline staff billing'; end if;
end $$;
reset role;
set local role service_role;
do $$ begin
  perform set_config('request.jwt.claim.role','service_role',true);
  if not has_function_privilege(current_user,'public.create_online_order(jsonb,jsonb,numeric)','execute')
    or not has_function_privilege(current_user,'public.track_online_order(text,text)','execute')
    or not has_function_privilege(current_user,'public.track_guest_order_shipments(text,text)','execute') then
    raise exception 'Backend lacks private legacy checkout/tracking proxy permissions';
  end if;
  perform public.create_online_order('[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]',
    '{"name":"Real role TEST","whatsapp_number":"3333333333","state":"Tamil Nadu","address":"Test address","payment_method":"upi","payment_reference":"UTRREALROLE123"}');
end $$;
reset role;
set local role authenticated;
do $$ declare r jsonb; v_id uuid; begin
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
  select order_id into v_id from public.payments where transaction_reference='UTRREALROLE123';
  r:=public.verify_online_order_payment(v_id);
  if r->>'success'<>'true' or (select status from public.orders where id=v_id)<>'confirmed' then
    raise exception 'Checked staff UPI verification failed with restrictive RLS enabled';
  end if;
end $$;
reset role;
rollback;
