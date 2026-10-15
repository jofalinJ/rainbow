-- Safe admin-only manual state changes for ONLINE orders; manual dispatch remains in save_order_shipment.
-- Existing order rows, invoices and stock are untouched.
create table if not exists public.online_order_status_events (
 id bigint generated always as identity primary key,
 order_id uuid not null references public.orders(id) on delete cascade,
 previous_status public.order_status not null,
 new_status public.order_status not null,
 actor_id uuid not null references auth.users(id),
 changed_at timestamptz not null default now()
);
create index if not exists idx_online_order_status_events_order
  on public.online_order_status_events(order_id,changed_at desc);
alter table public.online_order_status_events enable row level security;
revoke all on public.online_order_status_events from public,anon,authenticated;
grant select on public.online_order_status_events to authenticated;
drop policy if exists "Active admins inspect manual order status history" on public.online_order_status_events;
create policy "Active admins inspect manual order status history"
on public.online_order_status_events for select to authenticated
using(exists(select 1 from public.staff_profiles sp
 where sp.user_id=(select auth.uid()) and sp.active and sp.role='admin'));

create or replace function public.update_online_order_status(
  p_order_id uuid,p_next_status text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();
  v_order public.orders%rowtype;
  v_next public.order_status;
begin
  if v_actor is null or not exists(select 1 from public.staff_profiles sp
    where sp.user_id=v_actor and sp.active and sp.role='admin') then
    raise exception 'Only an active administrator can change online order status'
      using errcode='42501';
  end if;
  if p_next_status is null or p_next_status not in ('pending','confirmed','processing','shipped','delivered') then
    raise exception 'Invalid manual status. Use the dedicated cancellation/refund workflow for those actions';
  end if;
  v_next:=p_next_status::public.order_status;
  select * into v_order from public.orders where id=p_order_id and source='online'
    for update;
  if not found then raise exception 'Online order not found'; end if;
  if v_order.status=v_next then
    return jsonb_build_object('changed',false,'status',v_order.status);
  end if;
  if v_order.status in ('cancelled','refunded','delivered') then
    raise exception 'This order has a terminal status; do not change it manually';
  end if;
  if v_order.payment_status<>'paid' then
    raise exception 'Verify the customer payment before confirming or processing this order';
  end if;
  if not ((v_order.status='pending' and v_next in ('confirmed','processing'))
    or (v_order.status='confirmed' and v_next='processing')) then
    raise exception 'Unsupported status transition. Use Manage Shipment for dispatch and delivery';
  end if;
  update public.orders set status=v_next,updated_at=now() where id=p_order_id;
  insert into public.online_order_status_events(order_id,previous_status,new_status,actor_id)
    values(p_order_id,v_order.status,v_next,v_actor);
  return jsonb_build_object('changed',true,'status',v_next);
end; $$;
revoke all on function public.update_online_order_status(uuid,text)
 from public,anon,authenticated;
grant execute on function public.update_online_order_status(uuid,text)
 to authenticated;
