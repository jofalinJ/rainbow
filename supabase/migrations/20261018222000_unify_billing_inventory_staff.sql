-- Unify the shop's two non-admin staff experiences without changing admin access.
-- The canonical DB enum value is 'cashier' for compatibility with the existing
-- create-staff-user Edge Function and create_local_sale RPC. The UI calls it Staff.
-- Retain inventory_staff as a legacy enum label for older clients only.
begin;

-- Existing product, variant, category and inventory RLS policies call this helper.
-- The helper must recognize the canonical combined staff role.
create or replace function public.is_inventory_staff()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = (select auth.uid())
      and role in ('cashier', 'inventory_staff')
      and active = true
  );
$$;

-- The stock adjustment RPC has an independent, direct role guard.
create or replace function public.adjust_variant_stock(
  p_variant_id uuid, p_quantity_change integer, p_reason text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason,''));
  v_before integer;
  v_after bigint;
  v_tx uuid;
begin
  if v_actor is null or not exists(
    select 1 from public.staff_profiles s where s.user_id=v_actor
    and s.active=true and s.role in ('admin','cashier','inventory_staff')
  ) then
    raise exception 'Only authorized inventory staff may adjust stock' using errcode='42501';
  end if;
  if p_variant_id is null or p_quantity_change is null or p_quantity_change=0
     or p_quantity_change < -100000 or p_quantity_change > 100000 then
    raise exception 'Enter a non-zero stock change of at most 100,000 units';
  end if;
  if length(v_reason)<8 or length(v_reason)>240 then
    raise exception 'Enter a reason between 8 and 240 characters';
  end if;
  select v.stock_quantity into v_before
  from public.product_variants v
  join public.products p on p.id=v.product_id
  where v.id=p_variant_id and v.active=true and p.active=true
  for update of v;
  if not found then raise exception 'Active product variant not found'; end if;
  v_after := v_before::bigint+p_quantity_change::bigint;
  if v_after < 0 then raise exception 'Cannot remove more than the available stock (%)',v_before; end if;
  if v_after > 1000000000 then raise exception 'Stock total is outside allowed range'; end if;

  update public.product_variants set stock_quantity=v_after::integer
  where id=p_variant_id;
  insert into public.inventory_transactions(
    variant_id,transaction_type,quantity,quantity_delta,
    stock_before,stock_after,reason,created_by
  ) values (
    p_variant_id,'adjustment',abs(p_quantity_change),p_quantity_change,
    v_before,v_after::integer,v_reason,v_actor
  ) returning id into v_tx;

  return jsonb_build_object(
    'transaction_id',v_tx,'variant_id',p_variant_id,'old_stock',v_before,
    'new_stock',v_after::integer,'quantity_change',p_quantity_change
  );
end $$;

-- Prevent old clients or admin requests from creating a separate inventory-only
-- role in future. No changes to protected administrator assignments.
create or replace function public.canonicalize_shop_staff_role()
returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if new.role = 'inventory_staff'::public.staff_role then
    new.role := 'cashier'::public.staff_role;
  end if;
  return new;
end;
$$;

drop trigger if exists canonicalize_shop_staff_role_trigger on public.staff_profiles;
create trigger canonicalize_shop_staff_role_trigger
before insert or update of role on public.staff_profiles
for each row execute function public.canonicalize_shop_staff_role();

-- Upgrade all existing inventory-only staff, preserving their user IDs,
-- passwords, photos, activity flags, historical sales and attendance.
update public.staff_profiles
set role = 'cashier'::public.staff_role
where role = 'inventory_staff'::public.staff_role;

commit;
