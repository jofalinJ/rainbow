-- Staged only: review and test with the matching storefront release before applying.
-- Staff roles keep catalogue management access; anonymous customers only see online-published items.
-- This prevents a direct product URL or REST request exposing unpublished designs.
begin;
drop policy if exists "public can view active products" on public.products;
drop policy if exists "staff read products" on public.products;

create policy "public can view published online products"
  on public.products for select to anon, authenticated
  using (
    active
    and exists(
      select 1 from public.erp_online_listings listing
      where listing.product_id=products.id and listing.published=true
    )
  );

create policy "staff read products"
  on public.products for select to authenticated
  using ((select public.is_staff()));
commit;
