-- Minimize anonymous bearer-token invoice JSON without breaking visible receipts.
-- The invoice renderer uses name, phone, items and totals. It does not use
-- customer email, street address, city, state or pincode. Do not leak these
-- unused personal fields from a publicly callable SECURITY DEFINER RPC.
-- Public invoice links remain intentionally accessible by a random UUID token;
-- no change to payment verification, shipping or invoice eligibility.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_invoice(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'invoice_number',i.invoice_number,
    'order_number',o.order_number,
    'issued_at',i.issued_at,
    'customer_name',coalesce(c.name,'Walk-in Customer'),
    'customer_phone',c.whatsapp_number,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code',oi.product_code,'product_name',oi.product_name,
        'product_type',oi.product_type,'variant_color',oi.variant_color,
        'variant_size',oi.variant_size,'length_cm',oi.length_cm,
        'thickness',oi.thickness,'gold_amount_g',oi.gold_amount_g,
        'quantity',oi.quantity,'unit_price',oi.unit_price,
        'discount_amount',oi.discount_amount,'line_total',oi.line_total
      ) order by oi.created_at,oi.id)
      from public.order_items oi where oi.order_id=o.id
    ),'[]'::jsonb),
    'subtotal',o.subtotal,'discount_amount',o.discount_amount,
    'cgst_amount',o.cgst_amount,'sgst_amount',o.sgst_amount,
    'igst_amount',o.igst_amount,
    'delivery_fee',o.delivery_fee,'total_amount',o.total_amount,
    'payment_method',(
      select p.method::text from public.payments p
       where p.order_id=o.id and p.status='paid'
       order by p.paid_at desc nulls last,p.created_at desc limit 1
    )
  )
  from public.invoices i
  join public.orders o on o.id=i.order_id
  left join public.customers c on c.id=o.customer_id
  where i.public_token=p_token
    and o.status not in ('cancelled','refunded')
    and (o.source='local_store'
      or (o.source='online' and o.payment_status='paid'
        and o.status in ('confirmed','processing','shipped','delivered')
        and (exists(select 1 from public.razorpay_checkouts rc
          where rc.order_id=o.id and rc.status='paid')
          or exists(select 1 from public.payments p
             where p.order_id=o.id and p.method='upi' and p.status='paid'
               and p.verified_by is not null and p.verified_at is not null))));
$function$;
COMMIT;
