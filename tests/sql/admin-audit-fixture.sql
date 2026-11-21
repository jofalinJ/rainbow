-- Disposable PostgreSQL fixture: minimal schema required by the staged audit trail.
CREATE SCHEMA auth;
CREATE SCHEMA app_private;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$roles$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $uid$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$uid$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.staff_profiles(
 user_id uuid PRIMARY KEY,
 role text NOT NULL, active boolean NOT NULL DEFAULT true,
 archived_at timestamptz
);
CREATE TABLE public.products(
 id uuid PRIMARY KEY,
 selling_price numeric NOT NULL, active boolean NOT NULL DEFAULT true,
 archived_at timestamptz
);
CREATE TABLE public.erp_online_listings(
 product_id uuid PRIMARY KEY, published boolean NOT NULL DEFAULT false,
 online_price numeric, updated_by uuid
);
CREATE TABLE public.erp_stock_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 location_id uuid, variant_id uuid, action text NOT NULL,
 quantity_delta integer NOT NULL, actor_id uuid
);

CREATE OR REPLACE FUNCTION app_private.erp_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $f$
 SELECT EXISTS(
   SELECT 1 FROM public.staff_profiles
   WHERE user_id=(SELECT auth.uid()) AND role='admin' AND active
     AND archived_at IS NULL
 );
$f$;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.erp_is_admin() TO authenticated;
