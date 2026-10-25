-- STAGED: create product and its mandatory initial variant in one DB transaction.
-- SECURITY INVOKER intentionally honors staff RLS; no service-role bypass.
create or replace function public.create_product_with_variant(
  p_product jsonb, p_variant jsonb
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public as $$
declare
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
begin
  if not (public.is_admin() or public.is_inventory_staff()) then
    raise exception 'Product creation requires an active shop staff account'
      using errcode='42501';
  end if;
  if jsonb_typeof(p_product) <> 'object' or jsonb_typeof(p_variant) <> 'object' then
    raise exception 'Product and variant details are required';
  end if;
  if nullif(btrim(p_product->>'product_name'),'') is null
     or nullif(btrim(p_product->>'type'),'') is null then
    raise exception 'Product name and type are required';
  end if;
  if (p_product->>'selling_price')::numeric <= 0 then
    raise exception 'Selling price must be positive';
  end if;
  insert into public.products (
    category_id, product_name, type, gender, active, selling_price,
    description, length_cm, thickness, gold_amount_g
  ) values (
    (p_product->>'category_id')::uuid,
    btrim(p_product->>'product_name'), btrim(p_product->>'type'),
    coalesce(p_product->>'gender','women'),
    coalesce((p_product->>'active')::boolean,true),
    (p_product->>'selling_price')::numeric,
    p_product->>'description', (p_product->>'length_cm')::numeric,
    p_product->>'thickness', (p_product->>'gold_amount_g')::numeric
  ) returning * into v_product;
  insert into public.product_variants (
    product_id, color, size, length_cm, stock_quantity, low_stock_limit
  ) values (
    v_product.id,
    coalesce(p_variant->>'color','0'), coalesce(p_variant->>'size','0'),
    (p_variant->>'length_cm')::numeric,
    coalesce((p_variant->>'stock_quantity')::integer,0),
    coalesce((p_variant->>'low_stock_limit')::integer,3)
  ) returning * into v_variant;
  return jsonb_build_object(
    'id',v_product.id,'product_code',v_product.product_code,
    'product_name',v_product.product_name,'variant_id',v_variant.id
  );
end; $$;
revoke all on function public.create_product_with_variant(jsonb,jsonb) from public, anon;
grant execute on function public.create_product_with_variant(jsonb,jsonb) to authenticated;
