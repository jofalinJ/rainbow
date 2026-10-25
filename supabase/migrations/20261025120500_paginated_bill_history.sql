-- STAGED: searchable, exact-count paginated bill history, respecting staff RLS.
create or replace function public.search_shop_bills(
  p_search text default '', p_status text default 'all',
  p_offset integer default 0, p_limit integer default 50
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog, public as $$
declare
  v_result jsonb;
  v_query text := '%' || coalesce(btrim(p_search),'') || '%';
begin
  if not (public.is_admin() or public.is_cashier()) then
    raise exception 'Bill history requires active shop staff' using errcode='42501';
  end if;
  with matched as (
    select i.invoice_number,i.public_token,i.issued_at,
      o.order_number,o.created_at,o.total_amount,o.status::text as status,
      coalesce(c.name,'Walk-in Customer') as customer_name,
      coalesce(c.whatsapp_number,'') as phone
    from public.invoices i
      join public.orders o on o.id=i.order_id
      left join public.customers c on c.id=o.customer_id
    where (coalesce(btrim(p_search),'')=''
      or i.invoice_number ilike v_query
      or o.order_number ilike v_query
      or c.name ilike v_query
      or c.whatsapp_number ilike v_query)
      and (coalesce(p_status,'all')='all' or o.status::text=p_status)
  ), page as (
    select * from matched order by issued_at desc
    limit least(greatest(coalesce(p_limit,50),1),100)
    offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'total',(select count(*) from matched),
    'total_amount',(select coalesce(sum(total_amount),0) from matched),
    'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.search_shop_bills(text,text,integer,integer) from public, anon;
grant execute on function public.search_shop_bills(text,text,integer,integer) to authenticated;
