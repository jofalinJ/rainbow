-- Add ordered storefront categories, audience segments and manually verified UPI payment tracking.
alter table public.categories
  add column if not exists storefront_order integer not null default 100,
  add column if not exists show_in_storefront boolean not null default true;

alter table public.products
  add column if not exists gender text not null default 'women';

do $gender_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.products'::regclass and conname='products_gender_check'
  ) then
    alter table public.products
      add constraint products_gender_check check (gender in ('women','unisex','male'));
  end if;
end
$gender_check$;

alter table public.payments
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz;

create index if not exists payments_order_id_created_at_idx
  on public.payments(order_id,created_at desc);

insert into public.categories
  (name,code_prefix,has_color,has_size,has_length,has_thickness,has_gold_amount,active,storefront_order,show_in_storefront)
values
  ('Thali Chain','RGC/TH',false,false,true,true,true,true,0,true)
on conflict (name) do update set
  code_prefix=excluded.code_prefix,
  has_color=false,
  has_size=false,
  has_length=true,
  has_thickness=true,
  has_gold_amount=true,
  active=true,
  storefront_order=0,
  show_in_storefront=true;

with ranked as (
  select id, row_number() over (
    order by case when name='Thali Chain' then 0 else 1 end, name
  ) * 10 as next_order
  from public.categories
)
update public.categories c
set storefront_order=case when c.name='Thali Chain' then 0 else ranked.next_order end
from ranked
where ranked.id=c.id;

update public.products p
set gender='male'
from public.categories c
where c.id=p.category_id and c.name='Men''s Jewellery';

insert into public.products
  (category_id,product_name,type,description,selling_price,gender,active,display_priority)
select c.id,'Thali Chain','Chain',
  'Unpublished draft. Add the confirmed price, chain measurements, stock and product photo before publishing.',
  0,'unisex',false,10000
from public.categories c
where c.name='Thali Chain'
  and not exists (
    select 1 from public.products p
    where p.category_id=c.id and lower(p.product_name)='thali chain'
  );

update public.business_settings
set business_name='Rainbow Kollam Gold Covering',updated_at=now()
where id=true;

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
$function$

;

create or replace function public.verify_online_order_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role public.staff_role;
  v_order public.orders%rowtype;
  v_payment_id uuid;
begin
  if v_user_id is null then
    raise exception 'Admin sign-in is required.';
  end if;
  select role into v_role
  from public.staff_profiles
  where user_id = v_user_id and active = true;
  if v_role is distinct from 'admin'::public.staff_role then
    raise exception 'Admin access is required to verify payment.';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found or v_order.source::text <> 'online' then
    raise exception 'Online order not found.';
  end if;
  if v_order.payment_status::text = 'paid' then
    return jsonb_build_object('success',true,'already_paid',true,'order_number',v_order.order_number);
  end if;
  if v_order.status::text in ('cancelled','refunded') then
    raise exception 'Cancelled or refunded orders cannot be marked paid.';
  end if;

  select id into v_payment_id
  from public.payments
  where order_id = p_order_id
    and status::text = 'pending'
    and transaction_reference is not null
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'No pending UPI transaction reference is attached to this order.';
  end if;

  update public.payments
  set status = 'paid'::public.payment_status,
      paid_at = coalesce(paid_at,now()),
      verified_by = v_user_id,
      verified_at = now()
  where id = v_payment_id;
  update public.orders
  set payment_status = 'paid'::public.payment_status,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('success',true,'already_paid',false,'order_number',v_order.order_number);
end;
$function$;

revoke all on function public.verify_online_order_payment(uuid) from public, anon;
grant execute on function public.verify_online_order_payment(uuid) to authenticated;
