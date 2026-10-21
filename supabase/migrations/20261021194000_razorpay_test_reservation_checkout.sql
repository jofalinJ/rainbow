-- Staged Razorpay TEST-mode checkout. Do not apply to the live database without
-- isolated integration tests, reconciliation review, and a backup.
-- Keeps the existing manual UPI function untouched.
create table if not exists public.razorpay_checkouts (
  checkout_id uuid primary key,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  gateway_order_id text unique,
  gateway_payment_id text unique,
  last_event_id text,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'creating'
    check (status in ('creating','ready','paid','expired','refund_required')),
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_razorpay_checkouts_expiry
  on public.razorpay_checkouts (expires_at)
  where status in ('creating','ready');
alter table public.razorpay_checkouts enable row level security;
revoke all on public.razorpay_checkouts from public, anon, authenticated;
grant all on public.razorpay_checkouts to service_role;

create or replace function public.create_razorpay_checkout(
  p_checkout_id uuid, p_items jsonb, p_customer jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
  v_qty integer;
  v_variant uuid;
  v_product record;
  v_existing record;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric := 0;
  v_discount numeric;
  v_taxable numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_delivery numeric;
  v_total numeric;
  v_name text := nullif(btrim(p_customer->>'name'),'');
  v_phone text := nullif(btrim(p_customer->>'whatsapp_number'),'');
  v_email text := nullif(btrim(p_customer->>'email'),'');
  v_address text := nullif(btrim(p_customer->>'address'),'');
  v_city text := nullif(btrim(p_customer->>'city'),'');
  v_state text := nullif(btrim(p_customer->>'state'),'');
  v_pin text := nullif(btrim(p_customer->>'pin_code'),'');
  v_valid_states text[] := array[
    'andaman and nicobar islands','andhra pradesh','arunachal pradesh','assam','bihar',
    'chandigarh','chhattisgarh','dadra and nagar haveli and daman and diu','delhi',
    'goa','gujarat','haryana','himachal pradesh','jammu and kashmir','jharkhand',
    'karnataka','kerala','ladakh','lakshadweep','madhya pradesh','maharashtra',
    'manipur','meghalaya','mizoram','nagaland','odisha','puducherry','punjab',
    'rajasthan','sikkim','tamil nadu','telangana','tripura','uttar pradesh',
    'uttarakhand','west bengal'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the payment backend may initiate checkout.';
  end if;
  if p_checkout_id is null then raise exception 'Missing checkout identifier.'; end if;
  -- Serialize retries, including concurrent requests before the first row exists.
  perform pg_advisory_xact_lock(hashtextextended(p_checkout_id::text, 0));
  select rc.status,rc.amount_paise,rc.expires_at,rc.gateway_order_id,o.order_number
    into v_existing
    from public.razorpay_checkouts rc
    join public.orders o on o.id=rc.order_id
    where rc.checkout_id=p_checkout_id for update of rc;
  if found then
    return jsonb_build_object('state',v_existing.status,
      'amount_paise',v_existing.amount_paise,'expires_at',v_existing.expires_at,
      'gateway_order_id',v_existing.gateway_order_id,'order_number',v_existing.order_number);
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Invalid order items.';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'variant_id') from jsonb_array_elements(p_items)) then
    raise exception 'Duplicate variants are not allowed.';
  end if;
  if v_name is null or length(v_name)>120 or v_phone is null or
    v_phone !~ '^[+0-9 -]{10,20}$' or v_address is null or
    length(v_address)>600 or length(coalesce(v_email,''))>254 or
    length(coalesce(v_city,''))>120 then
    raise exception 'Invalid customer details.';
  end if;
  if v_pin is not null and v_pin !~ '^[0-9]{6}$' then
    raise exception 'Invalid PIN code.';
  end if;
  if v_state is null or lower(v_state) <> all(v_valid_states) then
    raise exception 'Invalid delivery state.';
  end if;

  -- A stable lock order avoids deadlocks when two carts contain shared variants.
  for item in select value from jsonb_array_elements(p_items)
    order by value->>'variant_id' loop
    if (item->>'variant_id') is null or
       (item->>'variant_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
       coalesce(item->>'quantity','') !~ '^[0-9]{1,3}$' then
      raise exception 'Invalid variant or quantity.';
    end if;
    v_variant:=(item->>'variant_id')::uuid;
    v_qty:=(item->>'quantity')::integer;
    if v_qty not between 1 and 100 then raise exception 'Invalid quantity.'; end if;

    select pv.stock_quantity, p.selling_price, p.product_code
      into v_product from public.product_variants pv
      join public.products p on p.id=pv.product_id
      where pv.id=v_variant and pv.active and p.active for update of pv;
    if not found or v_product.stock_quantity < v_qty then
      raise exception 'Product unavailable or insufficient stock.';
    end if;
    v_subtotal:=v_subtotal+v_qty*v_product.selling_price;
  end loop;

  v_discount:=round(v_subtotal*0.03,2);
  v_taxable:=round(v_subtotal-v_discount,2);
  v_cgst:=round(v_taxable*0.015,2);
  v_sgst:=round(v_taxable*0.015,2);
  v_delivery:=case when lower(v_state)='tamil nadu' then 50 else 100 end;
  v_total:=round(v_taxable+v_cgst+v_sgst+v_delivery,2);
  if v_total<=0 or v_total>10000000 then raise exception 'Invalid total.'; end if;

  -- Do NOT look up or update an existing customer using only a submitted phone.
  -- Guest orders receive an independent immutable checkout contact snapshot.
  insert into public.customers(name,whatsapp_number,email,address,city,state,pin_code)
  values (v_name,v_phone,v_email,v_address,v_city,v_state,v_pin)
  returning id into v_customer_id;

  v_order_number:='RG-'||to_char(now(),'YYYYMMDD')||'-'||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.orders(
    order_number,customer_id,source,status,payment_status,
    subtotal,discount_amount,cgst_amount,sgst_amount,delivery_fee,
    total_amount,shipping_address,notes)
  values (
    v_order_number,v_customer_id,'online','pending','pending',
    v_subtotal,v_discount,v_cgst,v_sgst,v_delivery,v_total,
    v_address,concat_ws(' | ',nullif(v_city,''),nullif(v_state,''),nullif(v_pin,'')))
  returning id into v_order_id;

  insert into public.payments(order_id,method,amount,status)
  values(v_order_id,'razorpay'::public.payment_method,v_total,'pending');

  for item in select value from jsonb_array_elements(p_items)
    order by value->>'variant_id' loop
    v_variant:=(item->>'variant_id')::uuid;
    v_qty:=(item->>'quantity')::integer;
    select p.product_code,p.product_name,p.type,p.selling_price,
      pv.color,pv.size,p.length_cm,p.thickness,p.gold_amount_g
      into v_product from public.product_variants pv
      join public.products p on p.id=pv.product_id
      where pv.id=v_variant;
    update public.product_variants
      set stock_quantity=stock_quantity-v_qty,updated_at=now()
      where id=v_variant;
    insert into public.order_items(
      order_id,variant_id,product_code,product_name,quantity,unit_price,
      line_total,product_type,variant_color,variant_size,length_cm,thickness,gold_amount_g)
    values(v_order_id,v_variant,v_product.product_code,v_product.product_name,
      v_qty,v_product.selling_price,v_qty*v_product.selling_price,
      v_product.type,v_product.color,v_product.size,
      v_product.length_cm,v_product.thickness,v_product.gold_amount_g);
  end loop;
  insert into public.razorpay_checkouts(
    checkout_id,order_id,amount_paise,expires_at,status)
  values(p_checkout_id,v_order_id,(v_total*100)::bigint,
    now()+interval '25 minutes','creating');
  return jsonb_build_object('state','new','order_number',v_order_number,
    'amount_paise',(v_total*100)::bigint,
    'expires_at',now()+interval '25 minutes');
end;
$$;

create or replace function public.attach_razorpay_order(
  p_checkout_id uuid,p_gateway_order_id text,p_amount_paise bigint
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_checkout public.razorpay_checkouts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  select * into v_checkout from public.razorpay_checkouts
    where checkout_id=p_checkout_id for update;
  if not found then raise exception 'Checkout does not exist.'; end if;
  if v_checkout.status='ready' and v_checkout.gateway_order_id=p_gateway_order_id then
    return jsonb_build_object('state','ready','gateway_order_id',p_gateway_order_id);
  end if;
  if v_checkout.status<>'creating' or v_checkout.expires_at<=now() or
    p_amount_paise<>v_checkout.amount_paise or
    p_gateway_order_id !~ '^order_[A-Za-z0-9_]+$' then
    raise exception 'Cannot attach provider order.';
  end if;
  update public.razorpay_checkouts
  set gateway_order_id=p_gateway_order_id,status='ready',updated_at=now()
  where checkout_id=p_checkout_id;
  return jsonb_build_object('state','ready','gateway_order_id',p_gateway_order_id);
end;
$$;

create or replace function public.get_razorpay_checkout(p_checkout_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_checkout record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  select status,gateway_order_id,amount_paise into v_checkout
  from public.razorpay_checkouts where checkout_id=p_checkout_id;
  if not found then return null; end if;
  return jsonb_build_object('state',v_checkout.status,
    'gateway_order_id',v_checkout.gateway_order_id,
    'amount_paise',v_checkout.amount_paise);
end;
$$;

create or replace function public.complete_razorpay_checkout(
  p_gateway_order_id text,p_payment_id text,p_amount_paise bigint,p_event_id text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_checkout public.razorpay_checkouts%rowtype;
        v_number text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_payment_id !~ '^pay_[A-Za-z0-9_]+$' then raise exception 'Invalid payment identifier.'; end if;
  select * into v_checkout from public.razorpay_checkouts
    where gateway_order_id=p_gateway_order_id for update;
  if not found then raise exception 'Unknown provider order.'; end if;
  if p_amount_paise is distinct from v_checkout.amount_paise then
    raise exception 'Payment amount mismatch.';
  end if;
  select order_number into v_number from public.orders where id=v_checkout.order_id;
  if v_checkout.status='paid' then
    if v_checkout.gateway_payment_id<>p_payment_id then
      raise exception 'Another payment was recorded for this order. Investigate and refund.';
    end if;
    return jsonb_build_object('paid',true,'state','paid','order_number',v_number);
  end if;
  if v_checkout.status='refund_required' then
    if v_checkout.gateway_payment_id<>p_payment_id then
      raise exception 'Additional captured payment requires investigation.';
    end if;
    return jsonb_build_object('paid',false,'state','refund_required','order_number',v_number);
  end if;
  if v_checkout.status not in ('ready','expired') then
    raise exception 'Checkout is not ready for settlement.';
  end if;
  if v_checkout.status='expired' or v_checkout.expires_at<now() then
    -- Money can arrive after a reservation expires. Track it; do NOT fulfil
    -- against inventory that may already have been returned to stock.
    update public.razorpay_checkouts
    set status='refund_required',gateway_payment_id=p_payment_id,
      last_event_id=p_event_id,paid_at=now(),updated_at=now()
    where checkout_id=v_checkout.checkout_id;
    update public.payments set status='paid',transaction_reference=p_payment_id,
      paid_at=now(),verified_at=now() where order_id=v_checkout.order_id and method='razorpay';
    update public.orders set payment_status='paid',updated_at=now()
      where id=v_checkout.order_id;
    return jsonb_build_object('paid',false,'state','refund_required','order_number',v_number);
  end if;
  update public.razorpay_checkouts
  set status='paid',gateway_payment_id=p_payment_id,
    last_event_id=p_event_id,paid_at=now(),updated_at=now()
  where checkout_id=v_checkout.checkout_id;
  update public.payments set status='paid',transaction_reference=p_payment_id,
    paid_at=now(),verified_at=now() where order_id=v_checkout.order_id and method='razorpay';
  update public.orders set payment_status='paid',updated_at=now()
    where id=v_checkout.order_id;
  return jsonb_build_object('paid',true,'state','paid','order_number',v_number);
end;
$$;

create or replace function public.expire_razorpay_checkouts(p_limit integer default 100)
returns integer language plpgsql security definer
set search_path=pg_catalog,public as $$
declare v_checkout record;
        v_item record;
        v_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized.'; end if;
  if p_limit not between 1 and 500 then raise exception 'Invalid cleanup limit.'; end if;
  for v_checkout in
    select checkout_id,order_id from public.razorpay_checkouts
    where status in ('creating','ready')
      and expires_at < now()-interval '10 minutes'
    order by expires_at
    limit p_limit for update skip locked
  loop
    -- The payment provider may report late capture. That must be treated as
    -- refund_required by complete_razorpay_checkout(), never as fulfillment.
    for v_item in select variant_id,quantity from public.order_items
       where order_id=v_checkout.order_id order by variant_id loop
      update public.product_variants set stock_quantity=stock_quantity+v_item.quantity,
        updated_at=now() where id=v_item.variant_id;
    end loop;
    update public.razorpay_checkouts set status='expired',updated_at=now()
      where checkout_id=v_checkout.checkout_id;
    update public.orders set status='cancelled',payment_status='failed',updated_at=now()
      where id=v_checkout.order_id;
    update public.payments set status='failed' where order_id=v_checkout.order_id
      and method='razorpay' and status='pending';
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- No public browser permissions; only Cloudflare's service-role backend calls these RPCs.
revoke all on function public.create_razorpay_checkout(uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.attach_razorpay_order(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.get_razorpay_checkout(uuid) from public,anon,authenticated;
revoke all on function public.complete_razorpay_checkout(text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.expire_razorpay_checkouts(integer) from public,anon,authenticated;
grant execute on function public.create_razorpay_checkout(uuid,jsonb,jsonb) to service_role;
grant execute on function public.attach_razorpay_order(uuid,text,bigint) to service_role;
grant execute on function public.get_razorpay_checkout(uuid) to service_role;
grant execute on function public.complete_razorpay_checkout(text,text,bigint,text) to service_role;
grant execute on function public.expire_razorpay_checkouts(integer) to service_role;
