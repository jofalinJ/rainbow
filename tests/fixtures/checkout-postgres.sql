-- Local QA support schema only. This file is never applied to production.
alter type public.order_source add value if not exists 'local_store';
alter table public.order_items add column if not exists created_at timestamptz not null default now();
alter table public.payments add column if not exists verified_by uuid;
create type public.inventory_tx_type as enum ('sale_online');
create type public.whatsapp_status as enum ('pending','sent','failed');
create table public.invoices(
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id),
 invoice_number text not null unique, public_token uuid not null unique default gen_random_uuid(),
 issued_at timestamptz not null default now()
);
create table public.inventory_transactions(
 id uuid primary key default gen_random_uuid(),variant_id uuid not null references public.product_variants(id),
 transaction_type public.inventory_tx_type not null,quantity integer not null,quantity_delta integer not null,
 reference_order_id uuid references public.orders(id),reason text,created_at timestamptz not null default now()
);
create table public.whatsapp_notifications(
 id uuid primary key default gen_random_uuid(),order_id uuid references public.orders(id),
 recipient_number text,notification_type text,message_template text,invoice_url text,
 status public.whatsapp_status not null default 'pending',provider_message_id text,error_message text,
 sent_at timestamptz,created_at timestamptz not null default now()
);
