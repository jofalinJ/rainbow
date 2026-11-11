-- Keep new online checkouts paused. Drain verified payments, expiry, cancellation
-- and refund review before running this guarded, transactional rollback.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
lock table app_private.erp_activation_state, app_private.erp_shared_order_reservations,
 public.product_variants, public.erp_locations, public.erp_stock_balances,
 public.erp_online_listings, public.erp_online_reservations, public.erp_transfers,
 public.razorpay_checkouts, public.manual_upi_checkout_requests,
 public.orders, public.order_items, public.payments
 in access exclusive mode nowait;

do $$
begin
 if not app_private.erp_live() or not app_private.erp_shared_branch_stock() then
  raise exception 'Shared stock must be active to roll back';
 end if;
 if exists(select 1 from app_private.erp_shared_order_reservations where state='reserved')
 or exists(select 1 from public.erp_online_reservations where state='reserved')
 or exists(select 1 from public.erp_stock_balances where reserved<>0)
 or exists(select 1 from public.razorpay_checkouts where status in ('creating','ready','refund_required'))
 or exists(
  select 1 from public.orders where source='online'
  and status not in ('cancelled','refunded','delivered')
  and payment_status not in ('paid','failed','refunded')
 ) then raise exception 'Drain online payments and stock holds before rollback'; end if;
 if exists(
  select 1 from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id
  where l.kind='online' and b.on_hand<>0
 ) or exists(
  select 1 from public.erp_transfers t
  join public.erp_locations src on src.id=t.from_location
  join public.erp_locations dst on dst.id=t.to_location
  where t.status='in_transit' and (src.kind='online' or dst.kind='online')
 ) then raise exception 'Unexpected Online Store stock or transfers require review before rollback'; end if;
 if exists(select 1 from public.product_variants v
  where v.stock_quantity is distinct from app_private.erp_shared_available(v.id)
 ) then raise exception 'Shared stock mirror is inconsistent. Review before rollback'; end if;
end $$;

update app_private.erp_activation_state set shared_branch_stock=false where singleton and enabled;
select set_config('erp.stock_origin','erp',true);
-- The cutover guards require the legacy pool to be empty. The rollback restores
-- its zero availability while preserving all physical balances and history.
update public.product_variants set stock_quantity=0, updated_at=now() where stock_quantity<>0;
select set_config('erp.stock_origin','',true);

do $$
begin
 if app_private.erp_shared_branch_stock()
 or exists(select 1 from public.product_variants where stock_quantity<>0) then
  raise exception 'Shared stock rollback or mirror validation failed';
 end if;
end $$;
commit;
