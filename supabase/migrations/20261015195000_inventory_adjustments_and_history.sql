-- Phase 1: transactional stock adjustments and immutable transaction history.
-- Reuse inventory_transactions; existing rows/orders/quantities are not changed.
alter table public.inventory_transactions
  add column if not exists quantity_delta integer,
  add column if not exists stock_before integer,
  add column if not exists stock_after integer;

alter table public.inventory_transactions
  drop constraint if exists inventory_adjustment_balances;
alter table public.inventory_transactions
  add constraint inventory_adjustment_balances check (
    transaction_type <> 'adjustment'::public.inventory_tx_type
    or (
      quantity_delta is not null and quantity_delta <> 0
      and stock_before is not null and stock_before >= 0
      and stock_after is not null and stock_after >= 0
      and stock_after - stock_before = quantity_delta
      and quantity = abs(quantity_delta)
    )
  );

-- Make audit history read-only from browsers. Sale/stock RPCs use SECURITY DEFINER.
revoke all privileges on public.inventory_transactions from anon,authenticated;
grant select on public.inventory_transactions to authenticated;

drop policy if exists "admin manage inventory transactions" on public.inventory_transactions;
drop policy if exists "inventory staff manage inventory transactions" on public.inventory_transactions;
drop policy if exists "Authorized staff read stock history" on public.inventory_transactions;
create policy "Authorized staff read stock history"
on public.inventory_transactions for select to authenticated
using ((select public.is_admin()) or (select public.is_inventory_staff()));

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
    and s.active=true and s.role in ('admin','inventory_staff')
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
revoke all on function public.adjust_variant_stock(uuid,integer,text)
from public,anon,authenticated;
grant execute on function public.adjust_variant_stock(uuid,integer,text)
to authenticated;
