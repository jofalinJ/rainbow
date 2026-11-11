-- Restrict legacy direct local-store billing mutations to active cashiers.
-- Previously any authenticated storefront customer could satisfy the source <> online
-- condition on orders, order_items and payments. Backend SECURITY DEFINER billing
-- RPCs retain their own role/transaction checks and are unaffected by this change.
-- Admin has separate "admin manage ..." ALL policies on each table.
-- Use ::text so the guard remains valid for the production order_source enum.
begin;

alter policy "Online orders insert through checked RPCs" on public.orders
  with check ((source::text <> 'online') and (select public.is_cashier()));
alter policy "Online orders update through checked RPCs" on public.orders
  using ((source::text <> 'online') and (select public.is_cashier()))
  with check ((source::text <> 'online') and (select public.is_cashier()));
alter policy "Online orders delete through checked RPCs" on public.orders
  using ((source::text <> 'online') and (select public.is_cashier()));

alter policy "Online items insert through checked RPCs" on public.order_items
  with check ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.source::text <> 'online'
  ));
alter policy "Online items update through checked RPCs" on public.order_items
  using ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.source::text <> 'online'
  ))
  with check ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.source::text <> 'online'
  ));
alter policy "Online items delete through checked RPCs" on public.order_items
  using ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.source::text <> 'online'
  ));

alter policy "Online payments insert through checked RPCs" on public.payments
  with check ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = payments.order_id and o.source::text <> 'online'
  ));
alter policy "Online payments update through checked RPCs" on public.payments
  using ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = payments.order_id and o.source::text <> 'online'
  ))
  with check ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = payments.order_id and o.source::text <> 'online'
  ));
alter policy "Online payments delete through checked RPCs" on public.payments
  using ((select public.is_cashier()) and exists (
    select 1 from public.orders o
    where o.id = payments.order_id and o.source::text <> 'online'
  ));

commit;
