-- Verify customer order/shipment ownership against CURRENT confirmed Supabase Auth email.
-- Staged only. Keep RPC response signatures, order visibility filters and client
-- caller grants unchanged; no production data is accessed or modified by CI.
BEGIN;
CREATE OR REPLACE FUNCTION public.track_my_online_orders()
 RETURNS TABLE(order_number text, product_names text, status text, payment_status text, total_amount numeric, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select
    o.order_number,
    string_agg(distinct oi.product_name, ', ' order by oi.product_name) as product_names,
    o.status::text,
    o.payment_status::text,
    o.total_amount,
    o.created_at,
    o.updated_at
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.order_items oi on oi.order_id = o.id
  where (select auth.uid()) is not null
    and EXISTS (
      SELECT 1 FROM auth.users current_user_record
       WHERE current_user_record.id=(select auth.uid())
         AND current_user_record.email_confirmed_at IS NOT NULL
         AND nullif(trim(current_user_record.email),'') IS NOT NULL
         AND lower(trim(c.email))=lower(trim(current_user_record.email))
    )
    and o.source::text = 'online'
    and o.status::text not in ('delivered', 'cancelled', 'refunded')
  group by o.id
  order by o.created_at desc
  limit 10;
$function$;
REVOKE ALL ON FUNCTION public.track_my_online_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_my_online_orders() TO authenticated;

CREATE OR REPLACE FUNCTION public.track_my_order_shipments()
 RETURNS TABLE(order_number text, product_names text, order_status text, payment_status text, total_amount numeric, created_at timestamp with time zone, courier_provider text, consignment_number text, dispatch_date date, shipment_status text, shipment_updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select o.order_number,
     (select string_agg(distinct oi.product_name,', ' order by oi.product_name)
      from public.order_items oi where oi.order_id=o.id),
     o.status::text,o.payment_status::text,o.total_amount,o.created_at,
     s.courier_provider,s.consignment_number,s.dispatch_date,s.status,s.updated_at
  from public.orders o
  join public.customers c on c.id=o.customer_id
  left join public.order_shipments s on s.order_id=o.id
  where (select auth.uid()) is not null
    and EXISTS (
      SELECT 1 FROM auth.users current_user_record
       WHERE current_user_record.id=(select auth.uid())
         AND current_user_record.email_confirmed_at IS NOT NULL
         AND nullif(trim(current_user_record.email),'') IS NOT NULL
         AND lower(trim(c.email))=lower(trim(current_user_record.email))
    )
    and o.source::text='online'
  order by o.created_at desc limit 30;
$function$;
REVOKE ALL ON FUNCTION public.track_my_order_shipments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_my_order_shipments() TO authenticated;

COMMIT;
