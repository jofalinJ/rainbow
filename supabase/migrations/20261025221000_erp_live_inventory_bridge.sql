-- Activate one authoritative inventory: branch physical balances; online reservation mirrors legacy checkout availability.
-- IMPORTANT: initial state stays DISABLED until schema tests pass and a deliberate activation SQL flips it.
begin;

create table if not exists app_private.erp_activation_state(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 activated_at timestamptz
);
insert into app_private.erp_activation_state(singleton,enabled) values(true,false)
on conflict(singleton) do nothing;
revoke all on app_private.erp_activation_state from public,anon,authenticated;

create or replace function app_private.erp_live()
returns boolean language sql stable security definer
set search_path=pg_catalog,app_private as $$
 select coalesce((select enabled from app_private.erp_activation_state where singleton),false);
$$;
revoke all on function app_private.erp_live() from public,anon,authenticated;

-- A new variant must have zero opening stock; staff then explicitly receive it at a branch.
create or replace function app_private.erp_new_variant_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 if app_private.erp_live() and new.stock_quantity<>0 then
   raise exception 'Start this variant at zero stock, then receive it into a shop using Inventory.';
 end if;
 return new;
end; $$;
drop trigger if exists erp_new_variant_zero_stock on public.product_variants;
create trigger erp_new_variant_zero_stock before insert on public.product_variants
for each row execute function app_private.erp_new_variant_guard();

-- A changed online allocation updates the legacy storefront quantity.
-- In ERP-live mode legacy stock_quantity MUST equal online on_hand - reserved.
create or replace function app_private.erp_online_balance_to_legacy()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_kind text; v_previous text;
begin
 if not app_private.erp_live() or
 current_setting('erp.stock_origin',true)='legacy' then return new; end if;
 select kind into v_kind from public.erp_locations where id=new.location_id;
 if v_kind<>'online' then return new; end if;
 if new.on_hand>0 and not exists(
 select 1 from public.erp_online_listings l join public.product_variants v on v.product_id=l.product_id
 join public.products p on p.id=l.product_id
 where v.id=new.variant_id and l.published and v.active and p.active)
 then raise exception 'Publish an active product before allocating online stock'; end if;
 v_previous:=current_setting('erp.stock_origin',true);
 perform set_config('erp.stock_origin','erp',true);
 update public.product_variants set stock_quantity=new.on_hand-new.reserved
 where id=new.variant_id and stock_quantity is distinct from new.on_hand-new.reserved;
 perform set_config('erp.stock_origin',coalesce(v_previous,''),true);
 return new;
end; $$;
drop trigger if exists erp_sync_online_balance on public.erp_stock_balances;
create trigger erp_sync_online_balance
after insert or update of on_hand,reserved on public.erp_stock_balances
for each row execute function app_private.erp_online_balance_to_legacy();

-- Existing server-verified online checkout creates holds by decrementing the
-- legacy visible available quantity. Mirror into ERP reserved, never on_hand.
-- Release/expiry increments visible stock -> releases ERP reservation.
create or replace function app_private.erp_legacy_checkout_to_online_balance()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_location uuid; v_old record; v_new_reserved bigint; v_previous text;
begin
 if not app_private.erp_live() or old.stock_quantity=new.stock_quantity
 or current_setting('erp.stock_origin',true)='erp' then return new; end if;
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
drop trigger if exists erp_sync_legacy_checkout on public.product_variants;
create trigger erp_sync_legacy_checkout
after update of stock_quantity on public.product_variants
for each row when (old.stock_quantity is distinct from new.stock_quantity)
execute function app_private.erp_legacy_checkout_to_online_balance();

-- When a server-verified payment advances an online order to PAID, convert
-- its existing hold into shipped/paid stock ONCE. Late paid-but-cancelled
-- checkouts remain refund-required and do not consume inventory.
create or replace function app_private.erp_on_verified_online_payment()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_location uuid; item record; v_before integer; v_reserved integer; v_count integer:=0;
 v_valid boolean;
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
 select id into v_location from public.erp_locations where kind='online' and active;
 if v_location is null then raise exception 'Active online shop missing'; end if;
 for item in select variant_id,sum(quantity)::integer as quantity
 from public.order_items where order_id=new.id group by variant_id order by variant_id loop
  select on_hand,reserved into v_before,v_reserved
  from public.erp_stock_balances
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
drop trigger if exists erp_settle_paid_order_stock on public.orders;
create trigger erp_settle_paid_order_stock after update of payment_status on public.orders
for each row when (new.payment_status='paid' and old.payment_status is distinct from 'paid')
execute function app_private.erp_on_verified_online_payment();

-- Prevent removing public publication from products still available online.
create or replace function app_private.erp_unpublish_stock_guard()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
begin
 if app_private.erp_live() and old.published and not new.published
 and exists(select 1 from public.erp_stock_balances b
  join public.product_variants v on v.id=b.variant_id
  join public.erp_locations l on l.id=b.location_id
  where v.product_id=new.product_id and l.kind='online' and b.on_hand>0)
 then raise exception 'Transfer remaining online stock back to a shop before unpublishing'; end if;
 return new;
end; $$;
drop trigger if exists erp_guard_unpublish on public.erp_online_listings;
create trigger erp_guard_unpublish before update of published on public.erp_online_listings
for each row execute function app_private.erp_unpublish_stock_guard();

-- Refuse old POS / manual inventory RPCs once ERP owns physical stock, so
-- stale cached tablets cannot change online-only legacy stock counts.
create or replace function app_private.erp_disable_legacy_staff_rpc()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 return new;
end; $$;
-- These revocations are performed separately at the final activation gate,
-- after the updated POS script is deployed and tested.
commit;
