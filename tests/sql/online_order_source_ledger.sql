\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 contract test for online stock allocation.
-- Run only against CI database rainbow_online_ci. Never against store data.
create schema auth;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(pg_catalog.current_setting('rainbow_test.actor_id',true),'')::uuid $$;

create type public.inventory_tx_type as enum (
 'stock_in','sale_online','sale_local','return','damage','loss','adjustment'
);
create type public.payment_method as enum ('cash','upi','card','bank_transfer');
create type public.payment_status as enum ('pending','paid','failed');

create table public.products(
 id uuid primary key default gen_random_uuid(),
 product_code text not null,
 product_name text not null,
 type text,
 selling_price numeric(12,2) not null,
 length_cm numeric,
 thickness text,
 gold_amount_g numeric,
 active boolean not null default true
);
create table public.product_variants(
 id uuid primary key default gen_random_uuid(),
 product_id uuid references public.products(id) not null,
 stock_quantity integer not null check(stock_quantity>=0),
 color text not null default '0',
 size text not null default '0',
 active boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.customers(
 id uuid primary key default gen_random_uuid(),
 name text not null,
 whatsapp_number text,
 email text,
 address text,
 city text,
 state text,
 pin_code text,
 updated_at timestamptz not null default now()
);
create table public.orders(
 id uuid primary key default gen_random_uuid(),
 order_number text not null unique,
 customer_id uuid references public.customers(id),
 source text not null,
 status text not null,
 payment_status public.payment_status not null,
 subtotal numeric,
 discount_amount numeric,
 cgst_amount numeric,
 sgst_amount numeric,
 delivery_distance_km numeric,
 delivery_fee numeric,
 total_amount numeric,
 shipping_address text,
 notes text
);
create table public.payments(
 id uuid primary key default gen_random_uuid(),
 order_id uuid references public.orders(id),
 method public.payment_method not null,
 amount numeric not null,
 status public.payment_status not null,
 transaction_reference text
);
create table public.order_items(
 id uuid primary key default gen_random_uuid(),
 order_id uuid references public.orders(id) not null,
 variant_id uuid references public.product_variants(id) not null,
 product_code text not null,
 product_name text not null,
 product_type text,
 variant_color text,
 variant_size text,
 length_cm numeric,
 thickness text,
 gold_amount_g numeric,
 quantity integer not null check(quantity>0),
 unit_price numeric not null,
 discount_amount numeric,
 line_total numeric not null
);
create table public.inventory_transactions(
 id uuid primary key default gen_random_uuid(),
 variant_id uuid references public.product_variants(id) not null,
 transaction_type public.inventory_tx_type not null,
 quantity integer not null check(quantity>0),
 quantity_delta integer,
 stock_before integer,
 stock_after integer,
 reference_order_id uuid references public.orders(id),
 reason text,
 created_by uuid,
 created_at timestamptz not null default now()
);

insert into public.products(id,product_code,product_name,type,selling_price,active)
values ('10000000-0000-4000-8000-000000000001','RG001','Test Earrings','Jewellery',100.00,true);
insert into public.product_variants(id,product_id,stock_quantity,color,size)
values ('00000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',5,'Gold','0');

-- Exercise the staged migration as written (same signature as production).
\ir ../../supabase/migrations/20261017223000_online_order_source_ledger.sql

-- First checkout: pending UPI reference with two allocated pieces.
select public.create_online_order(
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,
 '{"name":"CI customer","whatsapp_number":"9990000000","address":"CI test address","city":"Nagercoil","state":"Tamil Nadu","pin_code":"629001","payment_method":"upi","payment_reference":"CIREF00000001"}'::jsonb,
 null
);

do $$
begin
 if (select stock_quantity from public.product_variants
     where id='00000000-0000-4000-8000-000000000001')<>3 then
   raise exception 'Expected 3 remaining after first online checkout';
 end if;
 if (select count(*) from public.orders where source='online' and payment_status='pending')<>1
   or (select count(*) from public.payments where status='pending')<>1 then
   raise exception 'Online payment incorrectly treated as completed';
 end if;
 if not exists(
   select 1 from public.inventory_transactions t
   join public.orders o on o.id=t.reference_order_id
   where o.source='online' and o.payment_status='pending'
     and t.transaction_type='sale_online'
     and t.quantity=2 and t.quantity_delta=-2
     and t.stock_before=5 and t.stock_after=3
     and t.created_by is null
     and t.reason like '%payment pending%'
 ) then
   raise exception 'Missing source-linked pending payment stock allocation';
 end if;
end $$;

-- Second checkout allocates one more piece, linked to its own order.
select public.create_online_order(
 '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
 '{"name":"CI customer two","whatsapp_number":"9990000001","address":"CI address two","city":"Nagercoil","state":"Tamil Nadu","payment_method":"upi","payment_reference":"CIREF00000002"}'::jsonb,
 null
);

do $$
begin
 if (select stock_quantity from public.product_variants
     where id='00000000-0000-4000-8000-000000000001')<>2
    or (select count(*) from public.inventory_transactions
        where transaction_type='sale_online')<>2 then
   raise exception 'Second order stock or transaction count incorrect';
 end if;
 if exists(
   select 1 from public.order_items oi
   join public.orders o on o.id=oi.order_id
   left join public.inventory_transactions t
     on t.reference_order_id=oi.order_id
     and t.variant_id=oi.variant_id and t.transaction_type='sale_online'
   where o.source='online' and (t.id is null or t.quantity<>oi.quantity)
 ) then
   raise exception 'Order line without matching source-linked movement';
 end if;
end $$;

-- Duplicated variants or insufficient stock must roll back entire checkout.
do $$
declare before_count int;
begin
 select count(*) into before_count from public.orders;
 begin
   perform public.create_online_order(
     '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1},{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
     '{"name":"CI duplicate","whatsapp_number":"9990000002","address":"CI address","state":"Tamil Nadu","payment_method":"upi","payment_reference":"CIREF00000003"}'::jsonb,
     null
   );
   raise exception 'Duplicate variants unexpectedly accepted';
 exception when others then
   if sqlerrm='Duplicate variants unexpectedly accepted' then raise; end if;
 end;
 begin
   perform public.create_online_order(
     '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":3}]'::jsonb,
     '{"name":"CI insufficient","whatsapp_number":"9990000003","address":"CI address","state":"Tamil Nadu","payment_method":"upi","payment_reference":"CIREF00000004"}'::jsonb,
     null
   );
   raise exception 'Insufficient stock unexpectedly accepted';
 exception when others then
   if sqlerrm='Insufficient stock unexpectedly accepted' then raise; end if;
 end;
 if (select count(*) from public.orders) <> before_count
   or (select count(*) from public.inventory_transactions)<>2
   or (select stock_quantity from public.product_variants
       where id='00000000-0000-4000-8000-000000000001')<>2 then
   raise exception 'Failed checkout left behind order, stock or movement changes';
 end if;
end $$;


-- Simulate an order-item write failure AFTER the stock has already changed
-- and the source-linked movement has been inserted. All writes must roll back.
create or replace function public.ci_fail_order_item_insert()
returns trigger language plpgsql as $$
begin
 if pg_catalog.current_setting('rainbow_ci.fail_order_item',true)='yes' then
   raise exception 'CI forced order item failure after stock allocation';
 end if;
 return new;
end $$;
create trigger ci_fail_order_item
  before insert on public.order_items
  for each row execute function public.ci_fail_order_item_insert();
set rainbow_ci.fail_order_item='yes';

do $$
declare original_stock int; original_orders int; original_movements int; original_payments int;
begin
 select stock_quantity into original_stock from public.product_variants
   where id='00000000-0000-4000-8000-000000000001';
 select count(*) into original_orders from public.orders;
 select count(*) into original_movements from public.inventory_transactions;
 select count(*) into original_payments from public.payments;
 begin
   perform public.create_online_order(
     '[{"variant_id":"00000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
     '{"name":"CI forced failure","whatsapp_number":"9990000004","address":"CI address","state":"Tamil Nadu","payment_method":"upi","payment_reference":"CIREF00000005"}'::jsonb,
     null
   );
   raise exception 'Forced order-item failure was unexpectedly accepted';
 exception when others then
   if sqlerrm='Forced order-item failure was unexpectedly accepted' then raise; end if;
   if sqlerrm not like '%CI forced order item failure%' then raise; end if;
 end;
 if (select stock_quantity from public.product_variants
      where id='00000000-0000-4000-8000-000000000001')<>original_stock
    or (select count(*) from public.orders)<>original_orders
    or (select count(*) from public.inventory_transactions)<>original_movements
    or (select count(*) from public.payments)<>original_payments then
   raise exception 'Late order failure left partially committed inventory or payment';
 end if;
end $$;

reset rainbow_ci.fail_order_item;
drop trigger ci_fail_order_item on public.order_items;
drop function public.ci_fail_order_item_insert();

-- A second movement for the same order/SKU must be refused by the unique index.
do $$
declare v record;
begin
 select * into v from public.inventory_transactions limit 1;
 begin
   insert into public.inventory_transactions(
     variant_id,transaction_type,quantity,quantity_delta,stock_before,stock_after,
     reference_order_id,reason
   ) values (
     v.variant_id,'sale_online',v.quantity,v.quantity_delta,v.stock_before,
     v.stock_after,v.reference_order_id,'Accidental duplicate'
   );
   raise exception 'Duplicate source reference unexpectedly accepted';
 exception when unique_violation then null;
 end;
end $$;

-- The check constraint must refuse a mismatched delta even for a new order.
do $$
declare v record;
begin
 select * into v from public.inventory_transactions limit 1;
 begin
   insert into public.inventory_transactions(
     variant_id,transaction_type,quantity,quantity_delta,stock_before,stock_after,
     reference_order_id,reason
   ) values (
     v.variant_id,'sale_online',v.quantity,1,v.stock_before,v.stock_after,
     (select id from public.orders where id<>v.reference_order_id limit 1),'Bad delta'
   );
   raise exception 'Bad allocation delta unexpectedly accepted';
 exception when check_violation then null;
 end;
end $$;

-- Schema/function replacement must be repeatable; new orders remain unchanged.
\ir ../../supabase/migrations/20261017223000_online_order_source_ledger.sql

do $$
begin
 if (select count(*) from public.inventory_transactions)<>2
   or (select count(*) from public.orders)<>2 then
   raise exception 'Migration rerun duplicated history or orders';
 end if;
end $$;

\echo 'PASS: source-linked online allocations, pending payment, rollback, constraints and migration replay'
