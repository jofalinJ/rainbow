-- Optional performance indexes for 10k+ products / shared images.
-- Run only in an isolated test environment with the staged ERP migration.
begin;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$
declare opclass_schema text;
begin
 select n.nspname into opclass_schema from pg_extension e
 join pg_namespace n on n.oid=e.extnamespace
 where e.extname='pg_trgm';
 if opclass_schema is null then raise exception 'pg_trgm extension unavailable'; end if;
 execute format('create index if not exists erp_products_name_search_idx on public.products using gin (product_name %I.gin_trgm_ops)',opclass_schema);
 execute format('create index if not exists erp_products_code_search_idx on public.products using gin (product_code %I.gin_trgm_ops)',opclass_schema);
 execute format('create index if not exists erp_variants_barcode_search_idx on public.product_variants using gin (barcode %I.gin_trgm_ops)',opclass_schema);
end $$;
create index if not exists erp_product_images_lookup_idx
 on public.product_images(product_id,is_primary desc,sort_order);
create index if not exists erp_online_listings_published_idx
 on public.erp_online_listings(product_id) where published;
create index if not exists erp_balances_low_stock_idx
 on public.erp_stock_balances(location_id,on_hand,reserved);
commit;
