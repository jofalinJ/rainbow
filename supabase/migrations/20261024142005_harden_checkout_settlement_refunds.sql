-- Follow-up to finalize_paid_orders_invoice_whatsapp. Generated with the Supabase
-- CLI, then ordered after its prerequisite (whose timestamp is ahead of UTC).
-- No provider payments, refunds or WhatsApp sends are initiated by this migration.
alter table public.razorpay_checkouts
  add column if not exists reservation_released_at timestamptz,
  add column if not exists amount_refunded_paise bigint not null default 0,
  add column if not exists last_refund_id text;
alter table public.razorpay_checkouts drop constraint if exists razorpay_checkouts_status_check;
alter table public.razorpay_checkouts add constraint razorpay_checkouts_status_check
  check(status in ('creating','ready','paid','expired','refund_required','refunded'));
alter table public.razorpay_checkouts add constraint razorpay_checkouts_refund_amount_check
  check(amount_refunded_paise between 0 and amount_paise);

-- Earlier cleanup already returned expired reservations. Mark them so upgrading
-- never credits that stock twice. Late captures after old cleanup kept cancelled.
update public.razorpay_checkouts rc set reservation_released_at=rc.updated_at
from public.orders o where o.id=rc.order_id and rc.reservation_released_at is null
  and (rc.status='expired' or (rc.status='refund_required' and o.status='cancelled'));

create or replace function app_private.release_razorpay_reservation(p_checkout_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_checkout public.razorpay_checkouts%rowtype; v_item record;
begin
  select * into v_checkout from public.razorpay_checkouts
    where checkout_id=p_checkout_id for update;
  if not found or v_checkout.reservation_released_at is not null
    or v_checkout.status in ('paid','refunded')
    or exists(select 1 from public.inventory_transactions it
      where it.reference_order_id=v_checkout.order_id and it.transaction_type='sale_online')
  then return false; end if;
  for v_item in select variant_id,quantity from public.order_items
    where order_id=v_checkout.order_id order by variant_id loop
    update public.product_variants set stock_quantity=stock_quantity+v_item.quantity,
      updated_at=now() where id=v_item.variant_id;
  end loop;
  update public.razorpay_checkouts set reservation_released_at=now()
    where checkout_id=p_checkout_id;
  return true;
end $$;
revoke all on function app_private.release_razorpay_reservation(uuid) from public,anon,authenticated;

create or replace function public.complete_razorpay_checkout(
  p_gateway_order_id text,p_payment_id text,p_amount_paise bigint,p_event_id text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_checkout public.razorpay_checkouts%rowtype; v_number text;
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
  select order_number into v_number from public.orders where id=v_checkout.order_id;
  if v_checkout.status in ('paid','refund_required','refunded') then
    if v_checkout.gateway_payment_id is distinct from p_payment_id then
      raise exception 'Another payment was recorded for this order. Investigate and refund.';
    end if;
    return jsonb_build_object('paid',v_checkout.status='paid','state',v_checkout.status,'order_number',v_number);
  end if;
  if v_checkout.status not in ('ready','expired') then
    raise exception 'Checkout is not ready for settlement.';
  end if;
  if v_checkout.status='expired' or v_checkout.expires_at<=now() then
    -- Capture can beat the cleanup job after expiry: return the still-reserved
    -- stock here, under the same checkout lock, before changing its state.
    perform app_private.release_razorpay_reservation(v_checkout.checkout_id);
    update public.razorpay_checkouts set status='refund_required',gateway_payment_id=p_payment_id,
      last_event_id=p_event_id,paid_at=now(),updated_at=now()
      where checkout_id=v_checkout.checkout_id;
    update public.payments set status='paid',transaction_reference=p_payment_id,
      paid_at=now(),verified_at=now() where order_id=v_checkout.order_id and method='razorpay';
    update public.orders set status='cancelled',payment_status='paid',updated_at=now()
      where id=v_checkout.order_id;
    return jsonb_build_object('paid',false,'state','refund_required','order_number',v_number);
  end if;
  update public.razorpay_checkouts set status='paid',gateway_payment_id=p_payment_id,
    last_event_id=p_event_id,paid_at=now(),updated_at=now()
    where checkout_id=v_checkout.checkout_id;
  update public.payments set status='paid',transaction_reference=p_payment_id,
    paid_at=now(),verified_at=now() where order_id=v_checkout.order_id and method='razorpay';
  update public.orders set payment_status='paid',updated_at=now() where id=v_checkout.order_id;
  return jsonb_build_object('paid',true,'state','paid','order_number',v_number);
end $$;
revoke all on function public.complete_razorpay_checkout(text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.complete_razorpay_checkout(text,text,bigint,text) to service_role;

create or replace function public.expire_razorpay_checkouts(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_checkout record; v_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid cleanup limit.'; end if;
  for v_checkout in select checkout_id,order_id from public.razorpay_checkouts
    where status in ('creating','ready') and expires_at<now()-interval '10 minutes'
    order by expires_at limit p_limit for update skip locked loop
    perform app_private.release_razorpay_reservation(v_checkout.checkout_id);
    update public.razorpay_checkouts set status='expired',updated_at=now()
      where checkout_id=v_checkout.checkout_id;
    update public.orders set status='cancelled',payment_status='failed',updated_at=now()
      where id=v_checkout.order_id;
    update public.payments set status='failed' where order_id=v_checkout.order_id
      and method='razorpay' and status='pending';
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.expire_razorpay_checkouts(integer) from public,anon,authenticated;
grant execute on function public.expire_razorpay_checkouts(integer) to service_role;

-- Provider refunds are observations, never requests to move money. Cumulative
-- amount is fetched from Razorpay by the Worker, so reordered/repeated events
-- cannot undo a refund. Partial refunds stop fulfillment pending staff review.
create or replace function public.record_razorpay_refund(
  p_gateway_order_id text,p_payment_id text,p_amount_paise bigint,
  p_amount_refunded_paise bigint,p_event_id text default null,p_refund_id text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_checkout public.razorpay_checkouts%rowtype; v_number text; v_refunded bigint; v_state text;
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
  select order_number into v_number from public.orders where id=v_checkout.order_id;
  if v_checkout.status not in ('paid','refunded') then
    perform app_private.release_razorpay_reservation(v_checkout.checkout_id);
  end if;
  v_refunded:=greatest(v_checkout.amount_refunded_paise,p_amount_refunded_paise);
  v_state:=case when v_refunded=v_checkout.amount_paise then 'refunded' else 'refund_required' end;
  update public.razorpay_checkouts set status=v_state,gateway_payment_id=p_payment_id,
    amount_refunded_paise=v_refunded,
    last_event_id=case when p_amount_refunded_paise>=amount_refunded_paise then coalesce(p_event_id,last_event_id) else last_event_id end,
    last_refund_id=case when p_amount_refunded_paise>=amount_refunded_paise then coalesce(p_refund_id,last_refund_id) else last_refund_id end,
    updated_at=now()
    where checkout_id=v_checkout.checkout_id;
  update public.payments set
    status=(case when v_state='refunded' then 'refunded' else 'partially_paid' end)::public.payment_status,
    transaction_reference=p_payment_id,verified_at=now()
    where order_id=v_checkout.order_id and method='razorpay';
  update public.orders set
    status=(case when v_state='refunded' then 'refunded' else 'cancelled' end)::public.order_status,
    payment_status=(case when v_state='refunded' then 'refunded' else 'partially_paid' end)::public.payment_status,
    updated_at=now() where id=v_checkout.order_id;
  update public.whatsapp_notifications set status='failed',error_message='Payment refunded; invoice delivery stopped'
    where order_id=v_checkout.order_id and notification_type='payment_receipt' and status='pending';
  return jsonb_build_object('paid',false,'state',v_state,'order_number',v_number);
end $$;
revoke all on function public.record_razorpay_refund(text,text,bigint,bigint,text,text) from public,anon,authenticated;
grant execute on function public.record_razorpay_refund(text,text,bigint,bigint,text,text) to service_role;

create unique index if not exists idx_invoices_unique_public_token on public.invoices(public_token);

create or replace function public.claim_paid_invoice_whatsapp(
  p_limit integer default 5,p_allowed_numbers text[] default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized'; end if;
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid batch size'; end if;
  -- TEST mode requires a positive allowlist even if a backend caller forgets it.
  if coalesce(cardinality(p_allowed_numbers),0)=0 then return '[]'::jsonb; end if;
  with picked as (
    select n.id from public.whatsapp_notifications n
    join public.orders o on o.id=n.order_id
    join public.razorpay_checkouts rc on rc.order_id=o.id
    join public.invoices i on i.order_id=o.id
    where n.notification_type='payment_receipt' and n.status='pending'
      and n.send_started_at is null
      and regexp_replace(n.recipient_number,'[^0-9]','','g')=any(p_allowed_numbers)
      and o.payment_status='paid' and o.status in ('confirmed','processing','shipped','delivered')
      and rc.status='paid' and rc.amount_refunded_paise=0 and rc.reservation_released_at is null
      and rc.amount_paise=o.total_amount*100 and rc.whatsapp_opt_in
      and n.invoice_url='https://rainbowgoldcovering.com/invoice.html?token='||i.public_token::text
      and exists(select 1 from public.payments p where p.order_id=o.id and p.method='razorpay'
        and p.status='paid' and p.verified_at is not null and p.transaction_reference=rc.gateway_payment_id
        and p.amount=o.total_amount)
    order by n.created_at limit p_limit for update of n skip locked
  ), claimed as (
    update public.whatsapp_notifications n set send_started_at=now(),send_attempts=send_attempts+1
      from picked where n.id=picked.id
      returning n.id,n.order_id,n.recipient_number,n.invoice_url
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'recipient',x.recipient_number,'invoice_url',x.invoice_url,
    'order_number',o.order_number,'customer_name',c.name,
    'whatsapp_opt_in',true,'payment_verified',true
  )),'[]'::jsonb) into v_result
  from claimed x join public.orders o on o.id=x.order_id join public.customers c on c.id=o.customer_id;
  return v_result;
end $$;
revoke all on function public.claim_paid_invoice_whatsapp(integer,text[]) from public,anon,authenticated;
grant execute on function public.claim_paid_invoice_whatsapp(integer,text[]) to service_role;

-- Staff can verify only manual UPI transfers. Gateway records remain server-only.
create or replace function public.verify_online_order_payment(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_payment_id uuid;
begin
  if v_actor is null or not exists(select 1 from public.staff_profiles
    where user_id=v_actor and active and role='admin') then
    raise exception 'Only an active administrator can verify a manual UPI transfer.' using errcode='42501';
  end if;
  select * into v_order from public.orders where id=p_order_id and source='online' for update;
  if not found then raise exception 'Online order not found.'; end if;
  if exists(select 1 from public.razorpay_checkouts where order_id=p_order_id) then
    raise exception 'Razorpay payment must be independently verified by the payment backend.';
  end if;
  if v_order.status in ('cancelled','refunded') then raise exception 'Cancelled or refunded checkout cannot be verified.'; end if;
  if v_order.payment_status='paid' then
    if not exists(select 1 from public.payments p where p.order_id=p_order_id
      and p.method='upi' and p.status='paid' and p.verified_at is not null
      and p.verified_by is not null and p.amount=v_order.total_amount) then
      raise exception 'Paid flag has no matching staff-verified UPI transfer.';
    end if;
    return jsonb_build_object('success',true,'already_paid',true,'order_number',v_order.order_number);
  end if;
  select id into v_payment_id from public.payments
    where order_id=p_order_id and method='upi' and status='pending'
      and transaction_reference ~ '^[A-Za-z0-9-]{8,64}$' and amount=v_order.total_amount
    order by created_at desc limit 1 for update;
  if not found then raise exception 'No pending UPI transaction with the correct amount is attached.'; end if;
  update public.payments set status='paid',paid_at=coalesce(paid_at,now()),
    verified_by=v_actor,verified_at=now() where id=v_payment_id;
  update public.orders set payment_status='paid',updated_at=now() where id=p_order_id;
  return jsonb_build_object('success',true,'already_paid',false,'order_number',v_order.order_number);
end $$;
revoke all on function public.verify_online_order_payment(uuid) from public,anon,authenticated;
grant execute on function public.verify_online_order_payment(uuid) to authenticated;

create or replace function app_private.prevent_unpaid_online_fulfillment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.source='online' and new.status in ('confirmed','processing','shipped','delivered') then
    if new.payment_status<>'paid' or not (
      exists(select 1 from public.razorpay_checkouts rc join public.payments p on p.order_id=rc.order_id
        where rc.order_id=new.id and rc.status='paid' and rc.amount_refunded_paise=0
          and rc.reservation_released_at is null and rc.paid_at is not null
          and rc.amount_paise=new.total_amount*100
          and rc.gateway_payment_id=p.transaction_reference and p.method='razorpay'
          and p.status='paid' and p.verified_at is not null and p.amount=new.total_amount)
      or (not exists(select 1 from public.razorpay_checkouts rc where rc.order_id=new.id)
        and exists(select 1 from public.payments p where p.order_id=new.id
          and p.method='upi' and p.status='paid' and p.verified_by is not null
          and p.verified_at is not null and p.amount=new.total_amount))
    ) then raise exception 'Online fulfillment requires a server-verified captured payment or staff-verified UPI transfer.'; end if;
  end if;
  return new;
end $$;

-- Recheck evidence on financial/source edits too, not only status flags.
drop trigger if exists trg_prevent_unpaid_online_fulfillment on public.orders;
create trigger trg_prevent_unpaid_online_fulfillment
before insert or update on public.orders
for each row execute function app_private.prevent_unpaid_online_fulfillment();

-- Used only by the Worker after it validates the checkout recovery capability.
create or replace function public.get_razorpay_checkout(p_checkout_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_checkout record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  select rc.status,rc.gateway_order_id,rc.gateway_payment_id,rc.amount_paise,
    rc.expires_at,rc.reservation_released_at,o.order_number into v_checkout
  from public.razorpay_checkouts rc join public.orders o on o.id=rc.order_id
  where rc.checkout_id=p_checkout_id;
  if not found then return null; end if;
  return jsonb_build_object('state',v_checkout.status,
    'gateway_order_id',v_checkout.gateway_order_id,
    'gateway_payment_id',v_checkout.gateway_payment_id,
    'amount_paise',v_checkout.amount_paise,'expires_at',v_checkout.expires_at,
    'reservation_released_at',v_checkout.reservation_released_at,
    'order_number',v_checkout.order_number);
end $$;
revoke all on function public.get_razorpay_checkout(uuid) from public,anon,authenticated;
grant execute on function public.get_razorpay_checkout(uuid) to service_role;

-- Bound unverified manual UPI reservations too. Verification and cleanup share
-- the order row lock; cancelled checkouts require reconciliation rather than sale.
alter table public.manual_upi_checkout_requests
  add column if not exists reservation_released_at timestamptz;
create or replace function public.expire_manual_upi_checkouts(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_request record; v_order public.orders%rowtype; v_item record; v_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid cleanup limit.'; end if;
  for v_request in select r.checkout_id,r.order_id from public.manual_upi_checkout_requests r
    join public.orders o on o.id=r.order_id
    where r.reservation_released_at is null and r.created_at<now()-interval '24 hours'
      and o.status='pending' and o.payment_status='pending'
    order by r.created_at limit p_limit for update of r skip locked loop
    select * into v_order from public.orders where id=v_request.order_id for update;
    if v_order.status<>'pending' or v_order.payment_status<>'pending' then continue; end if;
    for v_item in select variant_id,quantity from public.order_items
      where order_id=v_request.order_id order by variant_id loop
      update public.product_variants set stock_quantity=stock_quantity+v_item.quantity,
        updated_at=now() where id=v_item.variant_id;
    end loop;
    update public.manual_upi_checkout_requests set reservation_released_at=now()
      where checkout_id=v_request.checkout_id;
    update public.orders set status='cancelled',payment_status='failed',updated_at=now()
      where id=v_request.order_id;
    update public.payments set status='failed' where order_id=v_request.order_id and method='upi' and status='pending';
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.expire_manual_upi_checkouts(integer) from public,anon,authenticated;
grant execute on function public.expire_manual_upi_checkouts(integer) to service_role;

-- Trigger functions must not be exposed as callable anonymous RPCs.
revoke all on function public.audit_order_shipment() from public,anon,authenticated;

-- Repair only the old, demonstrably unreleased late-capture case. Never touch
-- completed sales or historical delivered orders that require business review.
do $$ declare r record; begin
  for r in select rc.checkout_id from public.razorpay_checkouts rc
    join public.orders o on o.id=rc.order_id where rc.status='refund_required'
      and rc.reservation_released_at is null and o.status='pending' loop
    perform app_private.release_razorpay_reservation(r.checkout_id);
    update public.orders set status='cancelled',updated_at=now()
      where id=(select order_id from public.razorpay_checkouts where checkout_id=r.checkout_id);
  end loop;
end $$;

-- Browser admins must use the checked checkout/payment/status RPCs for online
-- commerce. Broad legacy admin ALL policies otherwise permit forged UPI evidence
-- or moving an online payment to a local-store order before rewriting it.
-- Restrictive policies compose with the existing admin/read policies. Definer
-- RPCs remain able to settle payments and local-store billing is unaffected.
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.order_items enable row level security;
create policy "Online orders insert through checked RPCs" on public.orders
  as restrictive for insert to authenticated with check (source<>'online');
create policy "Online orders update through checked RPCs" on public.orders
  as restrictive for update to authenticated using (source<>'online') with check (source<>'online');
create policy "Online orders delete through checked RPCs" on public.orders
  as restrictive for delete to authenticated using (source<>'online');
create policy "Online payments insert through checked RPCs" on public.payments
  as restrictive for insert to authenticated with check (exists(
    select 1 from public.orders o where o.id=order_id and o.source<>'online'));
create policy "Online payments update through checked RPCs" on public.payments
  as restrictive for update to authenticated using (exists(
    select 1 from public.orders o where o.id=order_id and o.source<>'online'))
  with check (exists(select 1 from public.orders o where o.id=order_id and o.source<>'online'));
create policy "Online payments delete through checked RPCs" on public.payments
  as restrictive for delete to authenticated using (exists(
    select 1 from public.orders o where o.id=order_id and o.source<>'online'));
create policy "Online items insert through checked RPCs" on public.order_items
  as restrictive for insert to authenticated with check (exists(
    select 1 from public.orders o where o.id=order_id and o.source<>'online'));
create policy "Online items update through checked RPCs" on public.order_items
  as restrictive for update to authenticated using (exists(
    select 1 from public.orders o where o.id=order_id and o.source<>'online'))
  with check (exists(select 1 from public.orders o where o.id=order_id and o.source<>'online'));
create policy "Online items delete through checked RPCs" on public.order_items
  as restrictive for delete to authenticated using (exists(
    select 1 from public.orders o where o.id=order_id and o.source<>'online'));

-- Guest checkout and phone-based lookups must pass the Worker's shared rate
-- limiter. Otherwise the legacy RPCs bypass API abuse limits entirely.
revoke all on function public.create_online_order(jsonb,jsonb,numeric),
  public.track_online_order(text,text),public.track_guest_order_shipments(text,text)
  from public,anon,authenticated;
grant execute on function public.create_online_order(jsonb,jsonb,numeric),
  public.track_online_order(text,text),public.track_guest_order_shipments(text,text)
  to service_role;

-- Narrow refund operations view for the active admin dashboard; no customer
-- contact, invoice tokens or direct access to private checkout rows is granted.
create or replace function public.get_razorpay_payment_review()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.staff_profiles sp
    where sp.user_id=auth.uid() and sp.active and sp.role='admin') then
    raise exception 'Only an active administrator can inspect payment reconciliation.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',rc.order_id,'checkout_status',rc.status,
    'gateway_order_id',rc.gateway_order_id,'gateway_payment_id',rc.gateway_payment_id,
    'amount_paise',rc.amount_paise,'amount_refunded_paise',rc.amount_refunded_paise,
    'last_refund_id',rc.last_refund_id) order by rc.updated_at desc),'[]'::jsonb)
    into v_result from public.razorpay_checkouts rc where rc.status in ('refund_required','refunded');
  return v_result;
end $$;
revoke all on function public.get_razorpay_payment_review() from public,anon,authenticated;
grant execute on function public.get_razorpay_payment_review() to authenticated;
