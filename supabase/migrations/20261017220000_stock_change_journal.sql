-- P0 stock observability, staged migration. DO NOT apply directly to live Rainbow.
-- This is a separate, database-generated change journal, not a replacement for
-- public.inventory_transactions (which stores business reasons/source documents).
-- Baseline rows capture CURRENT stock, not historical stock movements.
--
-- IMPORTANT: apply in ONE transaction. DDL takes a lock on product_variants,
-- preventing an inventory write from slipping between baseline and trigger.
begin;

create table if not exists public.stock_change_events (
  id bigint generated always as identity primary key,
  variant_id uuid not null,
  product_id uuid not null,
  event_kind text not null
    check (event_kind in ('BASELINE','INSERT','UPDATE','DELETE')),
  stock_before integer,
  stock_after integer,
  quantity_delta integer not null,
  actor_user_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  check (stock_before is null or stock_before >= 0),
  check (stock_after is null or stock_after >= 0),
  constraint stock_change_event_balances check (
    (event_kind in ('BASELINE','INSERT')
      and stock_before is null and stock_after is not null
      and quantity_delta=stock_after)
    or
    (event_kind='UPDATE'
      and stock_before is not null and stock_after is not null
      and stock_after<>stock_before
      and quantity_delta=stock_after-stock_before)
    or
    (event_kind='DELETE'
      and stock_before is not null and stock_after is null
      and quantity_delta= -stock_before)
  )
);

-- Preserve one baseline per existing variant even if a staging migration reruns.
create unique index if not exists stock_change_events_baseline_once
  on public.stock_change_events(variant_id) where event_kind='BASELINE';
create index if not exists stock_change_events_variant_idx
  on public.stock_change_events(variant_id,id desc);

alter table public.stock_change_events enable row level security;
-- Deliberately no client SELECT/INSERT/UPDATE/DELETE policy.
revoke all on table public.stock_change_events from public,anon,authenticated;
revoke all on sequence public.stock_change_events_id_seq from public,anon,authenticated;

create or replace function public.record_variant_stock_change()
returns trigger language plpgsql security definer
set search_path = ''
as $function$
begin
  if TG_OP='INSERT' then
    insert into public.stock_change_events(
      variant_id,product_id,event_kind,stock_before,stock_after,quantity_delta,actor_user_id
    ) values (
      new.id,new.product_id,'INSERT',null,new.stock_quantity,new.stock_quantity,auth.uid()
    );
    return new;
  elsif TG_OP='UPDATE' then
    if old.stock_quantity is distinct from new.stock_quantity then
      insert into public.stock_change_events(
        variant_id,product_id,event_kind,stock_before,stock_after,quantity_delta,actor_user_id
      ) values (
        new.id,new.product_id,'UPDATE',old.stock_quantity,new.stock_quantity,
        new.stock_quantity-old.stock_quantity,auth.uid()
      );
    end if;
    return new;
  elsif TG_OP='DELETE' then
    insert into public.stock_change_events(
      variant_id,product_id,event_kind,stock_before,stock_after,quantity_delta,actor_user_id
    ) values (
      old.id,old.product_id,'DELETE',old.stock_quantity,null,
      -old.stock_quantity,auth.uid()
    );
    return old;
  end if;
  raise exception 'Unexpected stock audit trigger operation %',TG_OP;
end;
$function$;

revoke all on function public.record_variant_stock_change() from public,anon,authenticated;

-- Lock the table against concurrent stock writes for the installation/baseline.
-- The triggers and baseline become visible together on transaction commit.
lock table public.product_variants in share row exclusive mode;

-- Snapshot the opening point for existing variants; no stock balance is changed.
insert into public.stock_change_events (
  variant_id,product_id,event_kind,stock_before,stock_after,quantity_delta,actor_user_id
)
select id,product_id,'BASELINE',null,stock_quantity,stock_quantity,null
from public.product_variants
on conflict do nothing;

drop trigger if exists rainbow_variant_stock_insert_audit on public.product_variants;
create trigger rainbow_variant_stock_insert_audit
  after insert on public.product_variants
  for each row execute function public.record_variant_stock_change();

drop trigger if exists rainbow_variant_stock_update_audit on public.product_variants;
create trigger rainbow_variant_stock_update_audit
  after update of stock_quantity on public.product_variants
  for each row when (old.stock_quantity is distinct from new.stock_quantity)
  execute function public.record_variant_stock_change();

drop trigger if exists rainbow_variant_stock_delete_audit on public.product_variants;
create trigger rainbow_variant_stock_delete_audit
  after delete on public.product_variants
  for each row execute function public.record_variant_stock_change();

-- Staff cannot list raw audit rows through PostgREST. They use this restricted
-- read RPC for one variant at a time. Avoid exposing unbounded or global logs.
create or replace function public.get_variant_stock_events(
  p_variant_id uuid,p_limit integer default 30
) returns table (
  id bigint,
  event_kind text,
  quantity_delta integer,
  stock_before integer,
  stock_after integer,
  actor_user_id uuid,
  occurred_at timestamptz
) language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_profiles s
    where s.user_id=auth.uid()
      and s.active=true and s.role in ('admin','inventory_staff')
  ) then
    raise exception 'Inventory history access denied' using errcode='42501';
  end if;
  if p_variant_id is null then
    raise exception 'A variant ID is required' using errcode='22023';
  end if;
  return query
    select e.id,e.event_kind,e.quantity_delta,e.stock_before,e.stock_after,
      e.actor_user_id,e.occurred_at
    from public.stock_change_events e
    where e.variant_id=p_variant_id
    order by e.id desc
    limit least(greatest(coalesce(p_limit,30),1),100);
end;
$function$;
revoke all on function public.get_variant_stock_events(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.get_variant_stock_events(uuid,integer)
  to authenticated;

commit;
