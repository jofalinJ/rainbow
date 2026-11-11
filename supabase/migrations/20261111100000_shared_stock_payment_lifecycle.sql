-- Keep online cancellation, stock release and late capture in one transaction.
-- This migration does not change the shared-stock activation flag.
begin;

create or replace function app_private.cancel_unpaid_online_inventory(
  p_order_id uuid, p_method public.payment_method
) returns void language plpgsql
set search_path=pg_catalog,public,app_private as $$
declare
  v_item record;
  v_updated integer;
begin
  -- Callers hold the pending order row lock. Shared mode releases the
  -- order's exact branch reservations in the BEFORE UPDATE order trigger.
  if not app_private.erp_shared_branch_stock() then
    for v_item in
      select variant_id, sum(quantity)::integer as quantity
      from public.order_items where order_id=p_order_id
      group by variant_id order by variant_id
    loop
      update public.product_variants
      set stock_quantity=stock_quantity+v_item.quantity, updated_at=now()
      where id=v_item.variant_id;
    end loop;
  end if;

  update public.orders set status='cancelled', payment_status='failed', updated_at=now()
  where id=p_order_id and source='online' and status='pending' and payment_status='pending';
  if not found then raise exception 'Only pending unpaid online orders may be cancelled'; end if;

  update public.payments set status='failed'
  where order_id=p_order_id and method=p_method and status='pending';
  get diagnostics v_updated = row_count;
  if v_updated<>1 then raise exception 'Pending online payment could not be cancelled'; end if;
end;
$$;
revoke all on function app_private.cancel_unpaid_online_inventory(uuid,public.payment_method)
  from public,anon,authenticated;

create or replace function app_private.release_razorpay_reservation(p_checkout_id uuid)
returns boolean language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_checkout public.razorpay_checkouts%rowtype;
begin
  select * into v_checkout from public.razorpay_checkouts
  where checkout_id=p_checkout_id for update;
  if not found or v_checkout.reservation_released_at is not null
    or v_checkout.status not in ('creating','ready')
    or exists(select 1 from public.inventory_transactions
      where reference_order_id=v_checkout.order_id and transaction_type='sale_online')
  then return false; end if;

  perform 1 from public.orders where id=v_checkout.order_id for update;
  perform app_private.cancel_unpaid_online_inventory(v_checkout.order_id,'razorpay');
  update public.razorpay_checkouts set reservation_released_at=now()
  where checkout_id=p_checkout_id;
  return true;
end;
$$;
revoke all on function app_private.release_razorpay_reservation(uuid) from public,anon,authenticated;

create or replace function public.complete_razorpay_checkout(
  p_gateway_order_id text, p_payment_id text, p_amount_paise bigint, p_event_id text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare
  v_checkout public.razorpay_checkouts%rowtype;
  v_order public.orders%rowtype;
  v_state text;
  v_updated integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_]+$' then
    raise exception 'Invalid payment identifier.';
  end if;

  select * into v_checkout from public.razorpay_checkouts
  where gateway_order_id=p_gateway_order_id for update;
  if not found then raise exception 'Unknown provider order.'; end if;
  if p_amount_paise is distinct from v_checkout.amount_paise then
    raise exception 'Payment amount mismatch.';
  end if;
  select * into strict v_order from public.orders where id=v_checkout.order_id for update;

  if v_checkout.status in ('paid','refund_required','refunded') then
    if v_checkout.gateway_payment_id is distinct from p_payment_id then
      raise exception 'Additional captured payment requires investigation.';
    end if;
    return jsonb_build_object('paid',v_checkout.status='paid','state',v_checkout.status,
      'order_number',v_order.order_number);
  end if;
  if v_checkout.status not in ('ready','expired') then
    raise exception 'Checkout is not ready for settlement.';
  end if;

  v_state:='paid';
  if v_checkout.status='expired' or v_checkout.expires_at<=clock_timestamp() then
    -- Once the deadline passes, cancel and release even if cleanup has not
    -- run yet. A retry or a later cleanup cannot release the same hold again.
    if v_checkout.status='ready' then
      if not app_private.release_razorpay_reservation(v_checkout.checkout_id) then
        raise exception 'Pending checkout reservation could not be released.';
      end if;
    elsif v_order.status<>'cancelled' or v_order.payment_status<>'failed'
      or v_checkout.reservation_released_at is null then
      raise exception 'Expired checkout has an inconsistent order state.';
    end if;
    v_state:='refund_required';
  elsif v_order.status<>'pending' or v_order.payment_status<>'pending' then
    raise exception 'Order is not pending settlement.';
  end if;

  update public.razorpay_checkouts
  set status=v_state, gateway_payment_id=p_payment_id, last_event_id=p_event_id,
    paid_at=now(), updated_at=now()
  where checkout_id=v_checkout.checkout_id;

  update public.payments set status='paid', transaction_reference=p_payment_id,
    paid_at=now(), verified_at=now()
  where order_id=v_checkout.order_id and method='razorpay'
    and amount*100=p_amount_paise
    and (status='pending' and v_state='paid' or status='failed' and v_state='refund_required');
  get diagnostics v_updated = row_count;
  if v_updated<>1 then raise exception 'Checkout payment record could not be settled'; end if;

  update public.orders set payment_status='paid',updated_at=now()
  where id=v_checkout.order_id;
  return jsonb_build_object('paid',v_state='paid','state',v_state,'order_number',v_order.order_number);
end;
$$;

create or replace function public.expire_razorpay_checkouts(p_limit integer default 100)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare
  v_checkouts uuid[];
  v_checkout record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid cleanup limit.'; end if;

  -- Lock checkouts first, then orders, then the union of variants in UUID
  -- order. Sorting per checkout alone does not order the batch's locks.
  select array_agg(due.checkout_id) into v_checkouts
  from (
    select checkout_id from public.razorpay_checkouts
    where status in ('creating','ready') and expires_at<now()-interval '10 minutes'
    order by expires_at,checkout_id
    limit p_limit for update skip locked
  ) due;
  if v_checkouts is null then return 0; end if;

  perform 1 from public.orders o
  where o.id in (select rc.order_id from public.razorpay_checkouts rc where rc.checkout_id=any(v_checkouts))
  order by o.id for update;
  perform 1 from public.product_variants pv
  where pv.id in (
    select oi.variant_id from public.order_items oi
    join public.razorpay_checkouts rc on rc.order_id=oi.order_id
    where rc.checkout_id=any(v_checkouts)
  ) order by pv.id for update;

  for v_checkout in
    select checkout_id,order_id from public.razorpay_checkouts
    where checkout_id=any(v_checkouts) order by checkout_id
  loop
    if not app_private.release_razorpay_reservation(v_checkout.checkout_id) then
      raise exception 'Pending checkout reservation could not be released.';
    end if;
    update public.razorpay_checkouts set status='expired',updated_at=now()
    where checkout_id=v_checkout.checkout_id;
  end loop;
  return cardinality(v_checkouts);
end;
$$;

create or replace function public.record_razorpay_refund(
  p_gateway_order_id text, p_payment_id text, p_amount_paise bigint,
  p_amount_refunded_paise bigint, p_event_id text default null, p_refund_id text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare
  v_checkout public.razorpay_checkouts%rowtype;
  v_number text;
  v_refunded bigint;
  v_state text;
  v_updated integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_]+$'
    or (p_refund_id is not null and p_refund_id !~ '^rfnd_[A-Za-z0-9_]+$') then
    raise exception 'Invalid provider identifier.';
  end if;
  select * into v_checkout from public.razorpay_checkouts
  where gateway_order_id=p_gateway_order_id for update;
  if not found then raise exception 'Unknown provider order.'; end if;
  if p_amount_paise is distinct from v_checkout.amount_paise or p_amount_refunded_paise is null
    or p_amount_refunded_paise not between 1 and v_checkout.amount_paise then
    raise exception 'Refund amount mismatch.';
  end if;
  if v_checkout.gateway_payment_id is not null and v_checkout.gateway_payment_id<>p_payment_id then
    raise exception 'Refund belongs to another payment.';
  end if;
  select order_number into strict v_number from public.orders where id=v_checkout.order_id for update;
  -- Refund before capture settlement can release a pending hold. A refund of
  -- a consumed sale has no inventory effect. A physical return is separate.
  if v_checkout.status='ready' and not app_private.release_razorpay_reservation(v_checkout.checkout_id) then
    raise exception 'Pending checkout reservation could not be released.';
  end if;
  v_refunded:=greatest(v_checkout.amount_refunded_paise,p_amount_refunded_paise);
  v_state:=case when v_refunded=v_checkout.amount_paise then 'refunded' else 'refund_required' end;
  if v_checkout.amount_refunded_paise>=p_amount_refunded_paise then
    if v_checkout.amount_refunded_paise=p_amount_refunded_paise
      and v_checkout.last_refund_id is null and p_refund_id is not null then
      update public.razorpay_checkouts set last_refund_id=p_refund_id,
        last_event_id=coalesce(p_event_id,last_event_id),updated_at=now()
      where checkout_id=v_checkout.checkout_id;
    end if;
    return jsonb_build_object('paid',false,'state',v_state,'order_number',v_number);
  end if;

  update public.razorpay_checkouts set status=v_state,gateway_payment_id=p_payment_id,
    amount_refunded_paise=v_refunded,last_event_id=coalesce(p_event_id,last_event_id),
    last_refund_id=coalesce(p_refund_id,last_refund_id),updated_at=now()
  where checkout_id=v_checkout.checkout_id;
  update public.payments set
    status=(case when v_state='refunded' then 'refunded' else 'partially_paid' end)::public.payment_status,
    transaction_reference=p_payment_id,verified_at=now()
  where order_id=v_checkout.order_id and method='razorpay' and amount*100=p_amount_paise;
  get diagnostics v_updated = row_count;
  if v_updated<>1 then raise exception 'Checkout refund payment record could not be reconciled'; end if;

  update public.orders set
    status=(case when v_state='refunded' then 'refunded' else 'cancelled' end)::public.order_status,
    payment_status=(case when v_state='refunded' then 'refunded' else 'partially_paid' end)::public.payment_status,
    updated_at=now() where id=v_checkout.order_id;
  update public.whatsapp_notifications set status='failed',error_message='Payment refunded; invoice delivery stopped'
  where order_id=v_checkout.order_id and notification_type='payment_receipt' and status='pending';
  return jsonb_build_object('paid',false,'state',v_state,'order_number',v_number);
end;
$$;

create or replace function public.expire_manual_upi_checkouts(p_limit integer default 100)
returns integer language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare
  v_requests uuid[];
  v_request record;
  v_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid cleanup limit.'; end if;
  select array_agg(due.checkout_id) into v_requests
  from (
    select r.checkout_id from public.manual_upi_checkout_requests r
    join public.orders o on o.id=r.order_id
    where r.reservation_released_at is null and r.created_at<now()-interval '24 hours'
      and o.status='pending' and o.payment_status='pending'
    order by r.created_at,r.checkout_id
    limit p_limit for update of r skip locked
  ) due;
  if v_requests is null then return 0; end if;

  perform 1 from public.orders o
  where o.id in (select r.order_id from public.manual_upi_checkout_requests r where r.checkout_id=any(v_requests))
  order by o.id for update;
  perform 1 from public.product_variants pv
  where pv.id in (
    select oi.variant_id from public.order_items oi
    join public.manual_upi_checkout_requests r on r.order_id=oi.order_id
    where r.checkout_id=any(v_requests)
  ) order by pv.id for update;

  for v_request in
    select r.checkout_id,r.order_id from public.manual_upi_checkout_requests r
    join public.orders o on o.id=r.order_id
    where r.checkout_id=any(v_requests) and o.status='pending' and o.payment_status='pending'
    order by r.checkout_id
  loop
    perform app_private.cancel_unpaid_online_inventory(v_request.order_id,'upi');
    update public.manual_upi_checkout_requests set reservation_released_at=now()
    where checkout_id=v_request.checkout_id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.cancel_unpaid_manual_upi_order(p_order_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_order public.orders%rowtype;
begin
  if not app_private.erp_is_admin() then
    raise exception 'Admin access is required' using errcode='42501';
  end if;
  -- Match the scheduler's request -> order -> variant ordering.
  perform 1 from public.manual_upi_checkout_requests where order_id=p_order_id for update;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.source<>'online' or not exists(
    select 1 from public.payments where order_id=p_order_id and method='upi'
  ) or exists(
    select 1 from public.razorpay_checkouts where order_id=p_order_id
  ) then
    raise exception 'Manual UPI order not found';
  end if;
  if v_order.status='cancelled' and v_order.payment_status='failed' then
    return jsonb_build_object('success',true,'already_cancelled',true);
  end if;
  perform app_private.cancel_unpaid_online_inventory(p_order_id,'upi');
  update public.manual_upi_checkout_requests set reservation_released_at=now()
  where order_id=p_order_id;
  return jsonb_build_object('success',true,'already_cancelled',false);
end;
$$;
revoke all on function public.cancel_unpaid_manual_upi_order(uuid) from public,anon,authenticated;
grant execute on function public.cancel_unpaid_manual_upi_order(uuid) to authenticated;

commit;
