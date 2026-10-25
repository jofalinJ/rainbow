-- Multi-shop ERP foundation. Staged only: DO NOT run on production until stock cutover is reviewed.
-- Existing variants.stock_quantity and payment/billing RPCs are intentionally unchanged.
begin;
create schema if not exists app_private;

create or replace function app_private.erp_is_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
 select exists(select 1 from public.staff_profiles
 where user_id=(select auth.uid()) and active and archived_at is null and role='admin');
$$;
revoke all on function app_private.erp_is_admin() from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.erp_is_admin() to authenticated;

create table if not exists public.erp_locations(
 id uuid primary key default gen_random_uuid(),
 branch_id uuid unique references public.branches(id),
 code text not null unique check(length(code) between 2 and 60),
 name text not null check(length(name) between 2 and 160),
 kind text not null check(kind in ('branch','online')),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 constraint erp_location_kind check(
   (kind='branch' and branch_id is not null) or
   (kind='online' and branch_id is null))
);
create unique index if not exists erp_one_online_location on public.erp_locations(kind) where kind='online';
insert into public.erp_locations(branch_id,code,name,kind)
select b.id,'BR-'||b.code,b.name,'branch' from public.branches b
on conflict(branch_id) do nothing;
insert into public.erp_locations(code,name,kind)
values('ONLINE','Online Store','online') on conflict(code) do nothing;

create table if not exists public.erp_staff_locations(
 user_id uuid not null references public.staff_profiles(user_id),
 location_id uuid not null references public.erp_locations(id),
 created_at timestamptz not null default now(),
 primary key(user_id,location_id)
);
create index if not exists erp_staff_loc_location_idx on public.erp_staff_locations(location_id);
create or replace function app_private.erp_can_use_location(p_location uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
 select (select app_private.erp_is_admin()) or exists(
 select 1 from public.erp_staff_locations sl
 join public.staff_profiles s on s.user_id=sl.user_id
 join public.erp_locations l on l.id=sl.location_id
 where sl.user_id=(select auth.uid()) and sl.location_id=p_location
 and s.active and s.archived_at is null and l.active and l.kind='branch'
 );
$$;
revoke all on function app_private.erp_can_use_location(uuid) from public,anon,authenticated;
grant execute on function app_private.erp_can_use_location(uuid) to authenticated;

create table if not exists public.erp_stock_balances(
 location_id uuid not null references public.erp_locations(id),
 variant_id uuid not null references public.product_variants(id),
 on_hand integer not null default 0 check(on_hand between 0 and 1000000000),
 reserved integer not null default 0 check(reserved >= 0 and reserved <= on_hand),
 updated_at timestamptz not null default now(),
 primary key(location_id,variant_id)
);
create index if not exists erp_stock_variant_idx on public.erp_stock_balances(variant_id);

create table if not exists public.erp_stock_events(
 id bigint generated always as identity primary key,
 location_id uuid not null references public.erp_locations(id),
 variant_id uuid not null references public.product_variants(id),
 action text not null check(action in ('adjust','transfer_out','transfer_in','purchase_in','online_sale','local_sale')),
 quantity_delta integer not null check(quantity_delta <> 0),
 stock_before integer not null check(stock_before >= 0),
 stock_after integer not null check(stock_after >= 0),
 idempotency_key uuid not null,
 reason text not null,
 actor_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 constraint erp_event_balance_valid check(stock_after-stock_before=quantity_delta),
 unique(location_id,variant_id,idempotency_key)
);
create index if not exists erp_stock_events_lookup on public.erp_stock_events(location_id,variant_id,created_at desc);

create table if not exists public.erp_transfers(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 from_location uuid not null references public.erp_locations(id),
 to_location uuid not null references public.erp_locations(id),
 variant_id uuid not null references public.product_variants(id),
 quantity integer not null check(quantity between 1 and 100000),
 status text not null default 'in_transit' check(status in ('in_transit','received')),
 reason text not null,
 dispatched_by uuid references auth.users(id),
 received_by uuid references auth.users(id),
 dispatched_at timestamptz not null default now(),
 received_at timestamptz,
 constraint erp_transfer_distinct check(from_location<>to_location)
);
create index if not exists erp_transfers_pending_idx on public.erp_transfers(to_location,dispatched_at) where status='in_transit';

create table if not exists public.erp_online_listings(
 product_id uuid primary key references public.products(id) on delete cascade,
 published boolean not null default false,
 online_price numeric(12,2) check(online_price>=0),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);

create table if not exists public.erp_online_reservations(
 checkout_id uuid primary key,
 location_id uuid not null references public.erp_locations(id),
 variant_id uuid not null references public.product_variants(id),
 quantity integer not null check(quantity between 1 and 100000),
 state text not null check(state in ('reserved','paid','released')),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists erp_reservations_expiry on public.erp_online_reservations(expires_at) where state='reserved';

create table if not exists public.erp_suppliers(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 2 and 160),
 phone text,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.erp_purchase_orders(
 id uuid primary key default gen_random_uuid(),
 supplier_id uuid not null references public.erp_suppliers(id),
 destination_id uuid not null references public.erp_locations(id),
 status text not null default 'draft' check(status in ('draft','ordered','partial','received','cancelled')),
 reference text unique,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.erp_purchase_lines(
 id uuid primary key default gen_random_uuid(),
 purchase_id uuid not null references public.erp_purchase_orders(id),
 variant_id uuid not null references public.product_variants(id),
 ordered_qty integer not null check(ordered_qty>0),
 received_qty integer not null default 0 check(received_qty>=0 and received_qty<=ordered_qty),
 unit_cost numeric(12,2) not null check(unit_cost>=0),
 unique(purchase_id,variant_id)
);
create table if not exists public.erp_reorder_settings(
 location_id uuid not null references public.erp_locations(id),
 variant_id uuid not null references public.product_variants(id),
 minimum_qty integer not null default 3 check(minimum_qty>=0),
 primary key(location_id,variant_id)
);
create table if not exists public.erp_purchase_receipts(
 id uuid primary key default gen_random_uuid(),
 purchase_line_id uuid not null references public.erp_purchase_lines(id),
 request_id uuid not null unique,
 quantity integer not null check(quantity>0),
 received_by uuid references auth.users(id),
 received_at timestamptz not null default now()
);

-- Public schema has no anonymous access to private ERP records.
alter table public.erp_locations enable row level security;
alter table public.erp_staff_locations enable row level security;
alter table public.erp_stock_balances enable row level security;
alter table public.erp_stock_events enable row level security;
alter table public.erp_transfers enable row level security;
alter table public.erp_online_listings enable row level security;
alter table public.erp_online_reservations enable row level security;
alter table public.erp_suppliers enable row level security;
alter table public.erp_purchase_orders enable row level security;
alter table public.erp_purchase_lines enable row level security;
alter table public.erp_reorder_settings enable row level security;
alter table public.erp_purchase_receipts enable row level security;
revoke all on public.erp_locations, public.erp_staff_locations,public.erp_stock_balances,
 public.erp_stock_events,public.erp_transfers,public.erp_online_listings,
 public.erp_online_reservations,public.erp_suppliers,public.erp_purchase_orders,
 public.erp_purchase_lines,public.erp_reorder_settings,public.erp_purchase_receipts
 from public,anon,authenticated;
grant select on public.erp_locations,public.erp_staff_locations,public.erp_stock_balances,
 public.erp_stock_events,public.erp_transfers,public.erp_online_listings,
 public.erp_suppliers,public.erp_purchase_orders,public.erp_purchase_lines,
 public.erp_reorder_settings,public.erp_purchase_receipts to authenticated;
grant select on public.erp_online_listings to anon;

create policy "erp locations access" on public.erp_locations for select to authenticated
 using((select app_private.erp_can_use_location(id)));
create policy "erp staff mapping read" on public.erp_staff_locations for select to authenticated
 using(user_id=(select auth.uid()) or (select app_private.erp_is_admin()));
create policy "erp stock read" on public.erp_stock_balances for select to authenticated
 using((select app_private.erp_can_use_location(location_id)));
create policy "erp stock events read" on public.erp_stock_events for select to authenticated
 using((select app_private.erp_can_use_location(location_id)));
create policy "erp transfers read" on public.erp_transfers for select to authenticated
 using((select app_private.erp_can_use_location(from_location)) or (select app_private.erp_can_use_location(to_location)));
create policy "erp public online listing" on public.erp_online_listings for select to anon
 using(published);
create policy "erp staff online listing" on public.erp_online_listings for select to authenticated
 using(published or (select app_private.erp_is_admin()));
create policy "erp supplier admin read" on public.erp_suppliers for select to authenticated
 using((select app_private.erp_is_admin()));
create policy "erp purchase admin read" on public.erp_purchase_orders for select to authenticated
 using((select app_private.erp_is_admin()));
create policy "erp purchase line admin read" on public.erp_purchase_lines for select to authenticated
 using((select app_private.erp_is_admin()));
create policy "erp reorder read" on public.erp_reorder_settings for select to authenticated
 using((select app_private.erp_can_use_location(location_id)));
create policy "erp receipt admin read" on public.erp_purchase_receipts for select to authenticated
 using((select app_private.erp_is_admin()));

-- Explicitly limited administrative writes; balances and ledgers are RPC-only.
grant insert,delete on public.erp_staff_locations to authenticated;
create policy "erp admin assign staff" on public.erp_staff_locations for insert to authenticated
 with check((select app_private.erp_is_admin()) and exists(
 select 1 from public.staff_profiles p join public.erp_locations l on l.id=location_id
 where p.user_id=user_id and p.active and p.archived_at is null
 and l.kind='branch' and l.active));
create policy "erp admin revoke staff" on public.erp_staff_locations for delete to authenticated
 using((select app_private.erp_is_admin()));
grant insert,update on public.erp_online_listings to authenticated;
create policy "erp admin online publish" on public.erp_online_listings for insert to authenticated
 with check((select app_private.erp_is_admin()));
create policy "erp admin online update" on public.erp_online_listings for update to authenticated
 using((select app_private.erp_is_admin())) with check((select app_private.erp_is_admin()));
grant insert,update on public.erp_reorder_settings to authenticated;
create policy "erp admin reorder create" on public.erp_reorder_settings for insert to authenticated
 with check((select app_private.erp_is_admin()));
create policy "erp admin reorder update" on public.erp_reorder_settings for update to authenticated
 using((select app_private.erp_is_admin())) with check((select app_private.erp_is_admin()));
grant insert,update on public.erp_suppliers to authenticated;
grant insert on public.erp_purchase_orders,public.erp_purchase_lines to authenticated;
grant update(reference) on public.erp_purchase_orders to authenticated;
create policy "erp admin supplier insert" on public.erp_suppliers for insert to authenticated
 with check((select app_private.erp_is_admin()));
create policy "erp admin supplier update" on public.erp_suppliers for update to authenticated
 using((select app_private.erp_is_admin())) with check((select app_private.erp_is_admin()));
create policy "erp admin purchase insert" on public.erp_purchase_orders for insert to authenticated
 with check((select app_private.erp_is_admin()));
create policy "erp admin purchase update" on public.erp_purchase_orders for update to authenticated
 using((select app_private.erp_is_admin())) with check((select app_private.erp_is_admin()));
create policy "erp admin purchase line insert" on public.erp_purchase_lines for insert to authenticated
 with check((select app_private.erp_is_admin()));
-- Purchase quantities and receipts cannot be edited directly from a browser.
-- Receiving occurs through erp_receive_purchase() after an order is marked ordered by a server-side workflow.

-- Atomic, idempotent adjustment: the browser never updates balances directly.
create or replace function public.erp_adjust_stock(
 p_location uuid,p_variant uuid,p_delta integer,p_reason text,p_request uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_before integer; v_after bigint; v_existing record; v_event bigint;
begin
 if (select auth.uid()) is null or not app_private.erp_can_use_location(p_location)
 then raise exception 'Not assigned to this shop' using errcode='42501'; end if;
 if p_location is null or p_variant is null or p_request is null or
 p_delta is null or p_delta=0 or abs(p_delta::bigint)>100000 or
 length(btrim(coalesce(p_reason,''))) not between 8 and 240
 then raise exception 'Invalid adjustment input' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,351));
 select location_id,variant_id,quantity_delta,stock_after into v_existing
 from public.erp_stock_events where idempotency_key=p_request;
 if found then
   if v_existing.location_id<>p_location or v_existing.variant_id<>p_variant or
   v_existing.quantity_delta<>p_delta then raise exception 'Request ID reused with different payload'; end if;
   return jsonb_build_object('stock',v_existing.stock_after,'already_applied',true);
 end if;
 if not exists(select 1 from public.erp_locations where id=p_location and active)
 or not exists(select 1 from public.product_variants v
 join public.products p on p.id=v.product_id where v.id=p_variant and v.active and p.active)
 then raise exception 'Inactive location or variant'; end if;
 insert into public.erp_stock_balances(location_id,variant_id)
 values(p_location,p_variant) on conflict do nothing;
 select on_hand into v_before from public.erp_stock_balances
 where location_id=p_location and variant_id=p_variant for update;
 v_after:=v_before::bigint+p_delta::bigint;
 if v_after<0 or v_after>1000000000 or v_after<
 (select reserved from public.erp_stock_balances where location_id=p_location and variant_id=p_variant)
 then raise exception 'Insufficient unreserved stock'; end if;
 update public.erp_stock_balances set on_hand=v_after::integer,updated_at=now()
 where location_id=p_location and variant_id=p_variant;
 insert into public.erp_stock_events(location_id,variant_id,action,quantity_delta,stock_before,stock_after,idempotency_key,reason,actor_id)
 values(p_location,p_variant,'adjust',p_delta,v_before,v_after::integer,p_request,btrim(p_reason),auth.uid())
 returning id into v_event;
 return jsonb_build_object('event_id',v_event,'stock',v_after::integer,'already_applied',false);
end; $$;
revoke all on function public.erp_adjust_stock(uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.erp_adjust_stock(uuid,uuid,integer,text,uuid) to authenticated;

create or replace function public.erp_dispatch_transfer(
 p_from uuid,p_to uuid,p_variant uuid,p_quantity integer,p_reason text,p_request uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_existing public.erp_transfers%rowtype; v_before integer; v_after integer; v_id uuid;
begin
 if (select auth.uid()) is null or not app_private.erp_can_use_location(p_from)
 or not app_private.erp_can_use_location(p_to)
 then raise exception 'Not authorized for both locations' using errcode='42501'; end if;
 if p_from=p_to or p_from is null or p_to is null or p_variant is null or p_request is null or
 p_quantity is null or p_quantity not between 1 and 100000 or length(btrim(coalesce(p_reason,''))) not between 8 and 240
 then raise exception 'Invalid transfer' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,352));
 select * into v_existing from public.erp_transfers where request_id=p_request;
 if found then
  if v_existing.from_location<>p_from or v_existing.to_location<>p_to or
  v_existing.variant_id<>p_variant or v_existing.quantity<>p_quantity
  then raise exception 'Request ID reused'; end if;
  return jsonb_build_object('transfer_id',v_existing.id,'state',v_existing.status,'already_applied',true);
 end if;
 if not exists(select 1 from public.erp_locations where id=p_to and active) then
 raise exception 'Destination inactive'; end if;
 select on_hand into v_before from public.erp_stock_balances
 where location_id=p_from and variant_id=p_variant for update;
 if v_before is null then raise exception 'No stock at source'; end if;
 if v_before-p_quantity<(select reserved from public.erp_stock_balances
 where location_id=p_from and variant_id=p_variant)
 then raise exception 'Insufficient available stock'; end if;
 v_after:=v_before-p_quantity;
 update public.erp_stock_balances set on_hand=v_after,updated_at=now()
 where location_id=p_from and variant_id=p_variant;
 insert into public.erp_transfers(request_id,from_location,to_location,variant_id,quantity,reason,dispatched_by)
 values(p_request,p_from,p_to,p_variant,p_quantity,btrim(p_reason),auth.uid())
 returning id into v_id;
 insert into public.erp_stock_events(location_id,variant_id,action,quantity_delta,stock_before,stock_after,idempotency_key,reason,actor_id)
 values(p_from,p_variant,'transfer_out',-p_quantity,v_before,v_after,p_request,btrim(p_reason),auth.uid());
 return jsonb_build_object('transfer_id',v_id,'state','in_transit','already_applied',false);
end; $$;
revoke all on function public.erp_dispatch_transfer(uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.erp_dispatch_transfer(uuid,uuid,uuid,integer,text,uuid) to authenticated;

create or replace function public.erp_receive_transfer(p_transfer uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v public.erp_transfers%rowtype; v_before integer; v_after bigint;
begin
 if (select auth.uid()) is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into v from public.erp_transfers where id=p_transfer for update;
 if not found then raise exception 'Transfer not found'; end if;
 if not app_private.erp_can_use_location(v.to_location)
 then raise exception 'Not authorized to receive' using errcode='42501'; end if;
 if v.status='received' then
 return jsonb_build_object('state','received','already_applied',true); end if;
 insert into public.erp_stock_balances(location_id,variant_id)
 values(v.to_location,v.variant_id) on conflict do nothing;
 select on_hand into v_before from public.erp_stock_balances
 where location_id=v.to_location and variant_id=v.variant_id for update;
 v_after:=v_before::bigint+v.quantity::bigint;
 if v_after>1000000000 then raise exception 'Stock overflow'; end if;
 update public.erp_stock_balances set on_hand=v_after::integer,updated_at=now()
 where location_id=v.to_location and variant_id=v.variant_id;
 insert into public.erp_stock_events(location_id,variant_id,action,quantity_delta,stock_before,stock_after,idempotency_key,reason,actor_id)
 values(v.to_location,v.variant_id,'transfer_in',v.quantity,v_before,v_after::integer,v.request_id,v.reason,auth.uid());
 update public.erp_transfers set status='received',received_at=now(),received_by=auth.uid()
 where id=v.id;
 return jsonb_build_object('state','received','new_stock',v_after::integer,'already_applied',false);
end; $$;
revoke all on function public.erp_receive_transfer(uuid) from public,anon,authenticated;
grant execute on function public.erp_receive_transfer(uuid) to authenticated;

-- Online reservations are deliberately service_role-only; the Razorpay path
-- is NOT redirected here until checkout/legacy inventory cutover is tested.
create or replace function public.erp_reserve_online(
 p_checkout uuid,p_variant uuid,p_qty integer,p_expires timestamptz
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_loc uuid; v_old public.erp_online_reservations%rowtype; v_stock record;
begin
 if p_checkout is null or p_variant is null or p_qty is null or p_qty not between 1 and 100000 or p_expires is null or
 p_expires<=now() or p_expires>now()+interval '2 hours'
 then raise exception 'Invalid reservation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_checkout::text,353));
 select * into v_old from public.erp_online_reservations where checkout_id=p_checkout;
 if found then
 if v_old.variant_id<>p_variant or v_old.quantity<>p_qty or v_old.state<>'reserved' or v_old.expires_at<=now()
 then raise exception 'Checkout ID already used'; end if;
 return jsonb_build_object('state','reserved','already_applied',true);
 end if;
 select id into v_loc from public.erp_locations where kind='online' and active;
 if v_loc is null then raise exception 'Online location unavailable'; end if;
 if not exists(select 1 from public.product_variants v
 join public.erp_online_listings l on l.product_id=v.product_id
 join public.products p on p.id=v.product_id
 where v.id=p_variant and v.active and p.active and l.published)
 then raise exception 'Product not published online'; end if;
 select on_hand,reserved into v_stock from public.erp_stock_balances
 where location_id=v_loc and variant_id=p_variant for update;
 if not found or v_stock.on_hand-v_stock.reserved<p_qty then
 raise exception 'Insufficient online stock'; end if;
 update public.erp_stock_balances set reserved=reserved+p_qty,updated_at=now()
 where location_id=v_loc and variant_id=p_variant;
 insert into public.erp_online_reservations(checkout_id,location_id,variant_id,quantity,state,expires_at)
 values(p_checkout,v_loc,p_variant,p_qty,'reserved',p_expires);
 return jsonb_build_object('state','reserved','already_applied',false);
end; $$;
revoke all on function public.erp_reserve_online(uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.erp_reserve_online(uuid,uuid,integer,timestamptz) to service_role;

create or replace function public.erp_settle_online(p_checkout uuid,p_paid boolean)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v public.erp_online_reservations%rowtype; v_before integer;
begin
 if p_paid is null then raise exception 'Settlement result must be explicit'; end if;
 select * into v from public.erp_online_reservations where checkout_id=p_checkout for update;
 if not found then raise exception 'Checkout unknown'; end if;
 if v.state<>'reserved' then
 if (p_paid and v.state='paid') or (not p_paid and v.state='released') then
 return jsonb_build_object('state',v.state,'already_applied',true); end if;
 raise exception 'Conflicting settlement state';
 end if;
 select on_hand into v_before from public.erp_stock_balances
 where location_id=v.location_id and variant_id=v.variant_id for update;
 if p_paid then
 update public.erp_stock_balances set reserved=reserved-v.quantity,on_hand=on_hand-v.quantity,updated_at=now()
 where location_id=v.location_id and variant_id=v.variant_id;
 insert into public.erp_stock_events(location_id,variant_id,action,quantity_delta,stock_before,stock_after,idempotency_key,reason)
 values(v.location_id,v.variant_id,'online_sale',-v.quantity,v_before,v_before-v.quantity,v.checkout_id,'Payment independently verified');
 end if;
 if not p_paid then
 update public.erp_stock_balances set reserved=reserved-v.quantity,updated_at=now()
 where location_id=v.location_id and variant_id=v.variant_id;
 end if;
 update public.erp_online_reservations set state=case when p_paid then 'paid' else 'released' end,updated_at=now()
 where checkout_id=p_checkout;
 return jsonb_build_object('state',case when p_paid then 'paid' else 'released' end,'already_applied',false);
end; $$;
revoke all on function public.erp_settle_online(uuid,boolean) from public,anon,authenticated;
grant execute on function public.erp_settle_online(uuid,boolean) to service_role;

create or replace function public.erp_expire_online(p_limit integer default 100)
returns integer language plpgsql security definer
set search_path=pg_catalog,public as $$
declare r record; n integer:=0;
begin
 if p_limit not between 1 and 500 then raise exception 'Invalid batch size'; end if;
 for r in select checkout_id from public.erp_online_reservations
 where state='reserved' and expires_at<now() order by expires_at
 for update skip locked limit p_limit loop
 perform public.erp_settle_online(r.checkout_id,false);
 n:=n+1;
 end loop;
 return n;
end; $$;
revoke all on function public.erp_expire_online(integer) from public,anon,authenticated;
grant execute on function public.erp_expire_online(integer) to service_role;

create or replace function public.erp_receive_purchase(p_line uuid,p_qty integer,p_request uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare v_line public.erp_purchase_lines%rowtype; v_order public.erp_purchase_orders%rowtype;
 v_receipt public.erp_purchase_receipts%rowtype; v_before integer; v_after bigint;
begin
 if (select auth.uid()) is null or not app_private.erp_is_admin()
 then raise exception 'Admin only' using errcode='42501'; end if;
 if p_line is null or p_request is null or p_qty is null or p_qty not between 1 and 100000
 then raise exception 'Invalid receipt'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,354));
 select * into v_receipt from public.erp_purchase_receipts where request_id=p_request;
 if found then
 if v_receipt.purchase_line_id<>p_line or v_receipt.quantity<>p_qty then raise exception 'Request ID reused'; end if;
 return jsonb_build_object('already_applied',true);
 end if;
 select * into v_line from public.erp_purchase_lines where id=p_line for update;
 if not found then raise exception 'Purchase line not found'; end if;
 select * into v_order from public.erp_purchase_orders where id=v_line.purchase_id for update;
 if v_order.status not in ('ordered','partial') or v_line.received_qty+p_qty>v_line.ordered_qty then
 raise exception 'Receipt exceeds remaining quantity or purchase order inactive'; end if;
 insert into public.erp_stock_balances(location_id,variant_id)
 values(v_order.destination_id,v_line.variant_id) on conflict do nothing;
 select on_hand into v_before from public.erp_stock_balances
 where location_id=v_order.destination_id and variant_id=v_line.variant_id for update;
 v_after:=v_before::bigint+p_qty::bigint;
 if v_after>1000000000 then raise exception 'Stock overflow'; end if;
 update public.erp_stock_balances set on_hand=v_after::integer,updated_at=now()
 where location_id=v_order.destination_id and variant_id=v_line.variant_id;
 update public.erp_purchase_lines set received_qty=received_qty+p_qty where id=p_line;
 insert into public.erp_purchase_receipts(purchase_line_id,request_id,quantity,received_by)
 values(p_line,p_request,p_qty,auth.uid());
 insert into public.erp_stock_events(location_id,variant_id,action,quantity_delta,stock_before,stock_after,idempotency_key,reason,actor_id)
 values(v_order.destination_id,v_line.variant_id,'purchase_in',p_qty,v_before,v_after::integer,p_request,'Supplier goods received',auth.uid());
 update public.erp_purchase_orders set status=case when
 (select bool_and(received_qty=ordered_qty) from public.erp_purchase_lines where purchase_id=v_order.id)
 then 'received' else 'partial' end where id=v_order.id;
 return jsonb_build_object('new_stock',v_after,'already_applied',false);
end; $$;
revoke all on function public.erp_receive_purchase(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.erp_receive_purchase(uuid,integer,uuid) to authenticated;

create or replace view public.erp_admin_stock_totals with (security_invoker=true) as
select b.variant_id,sum(b.on_hand)::bigint as total_on_hand,
sum(b.reserved)::bigint as total_reserved,
sum(b.on_hand-b.reserved)::bigint as available_now
from public.erp_stock_balances b group by b.variant_id;
revoke all on public.erp_admin_stock_totals from public,anon,authenticated;
grant select on public.erp_admin_stock_totals to authenticated;


-- Submit a complete purchase order. Draft orders cannot receive stock.
create or replace function public.erp_submit_purchase(p_purchase uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $
declare v public.erp_purchase_orders%rowtype;
begin
 if (select auth.uid()) is null or not app_private.erp_is_admin()
 then raise exception 'Admin only' using errcode='42501'; end if;
 select * into v from public.erp_purchase_orders where id=p_purchase for update;
 if not found then raise exception 'Purchase order not found'; end if;
 if v.status='ordered' then return jsonb_build_object('status','ordered','already_applied',true); end if;
 if v.status<>'draft' or not exists(
 select 1 from public.erp_purchase_lines where purchase_id=p_purchase)
 then raise exception 'Purchase order is not a complete draft'; end if;
 if not exists(select 1 from public.erp_locations where id=v.destination_id and kind='branch' and active)
 then raise exception 'Destination shop not active'; end if;
 update public.erp_purchase_orders set status='ordered' where id=p_purchase;
 return jsonb_build_object('status','ordered','already_applied',false);
end; $;
revoke all on function public.erp_submit_purchase(uuid) from public,anon,authenticated;
grant execute on function public.erp_submit_purchase(uuid) to authenticated;

-- Database-side aggregate so a 10k+ product dashboard does not fetch all rows.
create or replace function public.erp_dashboard_snapshot()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,app_private as $
begin
 if (select auth.uid()) is null or not app_private.erp_is_admin()
 then raise exception 'Admin only' using errcode='42501'; end if;
 return jsonb_build_object(
 'master_products',(select count(*) from public.products),
 'locations',(select count(*) from public.erp_locations where active),
 'on_hand',(select coalesce(sum(on_hand),0) from public.erp_stock_balances),
 'reserved',(select coalesce(sum(reserved),0) from public.erp_stock_balances),
 'in_transit',(select coalesce(sum(quantity),0) from public.erp_transfers where status='in_transit'),
 'pending_transfers',(select count(*) from public.erp_transfers where status='in_transit'),
 'low_stock',(select count(*) from public.erp_stock_balances b
 left join public.erp_reorder_settings s using(location_id,variant_id)
 where b.on_hand-b.reserved<=coalesce(s.minimum_qty,3))
 );
end; $;
revoke all on function public.erp_dashboard_snapshot() from public,anon,authenticated;
grant execute on function public.erp_dashboard_snapshot() to authenticated;

-- No broad grants on privileged functions or ledger writes.
commit;
