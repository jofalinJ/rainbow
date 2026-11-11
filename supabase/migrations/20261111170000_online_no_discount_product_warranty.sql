-- Online checkout: 0% discount; product warranty 8 to 60 months.
-- No change to local POS discount rules. Existing invoices remain historical snapshots.
-- The server-generated Razorpay amount, online order and storefront must agree.
BEGIN;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS warranty_months integer;
DO $verify_warranty_constraint$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_warranty_months_range' AND conrelid='public.products'::regclass) THEN
  ALTER TABLE public.products ADD CONSTRAINT products_warranty_months_range
    CHECK(warranty_months IS NULL OR warranty_months BETWEEN 8 AND 60);
 END IF;
END
$verify_warranty_constraint$;

-- Online create_razorpay_checkout uses existing permissions, shipping, GST, stock and idempotency, with zero discount.
CREATE OR REPLACE FUNCTION public.create_razorpay_checkout(p_checkout_id uuid, p_items jsonb, p_customer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  v_igst numeric;
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

    select pv.stock_quantity, l.online_price as selling_price, p.product_code
      into v_product from public.product_variants pv
      join public.products p on p.id=pv.product_id
      join public.erp_online_listings l on l.product_id=p.id and l.published and l.online_price>0
      where pv.id=v_variant and pv.active and p.active for update of pv,p,l;
    if not found or v_product.stock_quantity < v_qty then
      raise exception 'Product unavailable or insufficient stock.';
    end if;
    v_subtotal:=v_subtotal+v_qty*v_product.selling_price;
  end loop;

  v_discount:=0;
  v_taxable:=v_subtotal;
  if lower(v_state)='tamil nadu' then
    v_cgst:=round(v_taxable*0.015,2);
    v_sgst:=round(v_taxable*0.015,2);
    v_igst:=0;
  else
    v_cgst:=0;
    v_sgst:=0;
    v_igst:=round(v_taxable*0.03,2);
  end if;
  v_delivery:=case when lower(v_state)='tamil nadu' then 50 else 100 end;
  v_total:=round(v_taxable+v_cgst+v_sgst+v_igst+v_delivery,2);
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
    subtotal,discount_amount,cgst_amount,sgst_amount,igst_amount,delivery_fee,
    total_amount,shipping_address,notes)
  values (
    v_order_number,v_customer_id,'online','pending','pending',
    v_subtotal,v_discount,v_cgst,v_sgst,v_igst,v_delivery,v_total,
    v_address,concat_ws(' | ',nullif(v_city,''),nullif(v_state,''),nullif(v_pin,'')))
  returning id into v_order_id;

  insert into public.payments(order_id,method,amount,status)
  values(v_order_id,'razorpay'::public.payment_method,v_total,'pending');

  for item in select value from jsonb_array_elements(p_items)
    order by value->>'variant_id' loop
    v_variant:=(item->>'variant_id')::uuid;
    v_qty:=(item->>'quantity')::integer;
    select p.product_code,p.product_name,p.type,l.online_price as selling_price,
      pv.color,pv.size,p.length_cm,p.thickness,p.gold_amount_g
      into v_product from public.product_variants pv
      join public.products p on p.id=pv.product_id
      join public.erp_online_listings l on l.product_id=p.id and l.published and l.online_price>0
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
$function$;

-- Online create_online_order uses existing permissions, shipping, GST, stock and idempotency, with zero discount.
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
  v_igst numeric := 0;
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
         o.sgst_amount,o.igst_amount,o.delivery_fee,o.total_amount
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
      'igst_amount',v_prior_order.igst_amount,
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

    select pv.stock_quantity, p.product_code, p.product_name, p.type, l.online_price as selling_price
      into v_product
      from public.product_variants pv
      join public.products p on p.id=pv.product_id
      join public.erp_online_listings l on l.product_id=p.id and l.published and l.online_price>0
      where pv.id=v_id and pv.active=true and p.active=true
      for update of pv,p,l;

    if not found then
      raise exception 'Product variant is unavailable.';
    end if;

    if v_product.stock_quantity < v_qty then
      raise exception 'Insufficient stock for product %.', v_product.product_code;
    end if;

    v_subtotal := v_subtotal + (v_product.selling_price * v_qty);
  end loop;

  v_discount := 0;
  v_taxable := v_subtotal;
  if lower(v_state) = 'tamil nadu' then
    v_cgst := round(v_taxable*0.015,2);
    v_sgst := round(v_taxable*0.015,2);
    v_igst := 0;
  else
    v_cgst := 0;
    v_sgst := 0;
    v_igst := round(v_taxable*0.03,2);
  end if;

  -- Calculate shipping on the server; browser totals are only a preview.
  v_delivery := case when lower(v_state) = 'tamil nadu' then 50 else 100 end;

  v_total := round(v_taxable+v_cgst+v_sgst+v_igst+v_delivery,2);
  v_order_number := 'RG-' || to_char(now(),'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.orders(
    order_number,customer_id,source,status,payment_status,subtotal,discount_amount,cgst_amount,sgst_amount,igst_amount,
    delivery_distance_km,delivery_fee,total_amount,shipping_address,notes
  ) values (
    v_order_number,v_customer_id,'online','pending','pending',v_subtotal,v_discount,v_cgst,v_sgst,v_igst,
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

    select pv.stock_quantity, p.product_code, p.product_name, p.type, l.online_price as selling_price,
           pv.color, pv.size, p.length_cm, p.thickness, p.gold_amount_g
      into v_product
      from public.product_variants pv
      join public.products p on p.id=pv.product_id
      join public.erp_online_listings l on l.product_id=p.id and l.published and l.online_price>0
      where pv.id=v_id and pv.active=true and p.active=true
      for update of pv,p,l;

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
    'igst_amount',v_igst,
    'delivery_fee',v_delivery,
    'total_amount',v_total
  );
end;
$function$;

COMMIT;
