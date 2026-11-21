-- Standalone disposable PostgreSQL fixture; never includes real messages.
CREATE SCHEMA auth;
CREATE SCHEMA app_private;
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END;
$roles$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
 SELECT nullif(current_setting('request.jwt.claim.role',true),'');
$f$;
CREATE TYPE public.whatsapp_status AS ENUM('pending','sent','failed');
CREATE TABLE public.whatsapp_notifications(
 id uuid PRIMARY KEY,
 provider_message_id text,
 status public.whatsapp_status NOT NULL DEFAULT 'pending',
 error_message text
);
INSERT INTO public.whatsapp_notifications(id,provider_message_id,status) VALUES
 ('11111111-1111-4111-8111-111111111111','wamid.test_message_known123','sent'),
 ('22222222-2222-4222-8222-222222222222',NULL,'pending');
