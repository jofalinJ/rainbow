-- One homepage promotion selection; read-only for shoppers, writable only by active admins.
-- Applied to Supabase on 2026-10-15 (migration version 20261015093339).
create table if not exists public.storefront_promotion (
  id smallint primary key check (id = 1),
  product_id uuid references public.products(id) on delete set null
);

insert into public.storefront_promotion(id,product_id)
values (1,null) on conflict (id) do nothing;

alter table public.storefront_promotion enable row level security;
revoke all on table public.storefront_promotion from public, anon, authenticated;
grant select on table public.storefront_promotion to anon, authenticated;
grant update(product_id) on table public.storefront_promotion to authenticated;

drop policy if exists "Anyone can read homepage promotion" on public.storefront_promotion;
create policy "Anyone can read homepage promotion" on public.storefront_promotion
  for select to anon, authenticated using (id = 1);

drop policy if exists "Admins can update homepage promotion" on public.storefront_promotion;
create policy "Admins can update homepage promotion" on public.storefront_promotion
  for update to authenticated
  using (id = 1 and (select public.is_admin()))
  with check (id = 1 and (select public.is_admin()));
