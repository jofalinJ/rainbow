-- Staged admin branch summary used by existing Dashboard and Reports pages.
begin;
create or replace function public.erp_location_summary()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,app_private as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not app_private.erp_is_admin()
 then raise exception 'Admin only' using errcode='42501'; end if;
 with locations as (
   select l.id,l.name,l.code,l.kind,
    coalesce((select sum(b.on_hand) from public.erp_stock_balances b where b.location_id=l.id),0)::bigint as on_hand,
    coalesce((select sum(b.reserved) from public.erp_stock_balances b where b.location_id=l.id),0)::bigint as reserved,
    coalesce((select count(*) from public.erp_stock_balances b where b.location_id=l.id),0)::bigint as variants,
    coalesce((select count(*) from public.erp_stock_balances b
      left join public.erp_reorder_settings cfg using(location_id,variant_id)
      where b.location_id=l.id and (b.on_hand-b.reserved)<=coalesce(cfg.minimum_qty,3)),0)::bigint as low_stock,
    coalesce((select sum(t.quantity) from public.erp_transfers t
      where t.to_location=l.id and t.status='in_transit'),0)::bigint as incoming
   from public.erp_locations l where l.active
 )
 select jsonb_build_object(
  'locations',coalesce(jsonb_agg(jsonb_build_object(
     'id',id,'name',name,'code',code,'kind',kind,
     'on_hand',on_hand,'reserved',reserved,
     'available',on_hand-reserved,'variants',variants,
     'low_stock',low_stock,'incoming',incoming)
     order by name),'[]'::jsonb),
  'company_on_hand',coalesce(sum(on_hand),0),
  'company_reserved',coalesce(sum(reserved),0),
  'company_in_transit',coalesce(sum(incoming),0),
  'company_owned',coalesce(sum(on_hand+incoming),0))
 into result from locations;
 return result;
end $$;
revoke all on function public.erp_location_summary() from public,anon,authenticated;
grant execute on function public.erp_location_summary() to authenticated;
commit;
