-- Aggregate diagnostics. Run as a database operator and record before/after.
\set ON_ERROR_STOP on
begin read only;
select enabled as erp_active, shared_branch_stock as shared_stock
from app_private.erp_activation_state where singleton;

select l.kind,l.active,coalesce(sum(b.on_hand),0) as on_hand,
 coalesce(sum(b.reserved),0) as reserved
from public.erp_locations l left join public.erp_stock_balances b on l.id=b.location_id
group by l.kind,l.active order by l.kind,l.active;

select src.kind as from_kind,dst.kind as to_kind,count(*) as transfers,sum(t.quantity) as units
from public.erp_transfers t
join public.erp_locations src on src.id=t.from_location
join public.erp_locations dst on dst.id=t.to_location
where t.status='in_transit' group by src.kind,dst.kind order by src.kind,dst.kind;

select status,count(*) as checkouts from public.razorpay_checkouts
where status in ('creating','ready','refund_required') group by status order by status;
select count(*) as pending_manual_upi
from public.manual_upi_checkout_requests r join public.orders o on o.id=r.order_id
where o.status='pending' and o.payment_status='pending';

with holds as (
 select location_id,variant_id,sum(quantity) as quantity
 from app_private.erp_shared_order_reservations where state='reserved'
 group by location_id,variant_id
)
select count(*) filter(where coalesce(b.reserved,0)<>coalesce(h.quantity,0)) as branch_reservation_mismatches
from public.erp_stock_balances b
full join holds h using (location_id,variant_id)
join public.erp_locations l on l.id=coalesce(b.location_id,h.location_id)
where l.kind='branch';

select count(*) as stock_mirror_mismatches
from public.product_variants v
where v.stock_quantity is distinct from case when app_private.erp_shared_branch_stock()
 then app_private.erp_shared_available(v.id)
 else coalesce((
  select sum(b.on_hand-b.reserved)::integer
  from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id
  where l.kind='online' and l.active and b.variant_id=v.id
 ),0)
end;
commit;
