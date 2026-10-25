-- STAGED: read bounded inventory pages and exact category stock totals.
-- SECURITY INVOKER preserves product/variant RLS and checks active shop staff.
create or replace function public.search_inventory_variants(
  p_category_id uuid, p_search text default '',
  p_offset integer default 0, p_limit integer default 80
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog, public as $$
declare
  v_result jsonb;
  v_query text := '%' || coalesce(btrim(p_search),'') || '%';
begin
  if not (public.is_admin() or public.is_inventory_staff()) then
    raise exception 'Inventory access requires active shop staff' using errcode='42501';
  end if;
  with matched as (
    select v.id,v.color,v.size,v.length_cm,v.stock_quantity,v.low_stock_limit,
      v.barcode,v.created_at,
      jsonb_build_object(
        'id',p.id,'product_code',p.product_code,'product_name',p.product_name,
        'type',p.type,'category_id',p.category_id,'length_cm',p.length_cm,
        'thickness',p.thickness,'gold_amount_g',p.gold_amount_g
      ) as products
    from public.product_variants v
    join public.products p on p.id=v.product_id
    where p.category_id=p_category_id and p.active=true and v.active=true
      and (coalesce(btrim(p_search),'')=''
        or p.product_code ilike v_query or p.product_name ilike v_query
        or p.type ilike v_query or v.color ilike v_query
        or v.size ilike v_query or v.barcode ilike v_query)
  ), page as (
    select * from matched order by created_at desc,id
    limit least(greatest(coalesce(p_limit,80),1),100)
    offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'total',(select count(*) from matched),
    'stock',(select coalesce(sum(stock_quantity),0) from matched),
    'low',(select count(*) from matched where stock_quantity>0 and stock_quantity<=low_stock_limit),
    'out',(select count(*) from matched where stock_quantity=0),
    'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.search_inventory_variants(uuid,text,integer,integer) from public, anon;
grant execute on function public.search_inventory_variants(uuid,text,integer,integer) to authenticated;
