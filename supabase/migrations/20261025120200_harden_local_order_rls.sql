-- STAGED SECURITY HARDENING: review and apply before production release.
-- Previous policies allowed any Supabase authenticated customer to write local orders,
-- order items and payments, without checking an active staff profile. All billing
-- writes now go through the server-side create_local_sale function; admins retain
-- their existing explicitly checked policies.
begin;
drop policy if exists "Online orders insert through checked RPCs" on public.orders;
drop policy if exists "Online orders update through checked RPCs" on public.orders;
drop policy if exists "Online orders delete through checked RPCs" on public.orders;
drop policy if exists "Online items insert through checked RPCs" on public.order_items;
drop policy if exists "Online items update through checked RPCs" on public.order_items;
drop policy if exists "Online items delete through checked RPCs" on public.order_items;
drop policy if exists "Online payments insert through checked RPCs" on public.payments;
drop policy if exists "Online payments update through checked RPCs" on public.payments;
drop policy if exists "Online payments delete through checked RPCs" on public.payments;
-- RLS does not protect TRUNCATE. Authenticated app roles do not need these grants.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
commit;
