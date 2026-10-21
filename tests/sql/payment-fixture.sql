-- Minimal disposable PostgreSQL schema matching the payment-relevant columns
-- in the live Rainbow Supabase project. CI only; never run on production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.role() returns text language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
create extension if not exists pgcrypto;
create type public.payment_method as enum ('cash','upi','card','razorpay','bank_transfer','cod');
create type public.payment_status as enum ('pending','paid','partially_paid','failed','refunded');
create type public.order_source as enum ('online','local');
create type public.order_status as enum (
  'pending','confirmed','processing','shipped','delivered','cancelled','refunded'
);
create table public.customers(
  id uuid primary key default gen_random_uuid(),
  name text not null,whatsapp_number text not null,
  email text,address text,city text,state text,pin_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.products(
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,product_name text not null,type text not null,
  selling_price numeric not null,active boolean not null default true,
  length_cm numeric,thickness text,gold_amount_g numeric
);
create table public.product_variants(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  stock_quantity integer not null check(stock_quantity>=0),
  active boolean not null default true,color text not null default '0',
  size text not null default '0',updated_at timestamptz not null default now()
);
create table public.orders(
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,customer_id uuid not null references public.customers(id),
  source public.order_source not null,status public.order_status not null default 'pending',
  payment_status public.payment_status not null default 'pending',
  subtotal numeric not null default 0,discount_amount numeric not null default 0,
  cgst_amount numeric not null default 0,sgst_amount numeric not null default 0,
  delivery_fee numeric not null default 0,delivery_distance_km numeric,
  total_amount numeric not null default 0,shipping_address text,notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.payments(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  method public.payment_method not null,amount numeric not null,
  status public.payment_status not null default 'pending',
  transaction_reference text,paid_at timestamptz,verified_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.order_items(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  variant_id uuid not null references public.product_variants(id),
  product_code text not null,product_name text not null,
  quantity integer not null,unit_price numeric not null,
  discount_amount numeric not null default 0,line_total numeric not null,
  product_type text,variant_color text,variant_size text,
  length_cm numeric,thickness text,gold_amount_g numeric
);
insert into public.products(id,product_code,product_name,type,selling_price)
values('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','TEST001','Test chain','chain',100.00);
insert into public.product_variants(id,product_id,stock_quantity)
values('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
       'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',5);
insert into public.customers(id,name,whatsapp_number,address)
values('cccccccc-cccc-4ccc-cccc-cccccccccccc','Original Customer','9999999999','Saved original address');
