-- This fixture is disposable PostgreSQL 17 only, no production connection.
CREATE SCHEMA auth;
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
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $auth$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$auth$;
CREATE TABLE public.customers(id uuid PRIMARY KEY,email text);
CREATE TABLE public.orders(
 id uuid PRIMARY KEY,customer_id uuid REFERENCES public.customers(id),
 order_number text,source text,status text,payment_status text,
 total_amount numeric,created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.order_items(order_id uuid,product_name text);
CREATE TABLE public.order_shipments(
 order_id uuid,courier_provider text,consignment_number text,
 dispatch_date date,status text,updated_at timestamptz DEFAULT now()
);
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alice@example.test',now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bob@example.test',now()),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','eve@example.test',NULL);
INSERT INTO public.customers(id,email) VALUES
 ('11111111-1111-4111-8111-111111111111','alice@example.test'),
 ('22222222-2222-4222-8222-222222222222','bob@example.test'),
 ('33333333-3333-4333-8333-333333333333','eve@example.test');
INSERT INTO public.orders(id,customer_id,order_number,source,status,payment_status,total_amount)
VALUES
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','RG-ALICE','online','processing','paid',100),
 ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','RG-BOB','online','processing','paid',200),
 ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','RG-EVE','online','processing','paid',300);
INSERT INTO public.order_items(order_id,product_name) VALUES
 ('44444444-4444-4444-8444-444444444444','Alice Item'),
 ('55555555-5555-4555-8555-555555555555','Bob Item'),
 ('66666666-6666-4666-8666-666666666666','Eve Item');
INSERT INTO public.order_shipments(order_id,courier_provider,consignment_number,dispatch_date,status)
VALUES
 ('44444444-4444-4444-8444-444444444444','Courier','ALICEAWB',current_date,'shipped'),
 ('55555555-5555-4555-8555-555555555555','Courier','BOBAWB',current_date,'shipped'),
 ('66666666-6666-4666-8666-666666666666','Courier','EVEAWB',current_date,'shipped');
