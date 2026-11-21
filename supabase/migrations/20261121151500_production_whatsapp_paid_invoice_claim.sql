-- Staged production paid-invoice claim. Install only after Meta sender, webhook,
-- consent and rollback checks have passed. Does not send any messages.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_paid_invoice_whatsapp_production(p_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $claim$
DECLARE v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Invalid batch size';
  END IF;
  WITH picked AS (
    SELECT n.id
      FROM public.whatsapp_notifications n
      JOIN public.orders o ON o.id=n.order_id
      JOIN public.razorpay_checkouts rc ON rc.order_id=o.id
      JOIN public.invoices i ON i.order_id=o.id
     WHERE n.notification_type='payment_receipt'
       AND n.status='pending' AND n.send_started_at IS NULL
       AND regexp_replace(n.recipient_number,'[^0-9]','','g') ~ '^[1-9][0-9]{9,14}$'
       AND o.payment_status='paid'
       AND o.status IN ('confirmed','processing','shipped','delivered')
       AND rc.status='paid' AND rc.amount_refunded_paise=0
       AND rc.reservation_released_at IS NULL
       AND rc.amount_paise=o.total_amount*100
       AND rc.whatsapp_opt_in IS TRUE
       AND n.invoice_url='https://rainbowgoldcovering.com/invoice.html?token='||i.public_token::text
       AND EXISTS (
         SELECT 1 FROM public.payments p
          WHERE p.order_id=o.id AND p.method='razorpay'
            AND p.status='paid' AND p.verified_at IS NOT NULL
            AND p.transaction_reference=rc.gateway_payment_id
            AND p.amount=o.total_amount
       )
     ORDER BY n.created_at
     LIMIT p_limit
     FOR UPDATE OF n SKIP LOCKED
  ), claimed AS (
    UPDATE public.whatsapp_notifications n
       SET send_started_at=now(), send_attempts=send_attempts+1
      FROM picked WHERE n.id=picked.id
      RETURNING n.id,n.order_id,n.recipient_number,n.invoice_url
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'recipient',x.recipient_number,'invoice_url',x.invoice_url,
    'order_number',o.order_number,'customer_name',c.name,
    'whatsapp_opt_in',true,'payment_verified',true
  )),'[]'::jsonb)
    INTO v_result
    FROM claimed x
    JOIN public.orders o ON o.id=x.order_id
    JOIN public.customers c ON c.id=o.customer_id;
  RETURN v_result;
END;
$claim$;

REVOKE ALL ON FUNCTION public.claim_paid_invoice_whatsapp_production(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paid_invoice_whatsapp_production(integer)
  TO service_role;
COMMIT;
