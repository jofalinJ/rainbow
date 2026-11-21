-- Disposable PostgreSQL 17 fixture for public invoice bearer token privacy.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END;
$roles$;
CREATE TABLE public.customers (
 id uuid PRIMARY KEY,name text,whatsapp_number text,email text,
 address text,city text,state text,pin_code text
);
CREATE TABLE public.orders (
 id uuid PRIMARY KEY,customer_id uuid REFERENCES public.customers(id),
 order_number text,source text,status text,payment_status text,
 subtotal numeric,discount_amount numeric,cgst_amount numeric,sgst_amount numeric,
 igst_amount numeric,delivery_fee numeric,total_amount numeric
);
CREATE TABLE public.invoices (
 id uuid PRIMARY KEY,order_id uuid REFERENCES public.orders(id),
 invoice_number text,issued_at timestamptz DEFAULT now(),public_token uuid UNIQUE
);
CREATE TABLE public.order_items (
 id uuid PRIMARY KEY,order_id uuid REFERENCES public.orders(id),
 product_code text,product_name text,product_type text,variant_color text,
 variant_size text,length_cm numeric,thickness text,gold_amount_g numeric,
 quantity integer,unit_price numeric,discount_amount numeric,line_total numeric,
 created_at timestamptz DEFAULT now()
);
CREATE TABLE public.razorpay_checkouts (order_id uuid,status text);
CREATE TABLE public.payments (
 order_id uuid,method text,status text,verified_by uuid,verified_at timestamptz,
 paid_at timestamptz,created_at timestamptz DEFAULT now()
);
INSERT INTO public.customers(id,name,whatsapp_number,email,address,city,state,pin_code) VALUES
 ('11111111-1111-4111-8111-111111111111','Test Customer','919999999999','private@example.test',
  'SECRET STREET','PRIVATE CITY','PRIVATE STATE','999999');
INSERT INTO public.orders(id,customer_id,order_number,source,status,payment_status,
 subtotal,discount_amount,cgst_amount,sgst_amount,igst_amount,delivery_fee,total_amount)
VALUES
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
  'RG-PAID-TEST','online','confirmed','paid',100,0,0,0,18,0,118),
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
  'RG-UNPAID-TEST','online','pending','pending',100,0,0,0,18,0,118),
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',
  'RG-LOCAL-TEST','local_store','confirmed','paid',90,0,0,0,0,0,90);
INSERT INTO public.invoices(id,order_id,invoice_number,public_token) VALUES
 ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222',
  'TEST-PAID','aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('55555555-5555-4555-8555-555555555556','33333333-3333-4333-8333-333333333333',
  'TEST-UNPAID','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('55555555-5555-4555-8555-555555555557','44444444-4444-4444-8444-444444444444',
  'TEST-LOCAL','aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO public.razorpay_checkouts(order_id,status)
VALUES('22222222-2222-4222-8222-222222222222','paid');
INSERT INTO public.order_items(id,order_id,product_code,product_name,quantity,
  unit_price,discount_amount,line_total) VALUES
 ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222',
  'RG-TEST','Test Jewellery',1,100,0,100);
INSERT INTO public.payments(order_id,method,status,verified_at,paid_at) VALUES
 ('22222222-2222-4222-8222-222222222222','razorpay','paid',now(),now()),
 ('44444444-4444-4444-8444-444444444444','cash','paid',now(),now());
GRANT USAGE ON SCHEMA public TO anon;
