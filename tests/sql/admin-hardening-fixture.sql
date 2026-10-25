-- Disposable PostgreSQL fixture only. This never connects to shop production.
\ir payment-fixture.sql
create schema if not exists app_private;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.staff_role as enum ('admin','cashier','inventory_staff');
create table public.staff_profiles(
  user_id uuid primary key references auth.users(id),
  role public.staff_role not null, active boolean not null default true
);
create function public.is_admin() returns boolean language sql stable as $$
  select exists(select 1 from public.staff_profiles where user_id=auth.uid() and role='admin' and active) $$;
create function public.is_cashier() returns boolean language sql stable as $$
  select exists(select 1 from public.staff_profiles where user_id=auth.uid() and role in ('admin','cashier') and active) $$;
create function public.is_inventory_staff() returns boolean language sql stable as $$
  select exists(select 1 from public.staff_profiles where user_id=auth.uid() and role in ('admin','inventory_staff') and active) $$;
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');
insert into public.staff_profiles values
 ('11111111-1111-4111-8111-111111111111','cashier',true),
 ('22222222-2222-4222-8222-222222222222','inventory_staff',true),
 ('33333333-3333-4333-8333-333333333333','admin',true);
alter type public.order_source add value if not exists 'local_store';
create sequence public.local_order_number_seq;
create sequence public.local_invoice_number_seq;
alter table public.products add column category_id uuid;
alter table public.products add column gender text not null default 'women';
alter table public.products add column description text;
alter table public.product_variants add column barcode text;
alter table public.product_variants add column low_stock_limit int not null default 3;
alter table public.product_variants add column length_cm numeric;
alter table public.product_variants add column created_at timestamptz not null default now();
alter table public.order_items add column created_at timestamptz not null default now();
alter table public.orders add column created_by uuid;
create table public.invoices(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  invoice_number text not null unique,
  public_token uuid not null unique,
  issued_at timestamptz not null default now()
);
create table public.inventory_transactions(
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id),
  transaction_type text not null,
  quantity int not null,
  reference_order_id uuid references public.orders(id),
  reason text,created_by uuid
);
create or replace function public.fixture_product_code() returns trigger language plpgsql as $$
begin
  if new.product_code is null then new.product_code='F-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));end if;
  return new;
end $$;
create trigger fixture_product_code before insert on public.products
  for each row execute function public.fixture_product_code();
create or replace function public.fixture_barcode() returns trigger language plpgsql as $$
begin
  if new.barcode is null then new.barcode='B-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));end if;
  return new;
end $$;
create trigger fixture_barcode before insert on public.product_variants
  for each row execute function public.fixture_barcode();
create or replace view public.low_stock_products as
select v.id variant_id,p.product_code,p.product_name,p.type,v.color,v.size,
  v.stock_quantity,v.low_stock_limit,
  case when v.stock_quantity=0 then 'out_of_stock' else 'low_stock' end as stock_status
from public.product_variants v join public.products p on p.id=v.product_id
where v.stock_quantity<=v.low_stock_limit and v.active and p.active;
grant usage on schema public to authenticated,anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- Recreate unsafe policies in a disposable database to verify they are dropped.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
create policy "Online orders insert through checked RPCs" on public.orders for insert to authenticated with check(true);
create policy "Online orders update through checked RPCs" on public.orders for update to authenticated using(true);
create policy "Online orders delete through checked RPCs" on public.orders for delete to authenticated using(true);
create policy "Online items insert through checked RPCs" on public.order_items for insert to authenticated with check(true);
create policy "Online items update through checked RPCs" on public.order_items for update to authenticated using(true);
create policy "Online items delete through checked RPCs" on public.order_items for delete to authenticated using(true);
create policy "Online payments insert through checked RPCs" on public.payments for insert to authenticated with check(true);
create policy "Online payments update through checked RPCs" on public.payments for update to authenticated using(true);
create policy "Online payments delete through checked RPCs" on public.payments for delete to authenticated using(true);
