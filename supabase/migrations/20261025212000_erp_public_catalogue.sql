-- Public online catalogue projection. This RPC is for the Cloudflare Worker only.
-- Do not turn on the ERP_CATALOGUE_ENABLED Worker flag until the
-- legacy product inventory and Razorpay checkout have been cut over safely.
begin;
create or replace function public.erp_public_catalogue(p_page integer default 0,p_limit integer default 24,p_search text default '')
returns jsonb language sql stable security definer
set search_path=pg_catalog,public as $$
with bounds as (
 select greatest(0,least(coalesce(p_page,0),10000)) as page,
        greatest(1,least(coalesce(p_limit,24),48)) as page_size,
        left(btrim(coalesce(p_search,'')),70) as term
), listing as (
 select p.id as product_id,p.product_code,p.product_name,
        v.id as variant_id,v.color,v.size,v.barcode,
        coalesce(l.online_price,p.selling_price) as price,
        greatest(0,coalesce(b.on_hand-b.reserved,0)) as available,
        image.public_url as primary_image
 from public.erp_online_listings l
 join public.products p on p.id=l.product_id and p.active
 join public.product_variants v on v.product_id=p.id and v.active
 cross join bounds limit_options
 join public.erp_locations ol on ol.kind='online' and ol.active
 left join public.erp_stock_balances b on b.location_id=ol.id and b.variant_id=v.id
 left join lateral (
   select pi.public_url from public.product_images pi
   where pi.product_id=p.id
   order by pi.is_primary desc nulls last,pi.sort_order,pi.id limit 1
 ) image on true
 where l.published and (limit_options.term='' or
 p.product_code ilike '%'||limit_options.term||'%' or
 p.product_name ilike '%'||limit_options.term||'%')
 order by p.product_code,v.id
 limit (select page_size from bounds)
 offset (select page*page_size from bounds)
)
select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(listing)),'[]'::jsonb),
'page',(select page from bounds),'page_size',(select page_size from bounds)) from listing;
$$;
revoke all on function public.erp_public_catalogue(integer,integer,text) from public,anon,authenticated;
grant execute on function public.erp_public_catalogue(integer,integer,text) to service_role;
commit;
