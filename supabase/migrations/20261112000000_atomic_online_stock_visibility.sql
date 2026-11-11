-- Atomically publish/allocate existing shop stock and atomically recall/hide it.
-- Prevents a successful dispatch followed by a failed receipt from stranding units.
-- No inventory or listing records are changed by installing this migration.
begin;

create or replace function public.erp_allocate_online(
  p_product uuid, p_from uuid, p_variant uuid, p_quantity integer,
  p_publish boolean, p_request uuid
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public','app_private'
as $fn$
declare v_online uuid; v_transfer jsonb; v_receipt jsonb;
begin
  if auth.uid() is null or not app_private.erp_is_admin() then
    raise exception 'Only an active owner can allocate online inventory' using errcode='42501';
  end if;
  if p_product is null or p_from is null or p_variant is null
     or p_request is null or p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'Invalid online allocation' using errcode='22023';
  end if;
  select id into v_online from public.erp_locations where kind='online' and active;
  if v_online is null then raise exception 'Online Store is not configured'; end if;
  if not exists (
    select 1 from public.erp_locations
    where id=p_from and kind='branch' and active
  ) or not app_private.erp_can_use_location(p_from) then
    raise exception 'Choose an authorized physical shop' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.product_variants v
    join public.products p on p.id=v.product_id
    where v.id=p_variant and v.product_id=p_product
      and v.active and p.active and p.archived_at is null
  ) then raise exception 'Product or variant is not active'; end if;

  -- Publish first: the live ERP balance trigger rejects positive online
  -- stock for an unpublished product. All statements are one RPC transaction.
  if coalesce(p_publish,false) then
    insert into public.erp_online_listings
      (product_id,published,updated_by,updated_at)
    values (p_product,true,auth.uid(),now())
    on conflict (product_id) do update
      set published=true,updated_by=excluded.updated_by,updated_at=now();
  elsif not exists (
    select 1 from public.erp_online_listings
    where product_id=p_product and published
  ) then
    raise exception 'Publish the product before allocating online stock';
  end if;
  v_transfer:=public.erp_dispatch_transfer(
    p_from,v_online,p_variant,p_quantity,
    'Owner allocated existing branch stock to Online Store',p_request
  );
  v_receipt:=public.erp_receive_transfer((v_transfer->>'transfer_id')::uuid);
  return jsonb_build_object(
    'state','received',
    'transfer_id',v_transfer->>'transfer_id',
    'already_applied',coalesce((v_receipt->>'already_applied')::boolean,false)
  );
end;
$fn$;

create or replace function public.erp_recall_and_hide_online(
  p_product uuid, p_destination uuid, p_request uuid
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public','app_private'
as $fn$
declare v_online uuid; v_variant record; v_transfer jsonb;
        v_count integer:=0; v_request uuid;
begin
  if auth.uid() is null or not app_private.erp_is_admin() then
    raise exception 'Only an active owner can hide online inventory' using errcode='42501';
  end if;
  if p_product is null or p_destination is null or p_request is null then
    raise exception 'Invalid online stock recall' using errcode='22023';
  end if;
  select id into v_online from public.erp_locations where kind='online' and active;
  if v_online is null then raise exception 'Online Store is not configured'; end if;
  if not exists (
    select 1 from public.erp_locations
    where id=p_destination and kind='branch' and active
  ) or not app_private.erp_can_use_location(p_destination) then
    raise exception 'Choose an authorized receiving branch' using errcode='42501';
  end if;
  if not exists (select 1 from public.products where id=p_product) then
    raise exception 'Product does not exist';
  end if;
  if exists (
    select 1 from public.erp_transfers t
    join public.product_variants v on v.id=t.variant_id
    where v.product_id=p_product and t.to_location=v_online and t.status='in_transit'
  ) then
    raise exception 'Receive or reconcile pending online transfers before hiding the product';
  end if;
  for v_variant in
    select v.id,coalesce(b.on_hand,0) on_hand,coalesce(b.reserved,0) reserved
    from public.product_variants v
    left join public.erp_stock_balances b
      on b.variant_id=v.id and b.location_id=v_online
    where v.product_id=p_product order by v.id
  loop
    if v_variant.reserved>0 then
      raise exception 'A checkout has reserved online stock; resolve it first';
    end if;
    if v_variant.on_hand>0 then
      if v_variant.on_hand>100000 then
        raise exception 'Online stock exceeds maximum transfer quantity';
      end if;
      v_request:=md5(p_request::text||':'||v_variant.id::text)::uuid;
      v_transfer:=public.erp_dispatch_transfer(
        v_online,p_destination,v_variant.id,v_variant.on_hand,
        'Owner recalled online stock before hiding listing',v_request
      );
      perform public.erp_receive_transfer((v_transfer->>'transfer_id')::uuid);
      v_count:=v_count+v_variant.on_hand;
    end if;
  end loop;
  update public.erp_online_listings
     set published=false,updated_by=auth.uid(),updated_at=now()
   where product_id=p_product;
  return jsonb_build_object('state','hidden','returned',v_count);
end;
$fn$;

revoke all on function public.erp_allocate_online(uuid,uuid,uuid,integer,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.erp_allocate_online(uuid,uuid,uuid,integer,boolean,uuid)
  to authenticated;
revoke all on function public.erp_recall_and_hide_online(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.erp_recall_and_hide_online(uuid,uuid,uuid)
  to authenticated;
commit;
