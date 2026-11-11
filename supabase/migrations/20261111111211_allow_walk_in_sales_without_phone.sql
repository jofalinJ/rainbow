-- A staff bill can belong to a walk-in customer who supplied no phone number.
-- Storefront checkout and account creation validate phone numbers separately.
alter table public.customers alter column whatsapp_number drop not null;
