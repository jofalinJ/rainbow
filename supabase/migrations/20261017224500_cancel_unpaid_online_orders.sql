-- Phase 4: admin-only, exactly-once cancellation of UNPAID, unshipped
-- online orders whose stock allocation ledger is complete.
-- This migration is staged on a feature branch; DO NOT run on production.
-- Requires 20261017223000_online_order_source_ledger.sql and
-- 20261015201000_secure_online_order_status.sql.
begin;

create table if not exists public.online_order_cancellations (
  order_id uuid primary key references public.orders(id),
  actor_id uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 12 and 240),
  payment_checked boolean not null check (payment_checked = true),
  released_variant_count integer not null check (released_variant_count > 0),
  cancelled_at timestamptz not null default now()
);
create index if not exists online_order_cancellations_actor_idx
  on public.online_order_cancellations(actor_id,cancelled_at desc);
alter table public.online_order_cancellations enable row level security;

-- The event cannot be directly written from any browser role. Admins can
-- inspect it through policy; the SECURITY DEFINER RPC is the sole write path.
revoke all on table public.online_order_cancellations from public,anon,authenticated;
grant select on table public.online_order_cancellations to authenticated;
drop policy if exists "Active admins read online cancellations"
  on public.online_order_cancellations;
create policy "Active admins read online cancellations"
  on public.online_order_cancellations for select to authenticated
  using (exists (
    select 1 from public.staff_profiles p
    where p.user_id=(select auth.uid()) and p.active=true and p.role='admin'
  ));

create or replace function public.cancel_unpaid_online_order(
  p_order_id uuid, p_reason text, p_payment_checked boolean
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_order public.orders%rowtype;
  v_line record;
  v_before integer;
  v_after bigint;
  v_ledger_quantity integer;
  v_ledger_count integer;
  v_released integer := 0;
begin
  if v_actor is null or not exists (
    select 1 from public.staff_profiles s
    where s.user_id=v_actor and s.active=true and s.role='admin'
  ) then
    raise exception 'Only an active administrator may cancel online orders'
      using errcode='42501';
  end if;
  if p_order_id is null then
    raise exception 'Select an order to cancel' using errcode='22023';
  end if;

  -- Serialize with verify_online_order_payment and shipment/status RPCs.
  select * into v_order
  from public.orders
  where id=p_order_id and source='online'
  for update;
  if not found then
    raise exception 'Online order not found' using errcode='22023';
  end if;

  -- A duplicate request must NEVER restore stock a second time.
  if v_order.status='cancelled' then
    select released_variant_count into v_released
    from public.online_order_cancellations where order_id=p_order_id;
    if not found then
      raise exception 'Legacy cancelled order needs manual inventory reconciliation'
        using errcode='23514';
    end if;
    return jsonb_build_object(
      'cancelled',true,'already_cancelled',true,
      'order_id',p_order_id,'order_number',v_order.order_number,
      'released_variants',v_released
    );
  end if;

  if v_order.status <> 'pending' or v_order.payment_status <> 'pending' then
    raise exception 'Only pending, unverified online orders can be cancelled'
      using errcode='23514';
  end if;
  if p_payment_checked is distinct from true then
    raise exception 'Check the actual UPI/bank statement before cancelling'
      using errcode='22023';
  end if;
  if length(v_reason) < 12 or length(v_reason) > 240 then
    raise exception 'Enter a cancellation reason between 12 and 240 characters'
      using errcode='22023';
  end if;
  if exists (
    select 1 from public.order_shipments sh where sh.order_id=p_order_id
  ) then
    raise exception 'Order has shipping records; use manual stock reconciliation'
      using errcode='23514';
  end if;
  -- A submitted UPI reference is NOT proof of payment. Any payment evidence
  -- indicating paid/verified/partial/failed must be reviewed separately.
  if not exists (
    select 1 from public.payments pay
    where pay.order_id=p_order_id and pay.status='pending'
  ) or exists (
    select 1 from public.payments pay
    where pay.order_id=p_order_id
      and (pay.status <> 'pending' or pay.paid_at is not null
        or pay.verified_at is not null)
  ) then
    raise exception 'Payment record needs manual settlement review'
      using errcode='23514';
  end if;
  if not exists (
    select 1 from public.order_items oi where oi.order_id=p_order_id
  ) then
    raise exception 'Order has no line items; manual review required'
      using errcode='23514';
  end if;
  -- Historical orders before Phase 3 have no reliable allocation ledger.
  -- Reject those orders: stock must NEVER be inferred from order lines alone.
  if exists (
    select 1
    from (
      select oi.variant_id,sum(oi.quantity)::integer as qty
      from public.order_items oi
      where oi.order_id=p_order_id
      group by oi.variant_id
    ) li
    left join public.inventory_transactions it
      on it.reference_order_id=p_order_id
     and it.variant_id=li.variant_id
     and it.transaction_type='sale_online'
    group by li.variant_id,li.qty
    having count(it.id) <> 1 or coalesce(max(it.quantity),-1) <> li.qty
  ) or exists (
    select 1 from public.inventory_transactions it
    where it.reference_order_id=p_order_id
      and it.transaction_type='sale_online'
      and not exists (
        select 1 from public.order_items oi
        where oi.order_id=p_order_id and oi.variant_id=it.variant_id
      )
  ) then
    raise exception 'Stock allocation records incomplete; reconcile manually'
      using errcode='23514';
  end if;
  if exists (
    select 1 from public.inventory_transactions it
    where it.reference_order_id=p_order_id and it.transaction_type='return'
  ) then
    raise exception 'An order-linked stock return already exists; reconcile manually'
      using errcode='23514';
  end if;

  -- Lock each variant in stable UUID order; inventory changes are atomic
  -- with both the cancellation audit and terminal order status.
  for v_line in
    select oi.variant_id,sum(oi.quantity)::integer as qty
    from public.order_items oi
    where oi.order_id=p_order_id
    group by oi.variant_id
    order by oi.variant_id
  loop
    select pv.stock_quantity into v_before
    from public.product_variants pv
    where pv.id=v_line.variant_id
    for update;
    if not found then
      raise exception 'Variant missing; cannot automatically restore stock'
        using errcode='23514';
    end if;
    v_after:=v_before::bigint+v_line.qty::bigint;
    if v_after > 1000000000 then
      raise exception 'Restored stock outside supported range'
        using errcode='22003';
    end if;
    update public.product_variants
      set stock_quantity=v_after::integer,updated_at=now()
      where id=v_line.variant_id;

    insert into public.inventory_transactions(
      variant_id,transaction_type,quantity,quantity_delta,
      stock_before,stock_after,reference_order_id,reason,created_by
    ) values (
      v_line.variant_id,'return',v_line.qty,v_line.qty,
      v_before,v_after::integer,p_order_id,
      'Online cancellation: '||v_reason,v_actor
    );
    v_released:=v_released+1;
  end loop;

  -- The parent row is locked; unique order_id also guards double issuance.
  insert into public.online_order_cancellations(
    order_id,actor_id,reason,payment_checked,released_variant_count
  ) values(p_order_id,v_actor,v_reason,true,v_released);

  update public.orders set status='cancelled',updated_at=now()
  where id=p_order_id;
  insert into public.online_order_status_events(
    order_id,previous_status,new_status,actor_id
  ) values(p_order_id,'pending','cancelled',v_actor);

  -- Keep payment_status/payments untouched. No gateway settlement was proven.
  return jsonb_build_object(
    'cancelled',true,'already_cancelled',false,
    'order_id',p_order_id,'order_number',v_order.order_number,
    'released_variants',v_released
  );
end;
$function$;

revoke all on function public.cancel_unpaid_online_order(uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.cancel_unpaid_online_order(uuid,text,boolean)
  to authenticated;
commit;
