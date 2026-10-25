-- Disposable PostgreSQL 17 fixture for the staged multi-shop ERP migration.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to public;
create table public.staff_profiles(
 user_id uuid primary key references auth.users(id),
 role text not null,
 active boolean not null default true,
 archived_at timestamptz
);
create table public.branches(
 id uuid primary key,code text unique not null,name text not null
);
create table public.products(
 id uuid primary key,product_code text unique not null,
 product_name text not null,selling_price numeric not null default 100,
 created_at timestamptz not null default now(),active boolean not null default true
);
create table public.product_variants(
 id uuid primary key,product_id uuid not null references public.products(id),
 barcode text unique,color text not null default '0',size text not null default '0',
 active boolean not null default true,stock_quantity integer not null default 0
);
create table public.product_images(
 id uuid primary key, product_id uuid not null references public.products(id),
 is_primary boolean,sort_order integer,public_url text
);
-- Core billing/payment tables required to compile the real branch POS and payment bridge.
create type public.staff_role as enum('admin','cashier','inventory_staff');
create type public.payment_method as enum('cash','upi','card','bank_transfer','razorpay');
create sequence public.local_order_number_seq;
create sequence public.local_invoice_number_seq;
create table public.customers(
 id uuid primary key default gen_random_uuid(),
 name text not null,whatsapp_number text,email text,address text,city text,state text,pin_code text
);
create table public.orders(
 id uuid primary key default gen_random_uuid(),
 order_number text not null unique,
 customer_id uuid not null references public.customers(id),
 source text not null,status text not null,payment_status text not null,
 subtotal numeric(12,2) not null,discount_amount numeric(12,2) not null,
 cgst_amount numeric(12,2) not null,sgst_amount numeric(12,2) not null,
 delivery_distance_km numeric,delivery_fee numeric not null default 0,
 total_amount numeric(12,2) not null,shipping_address text,notes text,
 created_by uuid references auth.users(id),updated_at timestamptz default now()
);
create table public.order_items(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id),
 variant_id uuid not null references public.product_variants(id),
 product_code text not null,product_name text not null,product_type text,
 variant_color text,variant_size text,length_cm numeric,thickness text,gold_amount_g numeric,
 quantity integer not null,unit_price numeric not null,discount_amount numeric default 0,
 line_total numeric not null
);
create table public.payments(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id),
 method public.payment_method not null,amount numeric not null,
 status text not null,transaction_reference text,paid_at timestamptz,
 verified_at timestamptz,verified_by uuid references auth.users(id)
);
create table public.invoices(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id),
 invoice_number text not null,public_token uuid not null
);
create table public.inventory_transactions(
 id uuid primary key default gen_random_uuid(),variant_id uuid not null,
 transaction_type text not null,quantity integer not null,reference_order_id uuid,
 reason text,created_by uuid,quantity_delta integer,stock_before integer,stock_after integer
);
create table public.razorpay_checkouts(
 checkout_id uuid primary key,order_id uuid not null references public.orders(id),
 status text not null
);

insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');
insert into public.staff_profiles(user_id,role) values
 ('11111111-1111-4111-8111-111111111111','admin'),
 ('22222222-2222-4222-8222-222222222222','cashier'),
 ('33333333-3333-4333-8333-333333333333','cashier');
insert into public.branches(id,code,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ONE','Shop One'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','TWO','Shop Two');
insert into public.products(id,product_code,product_name) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','JM001','Jimmiki Earrings');
insert into public.product_variants(id,product_id,barcode) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','JM001-RED'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc','JM001-BLUE');
grant select on public.products, public.product_variants, public.product_images, public.staff_profiles, public.branches to authenticated;
