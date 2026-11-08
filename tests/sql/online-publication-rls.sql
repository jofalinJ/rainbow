-- Runs ONLY on the disposable ERP PostgreSQL fixture. Never execute against production.
-- Create the minimum current RLS environment then apply the actual staged migration.
create or replace function public.is_staff() returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
  select exists(select 1 from public.staff_profiles s where s.user_id=(select auth.uid()) and s.active)
$$;
revoke all on function public.is_staff() from public,anon,authenticated;
grant execute on function public.is_staff() to authenticated;

alter table public.products enable row level security;
grant select on public.products to anon,authenticated;
create policy "public can view active products" on public.products
  for select to anon,authenticated using (active);
create policy "staff read products" on public.products
  for select to authenticated using (active);

insert into public.products(id,product_code,product_name)
values
  ('ffffffff-ffff-4fff-8fff-fffffffffff0','RLS-HIDDEN','Unpublished test'),
  ('ffffffff-ffff-4fff-8fff-fffffffffff1','RLS-VISIBLE','Published test');
insert into public.erp_online_listings(product_id,published)
values ('ffffffff-ffff-4fff-8fff-fffffffffff1',true);

\i supabase/migrations/20261108153000_restrict_public_product_visibility.sql

-- An anonymous visitor must not see active but unpublished products, even via REST.
set role anon;
do $$
declare n integer;
begin
 select count(*) into n from public.products
 where id in ('ffffffff-ffff-4fff-8fff-fffffffffff0'::uuid,
              'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid);
 if n<>1 then raise exception 'Anonymous publication enforcement failed: %', n; end if;
end $$;
reset role;

-- Real staff still have full product-management visibility.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare n integer;
begin
 select count(*) into n from public.products
 where id in ('ffffffff-ffff-4fff-8fff-fffffffffff0'::uuid,
              'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid);
 if n<>2 then raise exception 'Staff access unexpectedly narrowed: %', n; end if;
end $$;
reset role;

-- Being signed in is not equivalent to being staff.
set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
do $$
declare n integer;
begin
 select count(*) into n from public.products
 where id in ('ffffffff-ffff-4fff-8fff-fffffffffff0'::uuid,
              'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid);
 if n<>1 then raise exception 'Customer can view unpublished design: %', n; end if;
end $$;
reset role;
