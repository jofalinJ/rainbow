-- Disposable PostgreSQL fixture for WhatsApp paid-invoice claim.
CREATE SCHEMA auth;
DO $roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  CREATE ROLE service_role NOLOGIN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  CREATE ROLE authenticated NOLOGIN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  CREATE ROLE anon NOLOGIN;
 END IF;
END;
$roles$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $a$
 SELECT nullif(current_setting('request.jwt.claim.role',true),'');
$a$;
CREATE TABLE public.customers(id uuid PRIMARY KEY,name text);
CREATE TABLE public.orders(
 id uuid PRIMARY KEY,customer_id uuid REFERENCES public.customers(id),
 order_number text,payment_status text,status text,total_amount numeric
);
CREATE TABLE public.razorpay_checkouts(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 status text,amount_refunded_paise bigint,reservation_released_at timestamptz,
 amount_paise bigint,whatsapp_opt_in boolean,gateway_payment_id text
);
CREATE TABLE public.invoices(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),public_token uuid
);
CREATE TABLE public.payments(
 order_id uuid REFERENCES public.orders(id),method text,status text,
 verified_at timestamptz,transaction_reference text,amount numeric
);
CREATE TABLE public.whatsapp_notifications(
 id uuid PRIMARY KEY,order_id uuid REFERENCES public.orders(id),
 recipient_number text,notification_type text,status text,
 send_started_at timestamptz,send_attempts integer DEFAULT 0,
 invoice_url text,created_at timestamptz DEFAULT now()
);
