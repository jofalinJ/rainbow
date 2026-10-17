-- Admin-only discrepancy report: staging migration.
create or replace function public.inventory_variance_report(p_limit int default 500)
returns table(variant_id uuid,actual_qty int,recorded_qty int,status text)
language sql security definer set search_path=''
as $$
 select v.id,v.stock_quantity,a.stock_after,
 case when a.id is null then 'AUDIT_MISSING'
 when a.stock_after is distinct from v.stock_quantity then 'MISMATCH'
 else 'MATCH' end
 from public.product_variants v
 left join lateral(
  select e.id,e.stock_after from public.stock_change_events e
  where e.variant_id=v.id order by e.id desc limit 1
 ) a on true
 where exists(select 1 from public.staff_profiles p
 where p.user_id=auth.uid() and p.active=true and p.role='admin')
 order by v.id limit least(greatest(coalesce(p_limit,500),1),5000)
$$;
revoke all on function public.inventory_variance_report(int) from public,anon,authenticated;
grant execute on function public.inventory_variance_report(int) to authenticated;
