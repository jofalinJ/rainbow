-- Run only in a planned maintenance window after the rollout checks pass.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
-- NOWAIT avoids acquiring locks in the middle of an in-flight stock or order
-- operation. A failure rolls back the entire cutover and can be retried.
lock table app_private.erp_activation_state, app_private.erp_shared_order_reservations,
 public.product_variants, public.erp_locations, public.erp_stock_balances,
 public.erp_online_listings, public.erp_online_reservations, public.erp_transfers,
 public.razorpay_checkouts, public.manual_upi_checkout_requests,
 public.orders, public.order_items, public.payments
 in access exclusive mode nowait;

do $$
begin
 if not app_private.erp_live() then raise exception 'ERP inventory must be active'; end if;
 if app_private.erp_shared_branch_stock() then raise exception 'Shared stock is already active'; end if;
 if not exists(select 1 from public.erp_locations where kind='branch' and active) then
  raise exception 'No active physical shop is configured';
 end if;
 if exists(
  select 1 from public.erp_stock_balances b
  join public.erp_locations l on l.id=b.location_id
  where b.reserved<>0 or (b.on_hand<>0 and (l.kind='online' or not l.active))
 ) then raise exception 'Resolve existing stock holds and Online Store balances or inactive shop stock before activation'; end if;
 if exists(select 1 from public.erp_online_reservations where state='reserved')
 or exists(select 1 from app_private.erp_shared_order_reservations where state='reserved') then
  raise exception 'Resolve all inventory reservations before activation';
 end if;
 if exists(select 1 from public.razorpay_checkouts where status in ('creating','ready','refund_required')) then
  raise exception 'Resolve open Razorpay checkouts and refund reviews before activation';
 end if;
 if exists(
  select 1 from public.orders where source='online'
  and status not in ('cancelled','refunded','delivered')
  and payment_status not in ('paid','failed','refunded')
 ) then raise exception 'Resolve pending online orders before activation'; end if;
 if exists(
  select 1 from public.erp_transfers t
  join public.erp_locations src on src.id=t.from_location
  join public.erp_locations dst on dst.id=t.to_location
  where t.status='in_transit' and (src.kind='online' or dst.kind='online')
 ) then raise exception 'Resolve in-transit Online Store transfers before activation'; end if;
 if exists(select 1 from public.product_variants where stock_quantity<>0) then
  raise exception 'The legacy stock mirror does not agree with the empty Online Store';
 end if;
end $$;

update app_private.erp_activation_state set shared_branch_stock=true where singleton and enabled;

select set_config('erp.stock_origin','erp',true);
update public.product_variants v
set stock_quantity=app_private.erp_shared_available(v.id), updated_at=now()
where stock_quantity is distinct from app_private.erp_shared_available(v.id);
select set_config('erp.stock_origin','',true);

do $$
begin
 if not app_private.erp_shared_branch_stock()
 or exists(select 1 from public.product_variants v
  where v.stock_quantity is distinct from app_private.erp_shared_available(v.id)
 ) then raise exception 'Shared stock activation or mirror validation failed'; end if;
end $$;
commit;
