-- Staged Meta delivery tracking: provider acknowledgements are NOT delivery.
-- Keeps signed status notifications separate from customer and invoice data.
BEGIN;
ALTER TABLE public.whatsapp_notifications
  ADD COLUMN IF NOT EXISTS provider_delivery_status text
    CHECK (provider_delivery_status IS NULL OR
           provider_delivery_status IN ('sent','delivered','read','failed'));
ALTER TABLE public.whatsapp_notifications
  ADD COLUMN IF NOT EXISTS provider_delivery_at timestamptz;

CREATE TABLE IF NOT EXISTS public.whatsapp_provider_status_inbox(
  provider_message_id text PRIMARY KEY
    CHECK (length(provider_message_id) BETWEEN 10 AND 256),
  provider_status text NOT NULL
    CHECK (provider_status IN ('sent','delivered','read','failed')),
  provider_status_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_provider_status_inbox_recent
  ON public.whatsapp_provider_status_inbox(updated_at DESC);
ALTER TABLE public.whatsapp_provider_status_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_provider_status_inbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.whatsapp_provider_status_inbox TO service_role;

-- Accept signed Meta status callbacks via the Worker only; no browser role.
-- Record statuses before provider acknowledgement is attached, so a fast
-- callback is not lost if it arrives first.
CREATE OR REPLACE FUNCTION public.record_whatsapp_delivery_status(
 p_provider_message_id text, p_status text, p_status_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $delivery$
DECLARE v_status text; v_at timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Unauthorized';
 END IF;
 IF p_provider_message_id IS NULL OR
    p_provider_message_id !~ '^wamid\.[A-Za-z0-9_.:=-]{6,240}$' OR
    p_status NOT IN ('sent','delivered','read','failed') OR
    p_status_at IS NULL OR p_status_at < '2020-01-01'::timestamptz OR
    p_status_at > now() + interval '1 day'
 THEN RAISE EXCEPTION 'Invalid delivery status';
 END IF;
 INSERT INTO public.whatsapp_provider_status_inbox
  (provider_message_id,provider_status,provider_status_at)
 VALUES(p_provider_message_id,p_status,p_status_at)
 ON CONFLICT(provider_message_id) DO UPDATE
 SET provider_status=excluded.provider_status,
     provider_status_at=excluded.provider_status_at,updated_at=now()
 WHERE excluded.provider_status_at >
       public.whatsapp_provider_status_inbox.provider_status_at
    OR (excluded.provider_status_at =
        public.whatsapp_provider_status_inbox.provider_status_at
        AND (CASE excluded.provider_status WHEN 'sent' THEN 1
             WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 4 END) >
            (CASE public.whatsapp_provider_status_inbox.provider_status
             WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
             WHEN 'read' THEN 3 ELSE 4 END));
 SELECT provider_status,provider_status_at INTO v_status,v_at
 FROM public.whatsapp_provider_status_inbox
 WHERE provider_message_id=p_provider_message_id;
 UPDATE public.whatsapp_notifications AS n SET
   provider_delivery_status=v_status,provider_delivery_at=v_at,
   status=CASE WHEN v_status='failed' THEN 'failed'::public.whatsapp_status
      WHEN n.status='failed' THEN 'sent'::public.whatsapp_status
      ELSE n.status END,
   error_message=CASE WHEN v_status='failed'
      THEN 'Meta reported message delivery failed' ELSE NULL END
 WHERE n.provider_message_id=p_provider_message_id
   AND (n.provider_delivery_at IS NULL OR n.provider_delivery_at<=v_at);
 RETURN true;
END;
$delivery$;
REVOKE ALL ON FUNCTION public.record_whatsapp_delivery_status(text,text,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_delivery_status(text,text,timestamptz)
 TO service_role;

CREATE OR REPLACE FUNCTION app_private.apply_whatsapp_status_after_ack()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public','app_private'
AS $sync$
DECLARE v_status text; v_at timestamptz;
BEGIN
 IF NEW.provider_message_id IS NULL THEN RETURN NEW; END IF;
 SELECT provider_status,provider_status_at INTO v_status,v_at
 FROM public.whatsapp_provider_status_inbox
 WHERE provider_message_id=NEW.provider_message_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 UPDATE public.whatsapp_notifications AS n SET
    provider_delivery_status=v_status,provider_delivery_at=v_at,
    status=CASE WHEN v_status='failed' THEN 'failed'::public.whatsapp_status
      ELSE n.status END,
    error_message=CASE WHEN v_status='failed'
      THEN 'Meta reported message delivery failed' ELSE NULL END
 WHERE n.id=NEW.id AND (n.provider_delivery_at IS NULL
   OR n.provider_delivery_at<=v_at);
 RETURN NEW;
END;
$sync$;
REVOKE ALL ON FUNCTION app_private.apply_whatsapp_status_after_ack()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS rainbow_whatsapp_apply_early_status
 ON public.whatsapp_notifications;
CREATE TRIGGER rainbow_whatsapp_apply_early_status
 AFTER UPDATE OF provider_message_id ON public.whatsapp_notifications
 FOR EACH ROW WHEN (NEW.provider_message_id IS NOT NULL)
 EXECUTE FUNCTION app_private.apply_whatsapp_status_after_ack();
COMMIT;
