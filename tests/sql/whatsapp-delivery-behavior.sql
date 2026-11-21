-- Disposable-only status webhook regression.
DO $privs$
BEGIN
 IF has_function_privilege('anon','public.record_whatsapp_delivery_status(text,text,timestamptz)','EXECUTE')
   OR has_function_privilege('authenticated','public.record_whatsapp_delivery_status(text,text,timestamptz)','EXECUTE')
   OR NOT has_function_privilege('service_role','public.record_whatsapp_delivery_status(text,text,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'Unsafe webhook status RPC grants'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class
   WHERE oid='public.whatsapp_provider_status_inbox'::regclass) THEN
  RAISE EXCEPTION 'Status staging table missing RLS';
 END IF;
END;
$privs$;

SET request.jwt.claim.role='service_role';
SELECT public.record_whatsapp_delivery_status(
 'wamid.test_message_known123','sent',now()-interval '2 hours');
SELECT public.record_whatsapp_delivery_status(
 'wamid.test_message_known123','delivered',now()-interval '1 hour');
-- Older event may arrive afterward: it must not erase delivery.
SELECT public.record_whatsapp_delivery_status(
 'wamid.test_message_known123','sent',now()-interval '3 hours');

DO $latest$
BEGIN
 IF (SELECT provider_delivery_status FROM public.whatsapp_notifications
   WHERE id='11111111-1111-4111-8111-111111111111')<>'delivered' THEN
  RAISE EXCEPTION 'Out-of-order event downgraded delivery status';
 END IF;
END;
$latest$;

-- Meta may callback before the sender has saved its provider message ID.
SELECT public.record_whatsapp_delivery_status(
 'wamid.test_message_beforeack456','read',now()-interval '30 minutes');
UPDATE public.whatsapp_notifications SET provider_message_id='wamid.test_message_beforeack456',
 status='sent' WHERE id='22222222-2222-4222-8222-222222222222';
DO $fast$
BEGIN
 IF (SELECT provider_delivery_status FROM public.whatsapp_notifications
   WHERE id='22222222-2222-4222-8222-222222222222')<>'read' THEN
  RAISE EXCEPTION 'Fast Meta callback not reconciled after provider acknowledgement';
 END IF;
END;
$fast$;
SELECT public.record_whatsapp_delivery_status(
 'wamid.test_message_known123','failed',now());
DO $failure$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.whatsapp_notifications
   WHERE id='11111111-1111-4111-8111-111111111111'
    AND provider_delivery_status='failed' AND status='failed'
    AND error_message='Meta reported message delivery failed'
 ) THEN RAISE EXCEPTION 'Provider delivery failure not surfaced'; END IF;
END;
$failure$;

SET request.jwt.claim.role='authenticated';
DO $denied$
BEGIN
 BEGIN
  PERFORM public.record_whatsapp_delivery_status(
    'wamid.test_message_known123','read',now());
  RAISE EXCEPTION 'Authenticated browser could change delivery';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Authenticated browser could change delivery' THEN RAISE; END IF;
 END;
END;
$denied$;
