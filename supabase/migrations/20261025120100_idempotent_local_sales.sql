-- STAGED ONLY. Apply after isolated PostgreSQL integration tests.
-- Idempotency claim, sale and response share one DB transaction.
create table if not exists app_private.local_sale_requests (
  request_id uuid primary key,
  created_by uuid not null references auth.users(id),
  payload_hash text not null,
  response jsonb,
  created_at timestamptz not null default now()
);
alter table app_private.local_sale_requests enable row level security;
revoke all on app_private.local_sale_requests from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_local_sale(p_items jsonb, p_customer jsonb DEFAULT NULL::jsonb, p_payment_method text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role public.staff_role;
  v_order_id uuid;
  v_customer_id uuid;
  v_order_number text;
  v_invoice_number text;
  v_public_token uuid;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_tax_base numeric(12,2) := 0;
  v_cgst numeric(12,2) := 0;
  v_sgst numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_payment_method public.payment_method;
  v_customer_name text;
  v_customer_phone text;
  v_customer_email text;
  v_customer_address text;
  v_customer_city text;
  v_customer_state text;
  v_customer_pin text;
  v_item jsonb;
  v_variant_id uuid;
  v_qty integer;
  v_price numeric(12,2);
  v_code text;
  v_name text;
  v_type text;
  v_color text;
  v_size text;
  v_length numeric;
  v_thickness text;
  v_gold numeric;
  v_line_total numeric(12,2);
  v_stock integer;
  v_product_id uuid;
  v_count integer := 0;
  v_request_id uuid;
  v_request_hash text;
  v_existing_actor uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_final_response jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select role into v_role
  from public.staff_profiles
  where user_id = v_uid and active = true;

  if v_role is null or v_role not in ('admin','cashier') then
    raise exception 'Billing access denied';
  end if;

  if p_payment_method not in ('cash','upi','card','bank_transfer') then
    raise exception 'Unsupported local payment method';
  end if;

  v_payment_method := p_payment_method::public.payment_method;
  if coalesce(p_customer->>'client_sale_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'A valid client_sale_id is required. Refresh the billing application.';
  end if;
  v_request_id := (p_customer->>'client_sale_id')::uuid;
  v_request_hash := md5(coalesce(p_items::text,'null') || '|' ||
    coalesce(p_customer::text,'null') || '|' || coalesce(p_payment_method,''));
  insert into app_private.local_sale_requests(request_id,created_by,payload_hash)
    values (v_request_id,v_uid,v_request_hash) on conflict (request_id) do nothing;
  select created_by,payload_hash,response
    into v_existing_actor,v_existing_hash,v_existing_response
    from app_private.local_sale_requests where request_id = v_request_id for update;
  if v_existing_actor is distinct from v_uid or v_existing_hash is distinct from v_request_hash then
    raise exception 'Sale identifier was already used for a different request';
  end if;
  if v_existing_response is not null then return v_existing_response; end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'Too many line items';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) as item(value)
    group by item.value->>'variant_id' having count(*)>1) then
    raise exception 'Duplicate product variant in sale';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'variant_id' loop
    v_count := v_count + 1;
    begin
      v_variant_id := (v_item->>'variant_id')::uuid;
      v_qty := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Invalid line item at position %', v_count;
    end;

    if v_qty is null or v_qty <= 0 or v_qty > 1000 then
      raise exception 'Invalid quantity at line item %', v_count;
    end if;

    select
      pv.stock_quantity,
      pv.product_id,
      p.product_code,
      p.product_name,
      p.type,
      pv.color,
      pv.size,
      p.length_cm,
      p.thickness,
      p.gold_amount_g,
      round(p.selling_price::numeric, 2)
    into
      v_stock,
      v_product_id,
      v_code,
      v_name,
      v_type,
      v_color,
      v_size,
      v_length,
      v_thickness,
      v_gold,
      v_price
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = v_variant_id
      and pv.active = true
      and p.active = true
    for update of pv;

    if not found then
      raise exception 'Product variant is no longer available';
    end if;

    if v_stock < v_qty then
      raise exception 'Insufficient stock for % (available: %, requested: %)', v_code, v_stock, v_qty;
    end if;

    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_discount := round(v_subtotal * 0.03, 2);
  v_tax_base := round(v_subtotal - v_discount, 2);
  v_cgst := round(v_tax_base * 0.015, 2);
  v_sgst := round(v_tax_base * 0.015, 2);
  v_total := round(v_tax_base + v_cgst + v_sgst, 2);

  v_customer_name := nullif(trim(coalesce(p_customer->>'name','')), '');
  v_customer_phone := nullif(trim(coalesce(p_customer->>'whatsapp_number','')), '');
  v_customer_email := nullif(trim(coalesce(p_customer->>'email','')), '');
  v_customer_address := nullif(trim(coalesce(p_customer->>'address','')), '');
  v_customer_city := nullif(trim(coalesce(p_customer->>'city','')), '');
  v_customer_state := nullif(trim(coalesce(p_customer->>'state','')), '');
  v_customer_pin := nullif(trim(coalesce(p_customer->>'pin_code','')), '');

  -- Walk-in sales still require an order-linked customer.
  insert into public.customers (
      name, whatsapp_number, email, address, city, state, pin_code
    )
    values (
      coalesce(v_customer_name, 'Walk-in Customer'),
      coalesce(v_customer_phone,''),
      v_customer_email,
      v_customer_address,
      v_customer_city,
      v_customer_state,
      v_customer_pin
    )
    returning id into v_customer_id;

  v_order_number := 'LS-' || to_char(current_date, 'YYYYMMDD') || '-' ||
                    lpad(nextval('public.local_order_number_seq')::text, 6, '0');
  v_invoice_number := 'INV-' || to_char(current_date, 'YYYYMMDD') || '-' ||
                      lpad(nextval('public.local_invoice_number_seq')::text, 6, '0');
  v_public_token := gen_random_uuid();

  insert into public.orders (
    order_number, customer_id, source, status, payment_status,
    subtotal, discount_amount, cgst_amount, sgst_amount,
    delivery_distance_km, delivery_fee, total_amount,
    shipping_address, notes, created_by
  )
  values (
    v_order_number, v_customer_id, 'local_store', 'confirmed', 'paid',
    v_subtotal, v_discount, v_cgst, v_sgst,
    null, 0, v_total,
    v_customer_address, null, v_uid
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'variant_id' loop
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    select
      pv.stock_quantity,
      pv.product_id,
      p.product_code,
      p.product_name,
      p.type,
      pv.color,
      pv.size,
      p.length_cm,
      p.thickness,
      p.gold_amount_g,
      round(p.selling_price::numeric, 2)
    into
      v_stock,
      v_product_id,
      v_code,
      v_name,
      v_type,
      v_color,
      v_size,
      v_length,
      v_thickness,
      v_gold,
      v_price
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = v_variant_id
      and pv.active = true
      and p.active = true
    for update of pv;

    v_line_total := round(v_price * v_qty, 2);

    insert into public.order_items (
      order_id, variant_id, product_code, product_name, product_type,
      variant_color, variant_size, length_cm, thickness, gold_amount_g,
      quantity, unit_price, discount_amount, line_total
    )
    values (
      v_order_id, v_variant_id, v_code, v_name, v_type,
      nullif(v_color,'0'), nullif(v_size,'0'), v_length, v_thickness, v_gold,
      v_qty, v_price, round(v_line_total * 0.03, 2), v_line_total
    );

    update public.product_variants
    set stock_quantity = stock_quantity - v_qty,
        updated_at = now()
    where id = v_variant_id;

    insert into public.inventory_transactions (
      variant_id, transaction_type, quantity, reference_order_id, reason, created_by
    )
    values (
      v_variant_id, 'sale_local', v_qty, v_order_id, 'POS local sale ' || v_order_number, v_uid
    );
  end loop;

  insert into public.payments (
    order_id, method, amount, status, transaction_reference, paid_at
  )
  values (
    v_order_id, v_payment_method, v_total, 'paid', null, now()
  );

  insert into public.invoices (
    order_id, invoice_number, public_token
  )
  values (
    v_order_id, v_invoice_number, v_public_token
  );

  v_final_response := jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'invoice_number', v_invoice_number,
    'public_token', v_public_token,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'cgst_amount', v_cgst,
    'sgst_amount', v_sgst,
    'total_amount', v_total,
    'payment_method', v_payment_method
  );
  update app_private.local_sale_requests set response=v_final_response
    where request_id=v_request_id and created_by=v_uid;
  return v_final_response;
end;
$function$;

-- A cashier may recover a completed invoice after a timeout or tablet reload
-- without re-entering the cart or risking a second stock deduction.
-- No cross-account reads: return only the original cashier's committed response.
create or replace function public.get_local_sale_receipt(p_request_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = '' as $recovery$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_profiles
    where user_id = auth.uid() and active = true and role in ('admin','cashier')
  ) then
    raise exception 'Active billing staff required' using errcode = '42501';
  end if;
  select response into v_result from app_private.local_sale_requests
    where request_id=p_request_id and created_by=auth.uid();
  return v_result;
end;
$recovery$;
revoke all on function public.get_local_sale_receipt(uuid) from public, anon, authenticated;
grant execute on function public.get_local_sale_receipt(uuid) to authenticated;
