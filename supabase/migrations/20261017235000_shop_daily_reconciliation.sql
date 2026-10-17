-- Operational reconciliation: read-only diagnostics, not a tax/financial statement.
-- Staged only; depends on Phase 2 journal and Phase 5A goods receipts.
begin;

create or replace function public.shop_daily_reconciliation(p_day date)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid:=auth.uid();
 v_start timestamptz;
 v_end timestamptz;
 v_orders integer;v_sales_total numeric(16,2);
 v_payments integer;v_tenders_total numeric(16,2);
 v_cash numeric(16,2);v_upi numeric(16,2);v_card numeric(16,2);
 v_pending integer;v_unbalanced integer;v_unknown integer;v_stock_gap integer;
 v_receipt_missing integer;v_source_gap integer;v_duplicate_payment_refs integer;
begin
 if v_actor is null or not exists(
  select 1 from public.staff_profiles s where s.user_id=v_actor
  and s.active=true and s.role='admin'
 ) then raise exception 'Only active administrators may read reconciliation'
  using errcode='42501'; end if;
 if p_day is null or p_day < (now() at time zone 'Asia/Kolkata')::date-365
   or p_day > (now() at time zone 'Asia/Kolkata')::date then
  raise exception 'Select a day from the last 365 days' using errcode='22023';
 end if;
 v_start:=p_day::timestamp at time zone 'Asia/Kolkata';
 v_end:=(p_day+1)::timestamp at time zone 'Asia/Kolkata';

 -- Orders dated within this day do not necessarily settle the same day.
 select count(*),coalesce(sum(o.total_amount),0)::numeric(16,2)
 into v_orders,v_sales_total from public.orders o
 where o.created_at>=v_start and o.created_at<v_end
 and o.payment_status='paid';
 -- Payment timestamps may be later than order creation. Do not force totals equal.
 select count(*),coalesce(sum(p.amount),0)::numeric(16,2),
 coalesce(sum(p.amount) filter(where p.method='cash'),0)::numeric(16,2),
 coalesce(sum(p.amount) filter(where p.method='upi'),0)::numeric(16,2),
 coalesce(sum(p.amount) filter(where p.method='card'),0)::numeric(16,2)
 into v_payments,v_tenders_total,v_cash,v_upi,v_card
 from public.payments p
 where p.status='paid'
 and coalesce(p.paid_at,p.created_at)>=v_start
 and coalesce(p.paid_at,p.created_at)<v_end;
 select count(*) into v_pending from public.orders o
 where o.created_at>=v_start and o.created_at<v_end
  and o.payment_status='pending';

 -- Legacy movements with absent quantity delta are identified, not rewritten.
 select count(*) filter(where it.stock_before is null or it.stock_after is null
      or it.quantity_delta is null),
 count(*) filter(where it.stock_before is not null and it.stock_after is not null
    and it.quantity_delta is not null
    and it.stock_after-it.stock_before<>it.quantity_delta)
 into v_unknown,v_unbalanced from public.inventory_transactions it
 where it.created_at>=v_start and it.created_at<v_end;

 -- Check the latest DATABASE stock event, not the optional business ledger.
 -- A missing event or mismatch means a possible bypass / broken trigger.
 select count(*) into v_stock_gap from public.product_variants pv
 left join lateral (
   select e.stock_after,e.id from public.stock_change_events e
   where e.variant_id=pv.id order by e.id desc limit 1
 ) latest on true
 where latest.id is null or latest.stock_after is distinct from pv.stock_quantity;

 -- Each recorded goods receipt line must have one linked movement, if the
 -- Phase 5A migration has been installed.
 select count(*) into v_receipt_missing
 from public.goods_receipt_lines gl
 left join public.inventory_transactions it
  on it.reference_goods_receipt_line_id=gl.id
 where it.id is null;

 -- Historic online orders from before Phase 3 may legitimately lack this;
 -- these are EXCEPTIONS FOR INVESTIGATION, not proof of stock loss.
 select count(*) into v_source_gap
 from public.order_items oi join public.orders o on o.id=oi.order_id
 where o.source='online' and o.created_at>=v_start and o.created_at<v_end
 and not exists(select 1 from public.inventory_transactions it
  where it.reference_order_id=o.id
  and it.variant_id=oi.variant_id and it.transaction_type='sale_online');

 -- Repeated paid references merit manual gateway/UPI settlement verification.
 select count(*) into v_duplicate_payment_refs from (
  select p.method,p.transaction_reference
  from public.payments p
  where p.status='paid' and p.transaction_reference is not null
  and length(btrim(p.transaction_reference))>0
  group by p.method,p.transaction_reference having count(*)>1
 ) x;

 return jsonb_build_object(
  'day',p_day::text,'timezone','Asia/Kolkata','generated_at',now(),
  'settled_orders_created_that_day',v_orders,
  'settled_order_face_value',v_sales_total,
  'paid_tenders_posted_that_day',v_payments,
  'paid_tenders_total',v_tenders_total,
  'cash_tender',v_cash,'upi_tender',v_upi,'card_tender',v_card,
  'orders_pending_payment',v_pending,
  'diagnostics',jsonb_build_object(
    'legacy_missing_signed_movements',v_unknown,
    'unbalanced_signed_movements',v_unbalanced,
    'stock_snapshot_mismatches',v_stock_gap,
    'goods_receipt_lines_without_movement',v_receipt_missing,
    'online_lines_without_source_movement',v_source_gap,
    'reused_paid_payment_references',v_duplicate_payment_refs
  ),
  'notes','Read-only exception indicators. Historic gaps and settlement timing do not alone prove discrepancies. Verify bank/UPI and accountant-approved GST books independently.'
 );
end;
$fn$;

revoke all on function public.shop_daily_reconciliation(date)
 from public,anon,authenticated;
grant execute on function public.shop_daily_reconciliation(date)
 to authenticated;
commit;
