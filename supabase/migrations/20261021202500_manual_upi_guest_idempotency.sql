-- Stage ONLY. Validate on an isolated database before deployment.
-- Fix manual UPI checkout retries and prevent guest phone-number overwrites.
create table if not exists public.manual_upi_checkout_requests (
  checkout_id uuid primary key,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.manual_upi_checkout_requests enable row level security;
-- Stop two otherwise different guest sessions from claiming the same UPI reference.
-- Existing manual UPI references must be audited for duplicates before migration.
create unique index if not exists idx_payments_unique_manual_upi_reference
  on public.payments (lower(transaction_reference))
  where method='upi'::public.payment_method and transaction_reference is not null;
revoke all on public.manual_upi_checkout_requests from public, anon, authenticated;
-- SECURITY DEFINER function owner uses the table, while anonymous users cannot browse it.

CREATE OR REPLACE FUNCTION public.create_online_order(p_items jsonb, p_customer jsonb, p_delivery_distance_km numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  item jsonb;
  v_id uuid;
  v_qty integer;
  v_product record;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_checkout_id uuid;
  v_prior_order record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_taxable numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_delivery numeric := 0;
  v_total numeric := 0;
  v_name text := nullif(trim(p_customer->>'name'),'');
  v_phone text := nullif(trim(p_customer->>'whatsapp_number'),'');
  v_email text := nullif(trim(p_customer->>'email'),'');
  v_address text := nullif(trim(p_customer->>'address'),'');
  v_city text := nullif(trim(p_customer->>'city'),'');
  v_state text := nullif(trim(p_customer->>'state'),'');
  v_pin text := nullif(trim(p_customer->>'pin_code'),'');
  v_payment_method text := lower(nullif(trim(p_customer->>'payment_method'),''));
  v_payment_reference text := nullif(trim(p_customer->>'payment_reference'),'');
begin
  if v_payment_method is distinct from 'upi' then
    raise exception 'UPI QR payment is required.';
  end if;
  if v_payment_reference is null or length(v_payment_reference) < 8 or length(v_payment_reference) > 64 or v_payment_reference !~ '^[A-Za-z0-9-]{8,64}$' then
    raise exception 'A valid UPI transaction reference is required.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>50 then
    raise exception 'Invalid order items.';
  end if;
  if v_name is null or v_phone is null or v_address is null then
    raise exception 'Name, WhatsApp number and delivery address are required.';
  end if;
  if v_state is null or not (lower(v_state) = any (array['andaman and nicobar islands','andhra pradesh','arunachal pradesh','assam','bihar','chandigarh','chhattisgarh','dadra and nagar haveli and daman and diu','delhi','goa','gujarat','haryana','himachal pradesh','jammu and kashmir','jharkhand','karnataka','kerala','ladakh','lakshadweep','madhya pradesh','maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','puducherry','punjab','rajasthan','sikkim','tamil nadu','telangana','tripura','uttar pradesh','uttarakhand','west bengal'])) then
    raise exception 'Select a valid Indian state or union territory for delivery.';
  end if;
  if p_delivery_distance_km is not null then
    raise exception 'Distance-based delivery pricing has been replaced with state-based pricing.';
  end if;

  if (select count(*) from jsonb_array_elements(p_items))
     <> (select count(distinct value->>'variant_id') from jsonb_array_elements(p_items)) then
    raise exception 'Duplicate product variants are not allowed.';
  end if;

  -- Legacy cached clients may omit checkout_id; derive a stable UUID from
  -- their UPI reference + phone so that identical retries remain idempotent.
  -- New clients generate a cryptographically random checkout_id per checkout.
  if nullif(p_customer->>'checkout_id','') is not null then
    v_checkout_id := (p_customer->>'checkout_id')::uuid;
  else
    v_checkout_id := md5(lower(v_phone)||'|'||v_payment_reference)::uuid;
  end if;
  if v_checkout_id is null then raise exception 'Missing checkout identifier.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_checkout_id::text, 0));
  select o.id,o.order_number,o.subtotal,o.discount_amount,o.cgst_amount,
         o.sgst_amount,o.delivery_fee,o.total_amount
  into v_prior_order
  from public.manual_upi_checkout_requests r
  join public.orders o on o.id=r.order_id
  where r.checkout_id=v_checkout_id
  for update of r;
  if found then
    return jsonb_build_object(
      'order_id',v_prior_order.id,
      'order_number',v_prior_order.order_number,
      'subtotal',v_prior_order.subtotal,
      'discount_amount',v_prior_order.discount_amount,
      'cgst_amount',v_prior_order.cgst_amount,
      'sgst_amount',v_prior_order.sgst_amount,
      'delivery_fee',v_prior_order.delivery_fee,
      'total_amount',v_prior_order.total_amount,
      'already_created',true
    );
  end if;

  -- Guest checkout must never overwrite an existing customer by phone alone.
  insert into public.customers(name,whatsapp_number,email,address,city,state,pin_code)
  values(v_name,v_phone,v_email,v_address,v_city,v_state,v_pin)
  returning id into v_customer_id;

  for item in select value from jsonb_array_elements(p_items) loop
    v_id := (item->>'variant_id')::uuid;
    v_qty := (item->>'quantity')::integer;

    if v_qty is null or v_qty < 1 or v_qty > 100 then
      raise exception 'Invalid quantity.';
    end if;

    select pv.stock_quantity, p.product_code, p.product_name, p.type, p.selling_price
      into v_product
      from public.product_variants pv
      join public.products p on p.id=pv.product_id
      where pv.id=v_id and pv.active=true and p.active=true
      for update of pv;

    if not found then
      raise exception 'Product variant is unavailable.';
    end if;

    if v_product.stock_quantity < v_qty then
      raise exception 'Insufficient stock for product %.', v_product.product_code;
    end if;

    v_subtotal := v_subtotal + (v_product.selling_price * v_qty);
  end loop;

  v_discount := round(v_subtotal * 0.03,2);
  v_taxable := round(v_subtotal-v_discount,2);
  v_cgst := round(v_taxable*0.015,2);
  v_sgst := round(v_taxable*0.015,2);

  -- Calculate shipping on the server; browser totals are only a preview.
  v_delivery := case when lower(v_state) = 'tamil nadu' then 50 else 100 end;

  v_total := round(v_taxable+v_cgst+v_sgst+v_delivery,2);
  v_order_number := 'RG-' || to_char(now(),'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.orders(
    order_number,customer_id,source,status,payment_status,subtotal,discount_amount,cgst_amount,sgst_amount,
    delivery_distance_km,delivery_fee,total_amount,shipping_address,notes
  ) values (
    v_order_number,v_customer_id,'online','pending','pending',v_subtotal,v_discount,v_cgst,v_sgst,
    null,v_delivery,v_total,v_address,
    concat_ws(' | ',nullif(v_city,''),nullif(v_state,''),nullif(v_pin,''))
  ) returning id into v_order_id;

  if v_total <= 0 then
    raise exception 'A positive payment amount is required.';
  end if;
  insert into public.payments(order_id,method,amount,status,transaction_reference)
  values(v_order_id,v_payment_method::public.payment_method,v_total,'pending'::public.payment_status,v_payment_reference);

  for item in select value from jsonb_array_elements(p_items) loop
    v_id := (item->>'variant_id')::uuid;
    v_qty := (item->>'quantity')::integer;

    select pv.stock_quantity, p.product_code, p.product_name, p.type, p.selling_price,
           pv.color, pv.size, p.length_cm, p.thickness, p.gold_amount_g
      into v_product
      from public.product_variants pv
      join public.products p on p.id=pv.product_id
      where pv.id=v_id and pv.active=true and p.active=true
      for update of pv;

    update public.product_variants
    set stock_quantity=stock_quantity-v_qty, updated_at=now()
    where id=v_id;

    insert into public.order_items(
      order_id,variant_id,product_code,product_name,quantity,unit_price,discount_amount,line_total,
      product_type,variant_color,variant_size,length_cm,thickness,gold_amount_g
    ) values (
      v_order_id,v_id,v_product.product_code,v_product.product_name,v_qty,v_product.selling_price,0,
      v_product.selling_price*v_qty,v_product.type,v_product.color,v_product.size,
      v_product.length_cm,v_product.thickness,v_product.gold_amount_g
    );
  end loop;

  insert into public.manual_upi_checkout_requests(checkout_id,order_id)
  values(v_checkout_id,v_order_id);

  return jsonb_build_object(
    'order_id',v_order_id,
    'order_number',v_order_number,
    'subtotal',v_subtotal,
    'discount_amount',v_discount,
    'cgst_amount',v_cgst,
    'sgst_amount',v_sgst,
    'delivery_fee',v_delivery,
    'total_amount',v_total
  );
end;
$function$;

