-- After all six candidate migrations have been installed together,
-- verify read/write behavior against synthetic records only.
-- All test mutations are wrapped in a rollback to support repeat assertions.
BEGIN;
DO $schema$
DECLARE m jsonb;
BEGIN
 IF to_regclass('public.admin_audit_events') IS NULL OR
    to_regclass('public.whatsapp_provider_status_inbox') IS NULL THEN
   RAISE EXCEPTION 'Combined audit and WhatsApp tables were not installed';
 END IF;
 IF to_regclass('public.idx_invoices_unique_public_token') IS NOT NULL OR
    to_regclass('public.invoices_public_token_uidx') IS NULL THEN
   RAISE EXCEPTION 'Duplicate invoice index still exists or unique lookup lost';
 END IF;
 IF (SELECT count(*) FROM public.invoices)<>3 THEN
   RAISE EXCEPTION 'Candidate migrations changed stored invoices';
 END IF;
 IF has_function_privilege('anon',
    'public.claim_paid_invoice_whatsapp_production(integer)','EXECUTE') OR
    has_function_privilege('authenticated',
    'public.claim_paid_invoice_whatsapp_production(integer)','EXECUTE') OR
    NOT has_function_privilege('service_role',
    'public.claim_paid_invoice_whatsapp_production(integer)','EXECUTE') THEN
   RAISE EXCEPTION 'WhatsApp recipient claim RPC has unsafe privileges';
 END IF;
 IF has_function_privilege('anon',
    'public.record_whatsapp_delivery_status(text,text,timestamptz)','EXECUTE') OR
    has_function_privilege('authenticated',
    'public.record_whatsapp_delivery_status(text,text,timestamptz)','EXECUTE') THEN
   RAISE EXCEPTION 'Meta delivery callback RPC exposed to browser role';
 END IF;
 IF has_function_privilege('anon',
    'public.track_my_online_orders()','EXECUTE') OR
    has_function_privilege('anon',
    'public.track_my_order_shipments()','EXECUTE') OR
    NOT has_function_privilege('authenticated',
    'public.track_my_online_orders()','EXECUTE') THEN
   RAISE EXCEPTION 'Customer order tracking grants changed unsafely';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=
   'public.admin_audit_events'::regclass) THEN
   RAISE EXCEPTION 'Owner audit journal RLS is not enabled';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=
   'public.whatsapp_provider_status_inbox'::regclass) THEN
   RAISE EXCEPTION 'Provider status inbox RLS is not enabled';
 END IF;
END;
$schema$;

-- Production only allows a public invoice from a real eligible payment;
-- synthetic paid and local-sale receipts must remain viewable.
SET ROLE anon;
DO $invoice$
DECLARE paid jsonb;local_receipt jsonb;
BEGIN
 paid:=public.get_public_invoice('99999999-9999-4999-8999-999999999999');
 local_receipt:=public.get_public_invoice('99999999-9999-4999-8999-999999999997');
 IF paid->>'invoice_number' IS DISTINCT FROM 'INV-PAID-FIXTURE'
   OR paid->>'payment_method' IS DISTINCT FROM 'razorpay'
   OR paid->>'customer_phone' IS DISTINCT FROM '919999999999'
   OR (paid->>'igst_amount')::numeric<>18
   OR jsonb_array_length(paid->'items')<>1
   OR local_receipt->>'invoice_number' IS DISTINCT FROM 'INV-LOCAL-FIXTURE' THEN
   RAISE EXCEPTION 'Invoice privacy migration broke paid or local receipts';
 END IF;
 IF paid ?| ARRAY['customer_email','customer_address',
    'customer_city','customer_state','customer_pin_code'] OR
    paid::text LIKE '%SECRET ADDRESS%' THEN
   RAISE EXCEPTION 'Public receipt still leaks unrendered customer PII';
 END IF;
 IF public.get_public_invoice('99999999-9999-4999-8999-999999999998') IS NOT NULL OR
    public.get_public_invoice('99999999-9999-4999-8999-999999999996') IS NOT NULL THEN
   RAISE EXCEPTION 'Anonymous token exposed an unpaid or unknown invoice';
 END IF;
END;
$invoice$;
RESET ROLE;

-- Verified current Supabase-auth identity, never a stale JWT email.
SET ROLE authenticated;
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET request.jwt.claim.email='eve@example.test';
DO $customer$
BEGIN
 IF (SELECT count(*) FROM public.track_my_online_orders())<>1 OR
    (SELECT count(*) FROM public.track_my_order_shipments())<>1 OR
    (SELECT order_number FROM public.track_my_online_orders())<>'RG-PAID-FIXTURE' THEN
   RAISE EXCEPTION 'Verified owner lost access or stale email claim changed ownership';
 END IF;
END;
$customer$;
SET request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SET request.jwt.claim.email='alice@example.test';
DO $unverified$
BEGIN
 IF EXISTS(SELECT 1 FROM public.track_my_online_orders()) OR
    EXISTS(SELECT 1 FROM public.track_my_order_shipments()) THEN
   RAISE EXCEPTION 'Unverified account exposed a customer order';
 END IF;
END;
$unverified$;
RESET ROLE;

-- Real staff ownership: only admin can see the audit journal.
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
UPDATE public.products SET selling_price=1050
 WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
UPDATE public.erp_online_listings SET published=true
 WHERE product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
INSERT INTO public.erp_stock_events(location_id,variant_id,action,quantity_delta,actor_id)
 VALUES('aaaaaaaa-0000-4000-8000-000000000001',
        'bbbbbbbb-0000-4000-8000-000000000002',
        'adjust',2,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
DO $audit$
BEGIN
 IF (SELECT count(*) FROM public.admin_audit_events)<3 THEN
   RAISE EXCEPTION 'Combined migrations stopped product/stock audit triggers';
 END IF;
END;
$audit$;
SET ROLE authenticated;
DO $admin$
BEGIN
 IF (SELECT count(*) FROM public.admin_audit_events)<3 THEN
   RAISE EXCEPTION 'Verified owner cannot read operational audit';
 END IF;
END;
$admin$;
SET request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $staff$
BEGIN
 IF EXISTS (SELECT 1 FROM public.admin_audit_events) THEN
   RAISE EXCEPTION 'Non-owner staff can read owner audit log';
 END IF;
END;
$staff$;
RESET ROLE;

-- Production WhatsApp send is still OFF; only verify stored claim eligibility
-- inside the synthetic database. Never invoke Meta or Razorpay.
SET request.jwt.claim.role='service_role';
DO $claim$
DECLARE claimed jsonb;
BEGIN
 claimed:=public.claim_paid_invoice_whatsapp_production(5);
 IF jsonb_array_length(claimed)<>1 OR
    claimed->0->>'order_number'<>'RG-PAID-FIXTURE' OR
    claimed->0->>'payment_verified'<>'true' OR
    (SELECT count(*) FROM public.whatsapp_notifications
      WHERE send_started_at IS NOT NULL)<>1 THEN
   RAISE EXCEPTION 'Unsafe or missing paid-and-opted-in WhatsApp claim';
 END IF;
 IF (SELECT send_started_at FROM public.whatsapp_notifications
       WHERE id='12345678-1234-4234-8234-1234567890ac') IS NOT NULL THEN
   RAISE EXCEPTION 'Unpaid invoice was claimed for WhatsApp sending';
 END IF;
END;
$claim$;

-- Signed callback logic: status may arrive before message ID is saved.
SELECT public.record_whatsapp_delivery_status(
 'wamid.synthetic_receipt12345','delivered',now());
UPDATE public.whatsapp_notifications
 SET provider_message_id='wamid.synthetic_receipt12345'
 WHERE id='12345678-1234-4234-8234-1234567890ab';
DO $provider$
BEGIN
 IF (SELECT provider_delivery_status FROM public.whatsapp_notifications
    WHERE id='12345678-1234-4234-8234-1234567890ab')<>'delivered' THEN
   RAISE EXCEPTION 'Delivery callback arriving before acknowledgement was lost';
 END IF;
END;
$provider$;
SELECT public.record_whatsapp_delivery_status(
 'wamid.synthetic_receipt12345','sent',now()-interval '5 minutes');
DO $order$
BEGIN
 IF (SELECT provider_delivery_status FROM public.whatsapp_notifications
    WHERE id='12345678-1234-4234-8234-1234567890ab')<>'delivered' THEN
   RAISE EXCEPTION 'Older callback downgraded delivered status';
 END IF;
END;
$order$;
RESET request.jwt.claim.role;

-- All local synthetic modifications are rolled back. Migrations persist.
ROLLBACK;
