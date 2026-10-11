-- Customer-safe order tracking. The guest lookup returns only matching online order status details.
create or replace function public.track_online_order(p_product_code text, p_phone text)
returns table (
  order_number text,
  product_name text,
  status text,
  payment_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with provided as (
    select
      upper(trim(coalesce(p_product_code, ''))) as product_code,
      right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10) as phone_last10
  )
  select o.order_number, oi.product_name, o.status::text, o.payment_status::text, o.created_at
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.order_items oi on oi.order_id = o.id
  cross join provided p
  where o.source::text = 'online'
    and length(p.product_code) between 1 and 64
    and length(p.phone_last10) = 10
    and upper(trim(oi.product_code)) = p.product_code
    and right(regexp_replace(coalesce(c.whatsapp_number, ''), '[^0-9]', '', 'g'), 10) = p.phone_last10
  order by o.created_at desc
  limit 10;
$function$;

revoke all on function public.track_online_order(text, text) from public;
grant execute on function public.track_online_order(text, text) to anon, authenticated;

-- Automatic order tracking is restricted to orders where the signed-in JWT email matches the customer email.
create or replace function public.track_my_online_orders()
returns table (
  order_number text,
  product_names text,
  status text,
  payment_status text,
  total_amount numeric,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    o.order_number,
    string_agg(distinct oi.product_name, ', ' order by oi.product_name),
    o.status::text,
    o.payment_status::text,
    o.total_amount,
    o.created_at,
    o.updated_at
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.order_items oi on oi.order_id = o.id
  where auth.uid() is not null
    and nullif(trim(coalesce(auth.jwt() ->> 'email', '')), '') is not null
    and lower(trim(coalesce(c.email, ''))) = lower(trim(auth.jwt() ->> 'email'))
    and o.source::text = 'online'
    and o.status::text not in ('delivered', 'cancelled', 'refunded')
  group by o.id
  order by o.created_at desc
  limit 10;
$function$;

revoke all on function public.track_my_online_orders() from public, anon;
grant execute on function public.track_my_online_orders() to authenticated;
