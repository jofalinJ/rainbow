-- STAGED: bounded online-order discovery, including customer search and full details.
create or replace function public.search_online_orders(
  p_search text default '', p_status text default 'all',
  p_offset integer default 0, p_limit integer default 50
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog, public as $$
declare
  v_result jsonb;
  v_query text := '%' || coalesce(btrim(p_search),'') || '%';
begin
  if not (public.is_admin() or public.is_cashier()) then
    raise exception 'Online order history requires active shop staff' using errcode='42501';
  end if;
  with matched as (
    select o.id,o.order_number,o.source::text as source,o.status::text as status,
      o.payment_status::text as payment_status,o.subtotal,o.discount_amount,
      o.cgst_amount,o.sgst_amount,o.delivery_fee,o.total_amount,
      o.shipping_address,o.created_at,o.updated_at,
      jsonb_build_object('name',c.name,'whatsapp_number',c.whatsapp_number,
        'email',c.email,'address',c.address,'city',c.city,
        'state',c.state,'pin_code',c.pin_code) as customers
    from public.orders o left join public.customers c on c.id=o.customer_id
    where o.source='online'
      and (coalesce(p_status,'all')='all' or o.status::text=p_status)
      and (coalesce(btrim(p_search),'')='' or
        o.order_number ilike v_query or c.name ilike v_query or c.whatsapp_number ilike v_query)
  ), page as (
    select * from matched order by created_at desc,id
    limit least(greatest(coalesce(p_limit,50),1),100)
    offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'total',(select count(*) from matched),
    'rows',coalesce((select jsonb_agg(
      to_jsonb(p)
      || jsonb_build_object(
        'order_items',coalesce((select jsonb_agg(jsonb_build_object(
          'product_code',i.product_code,'product_name',i.product_name,
          'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,
          'variant_color',i.variant_color,'variant_size',i.variant_size,
          'length_cm',i.length_cm,'thickness',i.thickness,
          'discount_amount',i.discount_amount
        ) order by i.created_at) from public.order_items i where i.order_id=p.id),'[]'::jsonb),
        'payments',coalesce((select jsonb_agg(jsonb_build_object(
          'id',pay.id,'method',pay.method,'status',pay.status,
          'transaction_reference',pay.transaction_reference,'amount',pay.amount,
          'paid_at',pay.paid_at,'verified_at',pay.verified_at
        ) order by pay.created_at desc) from public.payments pay where pay.order_id=p.id),'[]'::jsonb),
        'invoices',coalesce((select jsonb_agg(jsonb_build_object(
          'invoice_number',inv.invoice_number,'public_token',inv.public_token
        )) from public.invoices inv where inv.order_id=p.id),'[]'::jsonb)
      )) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.search_online_orders(text,text,integer,integer) from public, anon;
grant execute on function public.search_online_orders(text,text,integer,integer) to authenticated;
