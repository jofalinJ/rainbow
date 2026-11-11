-- Add the payment-relevant production columns to the disposable ERP fixture
-- after its compatibility tests have exercised the minimal schema.
\set ON_ERROR_STOP on
drop table public.razorpay_checkouts;
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon');
$$;
create type public.payment_status as enum ('pending','paid','partially_paid','failed','refunded');
create type public.inventory_tx_type as enum ('sale_online','sale_local');
create type public.whatsapp_status as enum ('pending','sent','failed');
alter table public.product_variants add column thickness text, add column gold_amount_g numeric;
alter table public.orders add column created_at timestamptz not null default now();
alter table public.order_items add column created_at timestamptz not null default now();
alter table public.payments add column created_at timestamptz not null default now();
alter table public.invoices add column issued_at timestamptz not null default now(),
 alter column public_token set default gen_random_uuid(), add unique (order_id);
alter table public.inventory_transactions alter column transaction_type
 type public.inventory_tx_type using transaction_type::public.inventory_tx_type;
create table public.whatsapp_notifications (
 id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id),
 recipient_number text, notification_type text, message_template text, invoice_url text,
 status public.whatsapp_status not null default 'pending', provider_message_id text,
 error_message text, sent_at timestamptz, created_at timestamptz not null default now()
);
\ir ../../supabase/migrations/20261021194000_razorpay_test_reservation_checkout.sql
\ir ../../supabase/migrations/20261021202500_manual_upi_guest_idempotency.sql
\ir ../../supabase/migrations/20261021234000_finalize_paid_orders_invoice_whatsapp.sql
create function public.audit_order_shipment() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.track_online_order(text,text) returns jsonb language sql as $$ select '[]'::jsonb $$;
create function public.track_guest_order_shipments(text,text) returns jsonb language sql as $$ select '[]'::jsonb $$;
\ir ../../supabase/migrations/20261024142005_harden_checkout_settlement_refunds.sql
\ir ../../supabase/migrations/20261103183000_interstate_igst_checkout.sql
