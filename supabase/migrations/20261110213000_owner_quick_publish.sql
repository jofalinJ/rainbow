-- Owner quick-publish extension for the EXISTING Rainbow Cloudflare/Supabase shop.
-- Run manually after reviewing and backing up the database; do not deploy this to
-- a separate Next.js/Vercel database. Existing checkout, stock and pricing functions
-- continue to own inventory and money.
begin;

alter table public.products
  add column if not exists archived_at timestamptz;
create index if not exists products_archived_at_idx
  on public.products (archived_at, created_at desc);

-- A sixth photo is permitted by the new owner editor; preserve the existing
-- product row lock so concurrent uploads cannot exceed the limit.
create or replace function public.enforce_product_image_limit()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare existing_count integer;
begin
  if tg_op = 'UPDATE' and new.product_id is not distinct from old.product_id then
    return new;
  end if;
  perform 1 from public.products where id = new.product_id for update;
  if not found then
    raise exception 'Product not found for image.';
  end if;
  select count(*) into existing_count
    from public.product_images where product_id = new.product_id;
  if existing_count >= 6 then
    raise exception 'A product may have no more than 6 images.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_product_image_limit()
  from public, anon, authenticated;

-- Publishing must not expose a blank, non-priced or archived item.
-- This is an extra server-side guard; it does not replace existing admin RLS.
create or replace function public.owner_validate_online_publication()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
begin
  if new.published and not exists (
    select 1 from public.products p
    where p.id = new.product_id
      and p.active
      and p.archived_at is null
      and length(btrim(p.product_name)) > 0
      and p.selling_price > 0
      and exists (select 1 from public.product_images i where i.product_id = p.id)
  ) then
    raise exception 'Add an active product, a positive price and at least one photo before publishing.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.owner_validate_online_publication()
  from public, anon, authenticated;
drop trigger if exists owner_validate_online_publication on public.erp_online_listings;
create trigger owner_validate_online_publication
  before insert or update of published on public.erp_online_listings
  for each row execute function public.owner_validate_online_publication();

commit;

-- No new tables or service-role keys are required. Existing tables:
-- public.products (rupee prices), product_variants (online stock mirror),
-- product_images, categories, erp_online_listings, erp_stock_balances.
-- Only authenticated admin users can write, under the pre-existing RLS policies.
