create or replace function public.create_online_order(
  p_items jsonb,
  p_customer jsonb,
  p_delivery_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  item jsonb;
  v_id uuid;
  v_qty integer;
  v_product record;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_taxable numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_delivery numeric := 0;
  v_total numeric := 0;
  v_distance numeric := nullif(p_delivery_distance_km,0);
  v_name text := nullif(trim(p_customer->>'name'),'');
  v_phone text := nullif(trim(p_customer->>'whatsapp_number'),'');
  v_email text := nullif(trim(p_customer->>'email'),'');
  v_address text := nullif(trim(p_customer->>'address'),'');
  v_city text := nullif(trim(p_customer->>'city'),'');
  v_state text := nullif(trim(p_customer->>'state'),'');
  v_pin text := nullif(trim(p_customer->>'pin_code'),'');
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>50 then
    raise exception 'Invalid order items.';
  end if;
  if v_name is null or v_phone is null or v_address is null then
    raise exception 'Name, WhatsApp number and delivery address are required.';
  end if;
  if v_distance is not null and (v_distance < 0 or v_distance > 500) then
    raise exception 'Invalid delivery distance.';
  end if;

  if (select count(*) from jsonb_array_elements(p_items))
     <> (select count(distinct value->>'variant_id') from jsonb_array_elements(p_items)) then
    raise exception 'Duplicate product variants are not allowed.';
  end if;

  select id into v_customer_id
  from public.customers
  where whatsapp_number=v_phone
  limit 1;

  if v_customer_id is null then
    insert into public.customers(name,whatsapp_number,email,address,city,state,pin_code)
    values(v_name,v_phone,v_email,v_address,v_city,v_state,v_pin)
    returning id into v_customer_id;
  else
    update public.customers
    set name=v_name,email=v_email,address=v_address,city=v_city,state=v_state,pin_code=v_pin,updated_at=now()
    where id=v_customer_id;
  end if;

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

  if v_distance is not null then
    select fee into v_delivery
    from public.delivery_rates
    where active=true and min_km <= v_distance and (max_km is null or max_km >= v_distance)
    order by min_km desc
    limit 1;

    if not found then
      raise exception 'Delivery rate is not configured for this distance. Clear the distance field so the shop can confirm delivery charges.';
    end if;
  end if;

  v_total := round(v_taxable+v_cgst+v_sgst+v_delivery,2);
  v_order_number := 'RG-' || to_char(now(),'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.orders(
    order_number,customer_id,source,status,payment_status,subtotal,discount_amount,cgst_amount,sgst_amount,
    delivery_distance_km,delivery_fee,total_amount,shipping_address,notes
  ) values (
    v_order_number,v_customer_id,'online','pending','pending',v_subtotal,v_discount,v_cgst,v_sgst,
    v_distance,v_delivery,v_total,v_address,
    concat_ws(' | ',nullif(v_city,''),nullif(v_state,''),nullif(v_pin,''))
  ) returning id into v_order_id;

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
