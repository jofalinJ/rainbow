-- Restricted operational audit trail. No raw customer/staff PII or invoice links.
-- Staging-only until DBA review, disposable PostgreSQL verification and approval.
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN ('product','online_listing','staff_access','stock_event')),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 120),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS admin_audit_events_recent
  ON public.admin_audit_events (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_actor
  ON public.admin_audit_events (actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_audit_events TO authenticated;
REVOKE ALL ON SEQUENCE public.admin_audit_events_id_seq FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Active owner reads operational audit" ON public.admin_audit_events;
CREATE POLICY "Active owner reads operational audit"
 ON public.admin_audit_events FOR SELECT TO authenticated
 USING ((SELECT public.is_admin()));

-- Only triggers invoke the writer. Keep it in an unexposed schema, no direct
-- client privileges, and restrict the journal to a small hardcoded field set.
CREATE OR REPLACE FUNCTION app_private.write_rainbow_admin_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','app_private'
AS $audit$
DECLARE
  v_entity text;
  v_entity_id text;
  v_action text;
  v_actor uuid;
  v_detail jsonb := '{}'::jsonb;
BEGIN
  v_actor := auth.uid();
  IF TG_TABLE_NAME = 'products' THEN
    v_entity := 'product';
    v_entity_id := (CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END)::text;
    v_action := lower(TG_OP);
    IF TG_OP='INSERT' THEN
      v_detail := jsonb_build_object('price', NEW.selling_price,
        'active', NEW.active, 'archived', NEW.archived_at IS NOT NULL);
    ELSIF TG_OP='UPDATE' THEN
      IF NEW.selling_price IS NOT DISTINCT FROM OLD.selling_price
         AND NEW.active IS NOT DISTINCT FROM OLD.active
         AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
        RETURN NEW;
      END IF;
      v_action := 'price_or_visibility_changed';
      v_detail := jsonb_build_object('old_price', OLD.selling_price,
        'new_price', NEW.selling_price,'was_active',OLD.active,
        'active',NEW.active,'was_archived', OLD.archived_at IS NOT NULL,
        'archived',NEW.archived_at IS NOT NULL);
    END IF;
  ELSIF TG_TABLE_NAME = 'erp_online_listings' THEN
    v_entity := 'online_listing';
    v_entity_id := (CASE WHEN TG_OP='DELETE' THEN OLD.product_id ELSE NEW.product_id END)::text;
    v_action := lower(TG_OP);
    IF TG_OP='INSERT' THEN
      v_actor := coalesce(NEW.updated_by,v_actor);
      v_detail := jsonb_build_object('published',NEW.published,'online_price',NEW.online_price);
    ELSIF TG_OP='UPDATE' THEN
      IF NEW.published IS NOT DISTINCT FROM OLD.published
         AND NEW.online_price IS NOT DISTINCT FROM OLD.online_price THEN
        RETURN NEW;
      END IF;
      v_actor := coalesce(NEW.updated_by,v_actor);
      v_action := 'publication_or_price_changed';
      v_detail := jsonb_build_object('was_published', OLD.published,
        'published',NEW.published,'old_online_price',OLD.online_price,
        'online_price',NEW.online_price);
    END IF;
  ELSIF TG_TABLE_NAME = 'staff_profiles' THEN
    v_entity := 'staff_access';
    v_entity_id := (CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END)::text;
    v_action := lower(TG_OP);
    IF TG_OP='INSERT' THEN
      v_detail := jsonb_build_object('role',NEW.role,'active',NEW.active,
        'archived',NEW.archived_at IS NOT NULL);
    ELSIF TG_OP='UPDATE' THEN
      IF NEW.role IS NOT DISTINCT FROM OLD.role
         AND NEW.active IS NOT DISTINCT FROM OLD.active
         AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
        RETURN NEW;
      END IF;
      v_action := 'access_changed';
      v_detail := jsonb_build_object('old_role',OLD.role,'role',NEW.role,
        'was_active',OLD.active,'active',NEW.active,
        'was_archived',OLD.archived_at IS NOT NULL,
        'archived',NEW.archived_at IS NOT NULL);
    END IF;
  ELSIF TG_TABLE_NAME = 'erp_stock_events' THEN
    IF TG_OP<>'INSERT' THEN RETURN COALESCE(NEW,OLD); END IF;
    v_entity := 'stock_event';
    v_entity_id := NEW.id::text;
    v_action := NEW.action;
    v_actor := coalesce(NEW.actor_id,v_actor);
    v_detail := jsonb_build_object('location_id',NEW.location_id,
      'variant_id',NEW.variant_id,'delta',NEW.quantity_delta);
  ELSE
    RAISE EXCEPTION 'Unsupported audit source';
  END IF;
  INSERT INTO public.admin_audit_events(actor_id,entity_type,entity_id,event_type,detail)
  VALUES (v_actor,v_entity,v_entity_id,v_action,v_detail);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$audit$;

REVOKE ALL ON FUNCTION app_private.write_rainbow_admin_audit()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rainbow_audit_products ON public.products;
CREATE TRIGGER rainbow_audit_products
AFTER INSERT OR UPDATE OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION app_private.write_rainbow_admin_audit();

DROP TRIGGER IF EXISTS rainbow_audit_online_listings ON public.erp_online_listings;
CREATE TRIGGER rainbow_audit_online_listings
AFTER INSERT OR UPDATE OR DELETE ON public.erp_online_listings
FOR EACH ROW EXECUTE FUNCTION app_private.write_rainbow_admin_audit();

DROP TRIGGER IF EXISTS rainbow_audit_staff_access ON public.staff_profiles;
CREATE TRIGGER rainbow_audit_staff_access
AFTER INSERT OR UPDATE OR DELETE ON public.staff_profiles
FOR EACH ROW EXECUTE FUNCTION app_private.write_rainbow_admin_audit();

DROP TRIGGER IF EXISTS rainbow_audit_stock_events ON public.erp_stock_events;
CREATE TRIGGER rainbow_audit_stock_events
AFTER INSERT ON public.erp_stock_events
FOR EACH ROW EXECUTE FUNCTION app_private.write_rainbow_admin_audit();

COMMIT;
