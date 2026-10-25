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
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','JM001-RED');
grant select on public.products, public.product_variants, public.product_images, public.staff_profiles, public.branches to authenticated;
