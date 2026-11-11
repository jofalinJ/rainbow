-- STAGED: single shared physical-shop inventory for both POS and online.
-- Merely installing this file DOES NOT activate the change.
-- Activation must use the separately gated rollout after synthetic checkout,
-- cancellation, payment, staff POS, and concurrent-sale validation.
begin;

alter table app_private.erp_activation_state
 add column if not exists shared_branch_stock boolean not null default false;

create or replace function app_private.erp_shared_branch_stock()
returns boolean language sql stable security definer
set search_path=pg_catalog,app_private as $$
 select coalesce((select enabled and shared_branch_stock
                  from app_private.erp_activation_state where singleton),false);
$$;
revoke all on function app_private.erp_shared_branch_stock() from public,anon,authenticated;

create or replace function public.erp_shared_inventory_mode()
returns jsonb language sql stable security definer
set search_path=pg_catalog,public,app_private as $$
 select jsonb_build_object('shared_stock',app_private.erp_shared_branch_stock());
$$;
revoke all on function public.erp_shared_inventory_mode() from public,anon,authenticated;
grant execute on function public.erp_shared_inventory_mode() to authenticated;

-- Never accept stock in a second, manual Online Store pool in shared mode.
create or replace function app_private.erp_no_online_pool_when_shared()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
begin
 if app_private.erp_shared_branch_stock()
    and exists(select 1 from public.erp_locations l
               where l.id=new.location_id and l.kind='online')
    and (new.on_hand<>0 or new.reserved<>0)
 then
  raise exception 'Shared inventory mode uses physical shops; no separate online stock allocations are allowed';
 end if;
 return new;
end; $$;
drop trigger if exists erp_shared_online_pool_guard on public.erp_stock_balances;
create trigger erp_shared_online_pool_guard
before insert or update of on_hand,reserved on public.erp_stock_balances
for each row execute function app_private.erp_no_online_pool_when_shared();

-- The existing public product/variant join and checkout cart use this legacy
-- field. In shared mode it is a DERIVED availability mirror of physical shops.
create or replace function app_private.erp_shared_branch_to_legacy()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_kind text; v_available bigint; v_previous text;
begin
 if not app_private.erp_shared_branch_stock()
  or current_setting('erp.stock_origin',true) in ('erp','legacy')
 then return new; end if;
 select kind into v_kind from public.erp_locations where id=new.location_id;
 if v_kind<>'branch' then return new; end if;
 select coalesce(sum(b.on_hand-b.reserved),0) into v_available
 from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
 where b.variant_id=new.variant_id;
 if v_available>2147483647 then raise exception 'Shared stock mirror exceeds integer range'; end if;
 v_previous:=current_setting('erp.stock_origin',true);
 perform set_config('erp.stock_origin','erp',true);
 update public.product_variants set stock_quantity=v_available::integer,updated_at=now()
 where id=new.variant_id and stock_quantity is distinct from v_available::integer;
 perform set_config('erp.stock_origin',coalesce(v_previous,''),true);
 return new;
end; $$;
drop trigger if exists erp_shared_branch_sync on public.erp_stock_balances;
create trigger erp_shared_branch_sync
after insert or update of on_hand,reserved on public.erp_stock_balances
for each row execute function app_private.erp_shared_branch_to_legacy();

-- Preserve the current Online Store bridge while feature flag is OFF.
-- When ON, a checkout quantity change reserves or releases physical shop
-- balances, which are already used by the branch POS RPC.
create or replace function app_private.erp_legacy_checkout_to_online_balance()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare
 v_location uuid; v_old record; v_new_reserved bigint; v_previous text;
 v_remaining bigint; v_change bigint; r record; v_take integer;
begin
 if not app_private.erp_live() or old.stock_quantity=new.stock_quantity
    or current_setting('erp.stock_origin',true)='erp'
 then return new; end if;
 if app_private.erp_shared_branch_stock() then
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
  then raise exception 'Only the verified checkout service may reserve shared shop stock' using errcode='42501'; end if;
  if new.stock_quantity<0 then raise exception 'Shared stock cannot be negative'; end if;
  if new.stock_quantity<old.stock_quantity and not exists(
   select 1 from public.products p
   join public.erp_online_listings l on l.product_id=p.id and l.published
   where p.id=new.product_id and p.active and p.archived_at is null
  ) then raise exception 'This product is not published online'; end if;
  select coalesce(sum(b.on_hand-b.reserved),0) into v_change
  from public.erp_stock_balances b
  join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
  where b.variant_id=new.id;
  if v_change<>old.stock_quantity then raise exception 'Shared shop availability mirror is inconsistent'; end if;
  v_remaining:=abs(old.stock_quantity::bigint-new.stock_quantity::bigint);
  v_previous:=current_setting('erp.stock_origin',true);
  perform set_config('erp.stock_origin','legacy',true);
  for r in
   select b.location_id,b.on_hand,b.reserved
   from public.erp_stock_balances b
   join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
   where b.variant_id=new.id
   order by b.location_id
   for update of b
  loop
   if v_remaining=0 then exit; end if;
   if new.stock_quantity<old.stock_quantity then
    v_take:=least(v_remaining, (r.on_hand-r.reserved)::bigint)::integer;
    if v_take>0 then
     update public.erp_stock_balances set reserved=reserved+v_take,updated_at=now()
     where location_id=r.location_id and variant_id=new.id;
    end if;
   else
    v_take:=least(v_remaining,r.reserved::bigint)::integer;
    if v_take>0 then
     update public.erp_stock_balances set reserved=reserved-v_take,updated_at=now()
     where location_id=r.location_id and variant_id=new.id;
    end if;
   end if;
   v_remaining:=v_remaining-v_take;
  end loop;
  if v_remaining<>0 then raise exception 'Insufficient shop stock or checkout holds to modify'; end if;
  perform set_config('erp.stock_origin',coalesce(v_previous,''),true);
  return new;
 end if;
 select id into v_location from public.erp_locations where kind='online' and active;
 if v_location is null then raise exception 'Active online location not configured'; end if;
 select on_hand,reserved into v_old from public.erp_stock_balances
 where location_id=v_location and variant_id=new.id for update;
 if not found then raise exception 'Online inventory must be explicitly allocated before checkout'; end if;
 if v_old.on_hand-v_old.reserved<>old.stock_quantity then
  raise exception 'Legacy checkout availability diverged from ERP online stock'; end if;
 v_new_reserved:=v_old.reserved::bigint+old.stock_quantity::bigint-new.stock_quantity::bigint;
 if v_new_reserved<0 or v_new_reserved>v_old.on_hand then
  raise exception 'Online reservation exceeds allocated stock or attempted untracked adjustment'; end if;
 v_previous:=current_setting('erp.stock_origin',true);
 perform set_config('erp.stock_origin','legacy',true);
 update public.erp_stock_balances set reserved=v_new_reserved::integer,updated_at=now()
 where location_id=v_location and variant_id=new.id;
 perform set_config('erp.stock_origin',coalesce(v_previous,''),true);
 return new;
end; $$;

-- The already verified payment is the ONLY event that consumes reserved items.
-- In shared mode it consumes from physical shops rather than an online pool.
create or replace function app_private.erp_on_verified_online_payment()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare
 v_location uuid; item record; r record; v_before integer; v_reserved integer;
 v_count integer:=0; v_valid boolean; v_remaining integer; v_take integer;
begin
 if not app_private.erp_live() or new.source<>'online'
  or new.payment_status<>'paid' or old.payment_status='paid'
  or new.status in ('cancelled','refunded') then return new; end if;
 select exists(
   select 1 from public.razorpay_checkouts rc
   where rc.order_id=new.id and rc.status='paid'
 ) or exists(
   select 1 from public.payments p
   where p.order_id=new.id and p.method='upi' and p.status='paid'
   and p.verified_at is not null and p.verified_by is not null
   and p.amount=new.total_amount
 ) into v_valid;
 if not v_valid then raise exception 'Online payment was not independently verified'; end if;
 if app_private.erp_shared_branch_stock() then
  -- Match checkout/POS lock order: variant rows before physical balances.
  perform 1 from public.product_variants
  where id in (select variant_id from public.order_items where order_id=new.id)
  order by id for update;
  for item in
   select variant_id,sum(quantity)::integer as quantity from public.order_items
   where order_id=new.id group by variant_id order by variant_id
  loop
   v_remaining:=item.quantity;
   for r in
    select b.location_id,b.on_hand,b.reserved
    from public.erp_stock_balances b
    join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
    where b.variant_id=item.variant_id and b.reserved>0
    order by b.location_id for update of b
   loop
    if v_remaining=0 then exit; end if;
    v_take:=least(v_remaining,r.reserved);
    update public.erp_stock_balances
    set on_hand=on_hand-v_take,reserved=reserved-v_take,updated_at=now()
    where location_id=r.location_id and variant_id=item.variant_id;
    insert into public.erp_stock_events(
      location_id,variant_id,action,quantity_delta,stock_before,stock_after,idempotency_key,reason
    ) values (
      r.location_id,item.variant_id,'online_sale',-v_take,
      r.on_hand,r.on_hand-v_take,new.id,'Server-verified paid online order from shared shop stock'
    );
    v_remaining:=v_remaining-v_take;
   end loop;
   if v_remaining<>0 then raise exception 'Paid online order has no matching physical shop reservations'; end if;
   v_count:=v_count+1;
  end loop;
  if v_count=0 then raise exception 'Paid online order has no items'; end if;
  return new;
 end if;
 select id into v_location from public.erp_locations where kind='online' and active;
 if v_location is null then raise exception 'Active online shop missing'; end if;
 for item in select variant_id,sum(quantity)::integer as quantity
 from public.order_items where order_id=new.id group by variant_id order by variant_id loop
  select on_hand,reserved into v_before,v_reserved from public.erp_stock_balances
  where location_id=v_location and variant_id=item.variant_id for update;
  if not found or v_before<item.quantity or v_reserved<item.quantity then
   raise exception 'Online paid order has no matching reservation';
  end if;
  update public.erp_stock_balances
  set on_hand=on_hand-item.quantity,reserved=reserved-item.quantity,updated_at=now()
  where location_id=v_location and variant_id=item.variant_id;
  insert into public.erp_stock_events(location_id,variant_id,action,quantity_delta,
   stock_before,stock_after,idempotency_key,reason)
  values(v_location,item.variant_id,'online_sale',-item.quantity,
   v_before,v_before-item.quantity,new.id,'Server-verified paid online order');
  v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'Paid order has no items'; end if;
 return new;
end; $$;
commit;
