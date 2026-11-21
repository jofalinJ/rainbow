-- Synthetic Supabase-shaped schema for a single isolated PostgreSQL run.
-- Never connect this fixture to the live Rainbow database.
CREATE SCHEMA auth;
CREATE SCHEMA app_private;
DO $roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END;
$roles$;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $f$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$f$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $f$
 SELECT nullif(current_setting('request.jwt.claim.role',true),'');
$f$;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz
);
CREATE TABLE public.staff_profiles (
 user_id uuid PRIMARY KEY,role text NOT NULL,active boolean NOT NULL,
 archived_at timestamptz
);
CREATE OR REPLACE FUNCTION app_private.erp_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='pg_catalog','public' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.staff_profiles
 WHERE user_id=(SELECT auth.uid()) AND role='admin'
 AND active AND archived_at IS NULL);
$f$;
CREATE TABLE public.products(
 id uuid PRIMARY KEY,selling_price numeric NOT NULL,
 active boolean NOT NULL,archived_at timestamptz
);
CREATE TABLE public.erp_online_listings(
 product_id uuid PRIMARY KEY,published boolean NOT NULL DEFAULT false,
 online_price numeric,updated_by uuid
);
CREATE TABLE public.erp_stock_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 location_id uuid,variant_id uuid,action text NOT NULL,
 quantity_delta integer NOT NULL,actor_id uuid
);
CREATE TABLE public.customers (
 id uuid PRIMARY KEY,name text,whatsapp_number text,email text,
 address text,city text,state text,pin_code text
);
CREATE TABLE public.orders (
 id uuid PRIMARY KEY,customer_id uuid REFERENCES public.customers(id),
 order_number text,source text,status text,payment_status text,
 subtotal numeric,discount_amount numeric,cgst_amount numeric,
 sgst_amount numeric,igst_amount numeric,delivery_fee numeric,total_amount numeric,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.order_items (
 id uuid PRIMARY KEY,order_id uuid REFERENCES public.orders(id),
 product_code text,product_name text,product_type text,
 variant_color text,variant_size text,length_cm numeric,
 thickness text,gold_amount_g numeric,quantity integer,unit_price numeric,
 discount_amount numeric,line_total numeric,created_at timestamptz DEFAULT now()
);
CREATE TABLE public.invoices (
 id uuid PRIMARY KEY,order_id uuid REFERENCES public.orders(id),
 invoice_number text,issued_at timestamptz DEFAULT now(),
 public_token uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE UNIQUE INDEX idx_invoices_unique_public_token
 ON public.invoices(public_token);
CREATE UNIQUE INDEX invoices_public_token_uidx
 ON public.invoices(public_token);
CREATE TABLE public.payments(
 order_id uuid REFERENCES public.orders(id),method text,status text,
 amount numeric,transaction_reference text,verified_at timestamptz,
 verified_by uuid,paid_at timestamptz,created_at timestamptz DEFAULT now()
);
CREATE TABLE public.razorpay_checkouts(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 status text,amount_refunded_paise bigint,
 reservation_released_at timestamptz,amount_paise bigint,
 whatsapp_opt_in boolean,gateway_payment_id text
);
CREATE TYPE public.whatsapp_status AS ENUM('pending','sent','failed');
CREATE TABLE public.whatsapp_notifications(
 id uuid PRIMARY KEY,order_id uuid REFERENCES public.orders(id),
 recipient_number text,notification_type text,
 status public.whatsapp_status NOT NULL DEFAULT 'pending',
 send_started_at timestamptz,send_attempts integer NOT NULL DEFAULT 0,
 invoice_url text,created_at timestamptz DEFAULT now(),
 provider_message_id text,error_message text
);
CREATE TABLE public.order_shipments(
 order_id uuid,courier_provider text,consignment_number text,
 dispatch_date date,status text,updated_at timestamptz DEFAULT now()
);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.erp_is_admin() TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO authenticated,service_role;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alice@example.test',now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eve@example.test',NULL);
INSERT INTO public.staff_profiles(user_id,role,active,archived_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin',true,NULL),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cashier',true,NULL);
INSERT INTO public.products(id,selling_price,active,archived_at) VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1000,true,NULL);
INSERT INTO public.erp_online_listings(product_id,published,online_price,updated_by) VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',false,1025,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

INSERT INTO public.customers(id,name,whatsapp_number,email,address,city,state,pin_code) VALUES
 ('11111111-1111-4111-8111-111111111111','Alice Test','919999999999','alice@example.test','SECRET ADDRESS','Test City','TN','999999'),
 ('22222222-2222-4222-8222-222222222222','Eve Test','919888888888','eve@example.test','SECRET ROAD','Other City','TN','888888');
INSERT INTO public.orders(id,customer_id,order_number,source,status,payment_status,
 subtotal,discount_amount,cgst_amount,sgst_amount,igst_amount,delivery_fee,total_amount)
VALUES
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
  'RG-PAID-FIXTURE','online','confirmed','paid',100,0,0,0,18,0,118),
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
  'RG-UNPAID-FIXTURE','online','pending','pending',100,0,0,0,18,0,118),
 ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',
  'RG-LOCAL-FIXTURE','local_store','confirmed','paid',90,0,0,0,0,0,90);
INSERT INTO public.order_items(id,order_id,product_code,product_name,quantity,
 unit_price,discount_amount,line_total) VALUES
 ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333',
  'RGC/FIX1','Synthetic Chain',1,100,0,100),
 ('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555555',
  'RGC/FIX2','Synthetic Bracelet',1,90,0,90);
INSERT INTO public.invoices(id,order_id,invoice_number,public_token) VALUES
 ('88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333',
  'INV-PAID-FIXTURE','99999999-9999-4999-8999-999999999999'),
 ('88888888-8888-4888-8888-888888888889','44444444-4444-4444-8444-444444444444',
  'INV-UNPAID-FIXTURE','99999999-9999-4999-8999-999999999998'),
 ('88888888-8888-4888-8888-888888888890','55555555-5555-4555-8555-555555555555',
  'INV-LOCAL-FIXTURE','99999999-9999-4999-8999-999999999997');
INSERT INTO public.payments(
 order_id,method,status,amount,transaction_reference,verified_at,
 verified_by,paid_at) VALUES
 ('33333333-3333-4333-8333-333333333333','razorpay','paid',118,'pay_fixture_xyz',now(),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()),
 ('55555555-5555-4555-8555-555555555555','cash','paid',90,'local-fixture',now(),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now());
INSERT INTO public.razorpay_checkouts(
 order_id,status,amount_refunded_paise,reservation_released_at,
 amount_paise,whatsapp_opt_in,gateway_payment_id) VALUES
 ('33333333-3333-4333-8333-333333333333','paid',0,NULL,11800,true,'pay_fixture_xyz');
INSERT INTO public.whatsapp_notifications(
 id,order_id,recipient_number,notification_type,status,invoice_url)
 VALUES
 ('12345678-1234-4234-8234-1234567890ab','33333333-3333-4333-8333-333333333333',
  '+919999999999','payment_receipt','pending',
  'https://rainbowgoldcovering.com/invoice.html?token=99999999-9999-4999-8999-999999999999'),
 ('12345678-1234-4234-8234-1234567890ac','44444444-4444-4444-8444-444444444444',
  '+919888888888','payment_receipt','pending',
  'https://rainbowgoldcovering.com/invoice.html?token=99999999-9999-4999-8999-999999999998');
INSERT INTO public.order_shipments(order_id,courier_provider,
 consignment_number,dispatch_date,status) VALUES
 ('33333333-3333-4333-8333-333333333333','Fixture Courier','FICTIONAL123',current_date,'shipped');
