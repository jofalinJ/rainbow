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

-- Keep the original balance rows. The private ledger records which order owns
-- each hold and which shop must release or fulfill it.
create table app_private.erp_shared_order_reservations (
 order_id uuid not null references public.orders(id),
 variant_id uuid not null references public.product_variants(id),
 location_id uuid not null references public.erp_locations(id),
 quantity integer not null check (quantity > 0),
 state text not null default 'reserved' check (state in ('reserved','released','paid')),
 created_at timestamptz not null default now(),
 settled_at timestamptz,
 primary key (order_id,variant_id,location_id)
);
alter table app_private.erp_shared_order_reservations enable row level security;
revoke all on app_private.erp_shared_order_reservations from public,anon,authenticated,service_role;
create index erp_shared_order_reservations_active_balance_idx
 on app_private.erp_shared_order_reservations(location_id,variant_id) where state='reserved';

create or replace function app_private.erp_shared_available(p_variant uuid)
returns integer language sql stable
set search_path=pg_catalog,public as $$
 select coalesce(sum(b.on_hand-b.reserved),0)::integer
 from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
 where b.variant_id=p_variant;
$$;
revoke all on function app_private.erp_shared_available(uuid) from public,anon,authenticated,service_role;

-- Do not let stale staff sessions create a second pool or dispatch stock to it.
create or replace function app_private.erp_no_online_pool_when_shared()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_location record;
begin
 if not app_private.erp_shared_branch_stock() then
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 if tg_op='DELETE' then
  if old.reserved>0 then raise exception 'Cannot remove a stock balance with active reservations'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and (new.location_id,new.variant_id) is distinct from (old.location_id,old.variant_id)
 then raise exception 'Use a stock transfer to change the location of physical stock'; end if;
 select kind,active into v_location from public.erp_locations where id=new.location_id for share;
 if (new.on_hand<>0 or new.reserved<>0)
 and (v_location.kind is distinct from 'branch' or v_location.active is distinct from true)
 then raise exception 'Shared inventory can only be changed at active physical shops'; end if;
 return new;
end; $$;
revoke all on function app_private.erp_no_online_pool_when_shared() from public,anon,authenticated,service_role;
drop trigger if exists erp_shared_online_pool_guard on public.erp_stock_balances;
create trigger erp_shared_online_pool_guard
before insert or update of location_id,variant_id,on_hand,reserved or delete on public.erp_stock_balances
for each row execute function app_private.erp_no_online_pool_when_shared();

create or replace function app_private.erp_shared_transfer_guard()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
begin
 if app_private.erp_shared_branch_stock() and exists(
  select 1 from public.erp_locations where id in (new.from_location,new.to_location) and kind='online'
 ) then raise exception 'Shared inventory transfers must be between physical shops'; end if;
 return new;
end; $$;
revoke all on function app_private.erp_shared_transfer_guard() from public,anon,authenticated,service_role;
create trigger erp_shared_transfer_guard before insert or update of from_location,to_location on public.erp_transfers
for each row execute function app_private.erp_shared_transfer_guard();

-- Changing which shops supply checkout must not invalidate held pieces or
-- leave the availability mirror stale. A stocked shop must be reconciled first.
create or replace function app_private.erp_shared_location_guard()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
begin
 if app_private.erp_shared_branch_stock()
 and (new.kind,new.active) is distinct from (old.kind,old.active)
 and exists(select 1 from public.erp_stock_balances
            where location_id=old.id and (on_hand<>0 or reserved<>0))
 then raise exception 'Reconcile stock and reservations before changing availability for this shop'; end if;
 return new;
end; $$;
revoke all on function app_private.erp_shared_location_guard() from public,anon,authenticated,service_role;
create trigger erp_shared_location_guard before update of kind,active on public.erp_locations
for each row execute function app_private.erp_shared_location_guard();

create or replace function app_private.erp_shared_branch_to_legacy()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_variant uuid; v_location uuid; v_available integer;
begin
 if not app_private.erp_shared_branch_stock() then return null; end if;
 if tg_op='DELETE' then
  v_variant:=old.variant_id;
  v_location:=old.location_id;
 else
  v_variant:=new.variant_id;
  v_location:=new.location_id;
 end if;
 if not exists(select 1 from public.erp_locations where id=v_location and kind='branch' and active)
 then return null; end if;
 v_available:=app_private.erp_shared_available(v_variant);
 update public.product_variants set stock_quantity=v_available,updated_at=now()
 where id=v_variant and stock_quantity is distinct from v_available;
 return null;
end; $$;
revoke all on function app_private.erp_shared_branch_to_legacy() from public,anon,authenticated,service_role;
drop trigger if exists erp_shared_branch_sync on public.erp_stock_balances;
create trigger erp_shared_branch_sync
after insert or update of on_hand,reserved or delete on public.erp_stock_balances
for each row execute function app_private.erp_shared_branch_to_legacy();

create or replace function app_private.erp_reserve_shared_order_stock(p_order uuid,p_variant uuid,p_quantity integer)
returns void language plpgsql
set search_path=pg_catalog,public,app_private as $$
declare r record; v_remaining integer:=p_quantity; v_take integer;
begin
 if p_quantity is null or p_quantity<1 then raise exception 'Invalid checkout quantity'; end if;
 perform 1 from public.product_variants where id=p_variant for update;
 perform 1 from public.product_variants v
 join public.products p on p.id=v.product_id
 join public.erp_online_listings l on l.product_id=p.id
 where v.id=p_variant and v.active and p.active and p.archived_at is null and l.published
 for share of l;
 if not found then raise exception 'This product is not published online'; end if;
 for r in
  select b.location_id,b.on_hand-b.reserved as available
  from public.erp_stock_balances b
  join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
  where b.variant_id=p_variant and b.on_hand>b.reserved
  order by b.location_id for update of b
 loop
  v_take:=least(v_remaining,r.available);
  update public.erp_stock_balances set reserved=reserved+v_take,updated_at=now()
  where location_id=r.location_id and variant_id=p_variant;
  insert into app_private.erp_shared_order_reservations(order_id,variant_id,location_id,quantity)
  values(p_order,p_variant,r.location_id,v_take);
  v_remaining:=v_remaining-v_take;
  exit when v_remaining=0;
 end loop;
 if v_remaining<>0 then raise exception 'Insufficient available physical shop stock'; end if;
end; $$;
revoke all on function app_private.erp_reserve_shared_order_stock(uuid,uuid,integer) from public,anon,authenticated,service_role;

-- Callers lock the order first. Then lock the variant rows in UUID order, and
-- finally consume or release only the balance rows held for this exact order.
create or replace function app_private.erp_settle_shared_order_stock(p_order uuid,p_paid boolean)
returns void language plpgsql
set search_path=pg_catalog,public,app_private as $$
declare item record; r record; v_remaining bigint; v_after integer; v_count integer:=0;
begin
 perform 1 from public.product_variants
 where id in (select variant_id from public.order_items where order_id=p_order)
 order by id for update;
 for item in
  select variant_id,sum(quantity) as quantity from public.order_items
  where order_id=p_order group by variant_id order by variant_id
 loop
  v_remaining:=item.quantity;
  for r in
   select location_id,quantity from app_private.erp_shared_order_reservations
   where order_id=p_order and variant_id=item.variant_id and state='reserved'
   order by location_id
  loop
   update public.erp_stock_balances
   set on_hand=on_hand-case when p_paid then r.quantity else 0 end,
       reserved=reserved-r.quantity,updated_at=now()
   where location_id=r.location_id and variant_id=item.variant_id and reserved>=r.quantity
   returning on_hand into v_after;
   if not found then raise exception 'Missing physical shop reservation for order %',p_order; end if;
   if p_paid then
    insert into public.erp_stock_events(location_id,variant_id,action,quantity_delta,
      stock_before,stock_after,idempotency_key,reason)
    values(r.location_id,item.variant_id,'online_sale',-r.quantity,
      v_after+r.quantity,v_after,p_order,'Verified online order from shared shop stock');
   end if;
   update app_private.erp_shared_order_reservations
   set state=case when p_paid then 'paid' else 'released' end,settled_at=now()
   where order_id=p_order and variant_id=item.variant_id and location_id=r.location_id;
   v_remaining:=v_remaining-r.quantity;
  end loop;
  if v_remaining<>0 then raise exception 'Physical shop reservations do not match order %',p_order; end if;
  v_count:=v_count+1;
 end loop;
 if v_count=0 or exists(
  select 1 from app_private.erp_shared_order_reservations where order_id=p_order and state='reserved'
 ) then raise exception 'Incomplete physical shop reservation ledger for order %',p_order; end if;
end; $$;
revoke all on function app_private.erp_settle_shared_order_stock(uuid,boolean) from public,anon,authenticated,service_role;

create or replace function app_private.erp_release_cancelled_order_stock()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
begin
 if app_private.erp_shared_branch_stock()
 and old.source='online' and old.status not in ('cancelled','refunded')
 and new.status='cancelled' and old.payment_status in ('pending','failed')
 then
  perform app_private.erp_settle_shared_order_stock(new.id,false);
 end if;
 return new;
end; $$;
revoke all on function app_private.erp_release_cancelled_order_stock() from public,anon,authenticated,service_role;
create trigger erp_release_cancelled_order_stock before update of status on public.orders
for each row execute function app_private.erp_release_cancelled_order_stock();

-- While staged mode is off, keep the existing online-only mirror and checkout.
create or replace function app_private.erp_online_balance_to_legacy()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_kind text; v_previous text;
begin
 if app_private.erp_shared_branch_stock() then return new; end if;
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
create or replace function app_private.erp_legacy_checkout_to_online_balance()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_location uuid; v_old record; v_new_reserved bigint; v_previous text;
begin
 if app_private.erp_shared_branch_stock() then
  if new.stock_quantity is distinct from app_private.erp_shared_available(new.id) then
   raise exception 'Shared availability is maintained by physical shop stock'
    using errcode='42501';
  end if;
  return new;
 end if;
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
 if app_private.erp_shared_branch_stock() then
  perform app_private.erp_settle_shared_order_stock(new.id,true);
  return new;
 end if;
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
create or replace function public.erp_public_catalogue(p_page integer default 0,p_limit integer default 24,p_search text default '')
returns jsonb language sql stable security definer
set search_path=pg_catalog,public as $$
with bounds as (
 select greatest(0,least(coalesce(p_page,0),10000)) as page,
        greatest(1,least(coalesce(p_limit,24),48)) as page_size,
        left(btrim(coalesce(p_search,'')),70) as term
), listing as (
 select p.id as product_id,p.product_code,p.product_name,
        v.id as variant_id,v.color,v.size,v.barcode,
        case when app_private.erp_shared_branch_stock() then p.selling_price
          else coalesce(l.online_price,p.selling_price) end as price,
        case when app_private.erp_shared_branch_stock() then v.stock_quantity
          else greatest(0,coalesce(b.on_hand-b.reserved,0)) end as available,
        image.public_url as primary_image
 from public.erp_online_listings l
 join public.products p on p.id=l.product_id and p.active
 join public.product_variants v on v.product_id=p.id and v.active
 cross join bounds limit_options
 left join public.erp_locations ol on ol.kind='online' and ol.active
 left join public.erp_stock_balances b on b.location_id=ol.id and b.variant_id=v.id
 left join lateral (
   select pi.public_url from public.product_images pi
   where pi.product_id=p.id
   order by pi.is_primary desc nulls last,pi.sort_order,pi.id limit 1
 ) image on true
 where l.published and (ol.id is not null or app_private.erp_shared_branch_stock())
 and (not app_private.erp_shared_branch_stock() or p.archived_at is null)
 and (limit_options.term='' or
 p.product_code ilike '%'||limit_options.term||'%' or
 p.product_name ilike '%'||limit_options.term||'%')
 order by p.product_code,v.id
 limit (select page_size from bounds)
 offset (select page*page_size from bounds)
)
select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(listing)),'[]'::jsonb),
'page',(select page from bounds),'page_size',(select page_size from bounds)) from listing;
$$;

-- Amend the currently installed RPCs so applying the staged migration to a
-- database with existing migration history does not require replaying it.
-- Refuse any unexpected signature/source before changing the function.
do $checkout$
declare v_sig text; v_source text; v_update text; v_loop text; v_variant text;
begin
 for v_sig,v_update,v_loop,v_variant in
  select * from (values
   ('public.create_razorpay_checkout(uuid,jsonb,jsonb)',
    'update public.product_variants' || E'\n      set stock_quantity=stock_quantity-v_qty,updated_at=now()\n      where id=v_variant;',
    'order by value->>''variant_id'' loop','v_variant'),
   ('public.create_online_order(jsonb,jsonb,numeric)',
    'update public.product_variants' || E'\n    set stock_quantity=stock_quantity-v_qty, updated_at=now()\n    where id=v_id;',
    'from jsonb_array_elements(p_items) loop','v_id')
  ) as patches(signature,stock_update,loop_anchor,variant_name)
 loop
  select pg_get_functiondef(to_regprocedure(v_sig)) into v_source;
  if v_source is null
    or (length(v_source)-length(replace(v_source,v_update,'')))/length(v_update)<>1
    or (length(v_source)-length(replace(v_source,v_loop,'')))/length(v_loop)<>2
    or strpos(v_source,'count(distinct value->>''variant_id'')')=0
  then raise exception 'Refusing shared stock: unrecognized checkout RPC %',v_sig; end if;
  v_source:=replace(v_source,v_loop,
    case when v_variant='v_id' then 'from jsonb_array_elements(p_items) ' else '' end||
    'order by (value->>''variant_id'')::uuid loop');
  v_source:=replace(v_source,'count(distinct value->>''variant_id'')',
    'count(distinct (value->>''variant_id'')::uuid)');
  v_source:=replace(v_source,v_update,
    'if app_private.erp_shared_branch_stock() then'||E'\n      '||
    'perform app_private.erp_reserve_shared_order_stock(v_order_id,'||v_variant||',v_qty);'||
    E'\n    else\n      '||v_update||E'\n    end if;');
  execute v_source;
 end loop;
end $checkout$;

-- Keep shop stock writers in the same lock order as checkout. The existing
-- authorization, input checks, idempotency, and off-mode behavior are preserved.
do $locks$
declare v_name text; v_sig text; v_anchor text; v_lock text; v_source text;
begin
 for v_name,v_sig,v_anchor,v_lock in
  select * from (values
   ('adjust','public.erp_adjust_stock(uuid,uuid,integer,text,uuid)',
    ' insert into public.erp_stock_balances(location_id,variant_id)',
    ' perform 1 from public.product_variants where id=p_variant for update;'),
   ('dispatch','public.erp_dispatch_transfer(uuid,uuid,uuid,integer,text,uuid)',
    ' select on_hand into v_before from public.erp_stock_balances',
    ' perform 1 from public.product_variants where id=p_variant for update;'),
   ('receive_transfer','public.erp_receive_transfer(uuid)',
    ' insert into public.erp_stock_balances(location_id,variant_id)',
    ' perform 1 from public.product_variants where id=v.variant_id for update;'),
   ('receive_purchase','public.erp_receive_purchase(uuid,integer,uuid)',
    ' insert into public.erp_stock_balances(location_id,variant_id)',
    ' perform 1 from public.product_variants where id=v_line.variant_id for update;'),
   ('pos','public.erp_create_local_sale(jsonb,jsonb,text,uuid,uuid)',
    '  for v_item in select value from jsonb_array_elements(p_items) order by value->>''variant_id'' loop'||
    E'\n    v_count := v_count + 1;',
    '  perform 1 from public.product_variants where id in ('||
     'select (value->>''variant_id'')::uuid from jsonb_array_elements(p_items)'||
     ') order by id for update;')
  ) as patches(name,signature,anchor,lock_stmt)
 loop
  select pg_get_functiondef(to_regprocedure(v_sig)) into v_source;
  if v_source is null
   or (length(v_source)-length(replace(v_source,v_anchor,'')))/length(v_anchor)<>1
  then raise exception 'Refusing shared stock: unrecognized % RPC version',v_name; end if;
  v_source:=replace(v_source,v_anchor,
    ' if app_private.erp_shared_branch_stock() then'||E'\n'||v_lock||E'\n end if;\n'||v_anchor);
  execute v_source;
 end loop;
end $locks$;

commit;
