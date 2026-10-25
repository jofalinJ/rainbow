-- STAGED admin aggregate RPC: exact totals without downloading full order tables.
create or replace function public.get_admin_operational_metrics()
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog, public as $$
declare
  v_start timestamptz := date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_admin() then
    raise exception 'Only the administrator may read aggregate reports' using errcode='42501';
  end if;
  return jsonb_build_object(
    'products', (select count(*) from public.products where active=true),
    'orders', (select count(*) from public.orders),
    'today_orders', (select count(*) from public.orders
      where created_at>=v_start and status::text not in ('cancelled','refunded')),
    'today_sales', (select coalesce(sum(total_amount),0) from public.orders
      where created_at>=v_start and payment_status='paid' and status::text not in ('cancelled','refunded')),
    'total_sales', (select coalesce(sum(total_amount),0) from public.orders
      where payment_status='paid' and status::text not in ('cancelled','refunded')),
    'low_stock', (select count(*) from public.low_stock_products)
  );
end $$;
revoke all on function public.get_admin_operational_metrics() from public, anon;
grant execute on function public.get_admin_operational_metrics() to authenticated;
