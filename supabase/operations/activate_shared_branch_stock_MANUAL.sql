-- MANUAL RELEASE GATE ONLY. Do NOT run during deployment or without signed-off tests.
-- This script intentionally is not located in the automatic migrations directory.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
lock table public.product_variants,public.erp_stock_balances,public.erp_online_listings,
 public.razorpay_checkouts,public.orders,public.erp_transfers in access exclusive mode;

do $$
declare v_online integer; v_reserved integer; v_checkouts integer; v_pending integer;
begin
 if not app_private.erp_live() then raise exception 'ERP inventory must be active'; end if;
 if app_private.erp_shared_branch_stock() then raise exception 'Shared stock is already activated'; end if;
 select coalesce(sum(b.on_hand),0),coalesce(sum(b.reserved),0)
 into v_online,v_reserved
 from public.erp_stock_balances b
 join public.erp_locations l on l.id=b.location_id and l.kind='online';
 if v_online<>0 or v_reserved<>0
 then raise exception 'Cannot activate shared stock: separate Online Store still holds stock or reservations'; end if;
 select count(*) into v_checkouts from public.razorpay_checkouts where status in ('creating','ready');
 if v_checkouts>0 then raise exception 'Pending Razorpay reservations must be resolved first'; end if;
 select count(*) into v_pending from public.orders
 where source='online' and status not in ('cancelled','refunded','delivered')
 and payment_status not in ('paid','failed','refunded');
 if v_pending>0 then raise exception 'Pending online checkout orders must be reconciled first'; end if;
 if exists(select 1 from public.erp_transfers t
  join public.erp_locations l on l.id=t.to_location and l.kind='online'
  where t.status='in_transit')
 then raise exception 'An Online Store transfer has not been received or cancelled'; end if;
 if exists(select 1 from public.erp_stock_balances b
  join public.erp_locations l on l.id=b.location_id
  where l.kind='branch' and b.reserved>0)
 then raise exception 'Existing branch reservations must be reconciled'; end if;
end $$;

-- Keep every physical-stock mutation in the SAME lock order as online
-- checkout: variant rows first, physical balance rows second. This intentionally
-- fails rather than silently patching a newer/unrecognized RPC version.
do $
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
    '  for v_item in select value from jsonb_array_elements(p_items) order by value->>''variant_id'' loop',
    '  perform 1 from public.product_variants where id in ('||
     'select (value->>''variant_id'')::uuid from jsonb_array_elements(p_items)'||
     ') order by id for update;')
  ) as patches(name,signature,anchor,lock_stmt)
 loop
  select pg_get_functiondef(to_regprocedure(v_sig)) into v_source;
  if v_source is null or strpos(v_source,v_anchor)=0
  then raise exception 'Refusing shared stock: unrecognized % RPC version',v_name; end if;
  v_source:=replace(v_source,v_anchor,v_lock||E'\n'||v_anchor);
  execute v_source;
 end loop;
end $;

update app_private.erp_activation_state
 set shared_branch_stock=true where singleton and enabled;

select set_config('erp.stock_origin','erp',true);
update public.product_variants v
 set stock_quantity=greatest(0,coalesce((
  select sum(b.on_hand-b.reserved)::integer
  from public.erp_stock_balances b
  join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
  where b.variant_id=v.id
 ),0)),updated_at=now()
 where stock_quantity is distinct from greatest(0,coalesce((
  select sum(b.on_hand-b.reserved)::integer
  from public.erp_stock_balances b
  join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
  where b.variant_id=v.id
 ),0));
select set_config('erp.stock_origin','',true);

do $$
begin
 if exists(select 1 from public.product_variants v
  where v.stock_quantity is distinct from (
   select coalesce(sum(b.on_hand-b.reserved),0)::integer
   from public.erp_stock_balances b
   join public.erp_locations l on l.id=b.location_id and l.kind='branch' and l.active
   where b.variant_id=v.id
  )
 ) then raise exception 'Shared mirror consistency check failed'; end if;
 if not app_private.erp_shared_branch_stock() then raise exception 'Shared inventory failed to activate'; end if;
end $$;
commit;
