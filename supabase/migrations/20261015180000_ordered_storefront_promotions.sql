-- Ordered storefront promotions: one real image per eligible product, up to eight.
-- Keep the legacy single-product setting untouched for backward compatibility.
create table if not exists public.storefront_promotion_items (
  product_id uuid primary key references public.products(id) on delete cascade,
  display_order integer not null unique check (display_order between 1 and 8),
  created_at timestamptz not null default now()
);
alter table public.storefront_promotion_items enable row level security;
revoke all on public.storefront_promotion_items from public,anon,authenticated;
grant select on public.storefront_promotion_items to anon,authenticated;
drop policy if exists "Public can view ordered promotions" on public.storefront_promotion_items;
create policy "Public can view ordered promotions" on public.storefront_promotion_items
  for select to anon,authenticated using (true);

insert into public.storefront_promotion_items(product_id,display_order)
select p.id,1
from public.storefront_promotion old
join public.products p on p.id=old.product_id and p.active=true
where old.id=1
  and exists (select 1 from public.product_images im where im.product_id=p.id and nullif(trim(im.public_url),'') is not null)
  and exists (select 1 from public.product_variants v where v.product_id=p.id and v.active=true and v.stock_quantity>0)
  and not exists(select 1 from public.storefront_promotion_items)
on conflict do nothing;

create or replace function public.set_homepage_promotions(p_product_ids uuid[])
returns void language plpgsql security definer
set search_path = pg_catalog,public as $$
declare
  v_count integer := coalesce(cardinality(p_product_ids),0);
  v_eligible integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_profiles s
    where s.user_id=auth.uid() and s.active=true and s.role='admin'
  ) then
    raise exception 'Only active administrators can edit homepage promotions' using errcode='42501';
  end if;
  if v_count>8 then raise exception 'Choose a maximum of eight products'; end if;
  if v_count>0 and (select count(distinct id) from unnest(p_product_ids) as t(id))<>v_count then
    raise exception 'Duplicate products are not allowed';
  end if;
  if array_position(p_product_ids,null) is not null then
    raise exception 'Invalid product selection';
  end if;
  -- Serialize list updates across administrator sessions.
  perform pg_advisory_xact_lock(71386,20261015);
  select count(*) into v_eligible
  from public.products p
  where p.id=any(p_product_ids) and p.active=true
    and exists(select 1 from public.product_images i
      where i.product_id=p.id and nullif(trim(i.public_url),'') is not null)
    and exists(select 1 from public.product_variants v
      where v.product_id=p.id and v.active=true and v.stock_quantity>0);
  if v_eligible<>v_count then
    raise exception 'Each selected product must be active, stocked and have a real product image';
  end if;
  delete from public.storefront_promotion_items;
  insert into public.storefront_promotion_items(product_id,display_order)
    select id,ord::integer from unnest(p_product_ids) with ordinality as t(id,ord);
  -- Legacy field remains synced to the first selection for clients still using it.
  update public.storefront_promotion
    set product_id=case when v_count>0 then p_product_ids[1] else null end
    where id=1;
end; $$;
revoke all on function public.set_homepage_promotions(uuid[]) from public,anon,authenticated;
grant execute on function public.set_homepage_promotions(uuid[]) to authenticated;
