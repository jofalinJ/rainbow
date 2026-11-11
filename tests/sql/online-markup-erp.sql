-- Disposable ERP database only. Never run this test against the live project.
\set ON_ERROR_STOP on
do $$
declare p uuid:='aaaaaaaa-aaaa-4aaa-8aaa-000000000077'; v_price numeric;
begin
 insert into public.products(id,product_code,product_name,selling_price)
 values(p,'MARKUP-QA-77','Markup test',1000);
 insert into public.product_images(id,product_id,public_url,is_primary,sort_order)
 values(gen_random_uuid(),p,'https://example.invalid/markup-test.webp',true,0);
 insert into public.erp_online_listings(product_id,published,online_price)
 values(p,true,1000); -- Client-supplied amount must be ignored.
 select online_price into v_price from public.erp_online_listings where product_id=p;
 if v_price<>1025 then raise exception 'Published markup mismatch: %',v_price; end if;
 if (select selling_price from public.products where id=p)<>1000 then
  raise exception 'Shop price was modified by online publication'; end if;
 update public.erp_online_listings set published=true,online_price=2000 where product_id=p;
 select online_price into v_price from public.erp_online_listings where product_id=p;
 if v_price<>1025 then raise exception 'Online price can be overridden or compounded'; end if;
 update public.products set selling_price=999.99 where id=p;
 select online_price into v_price from public.erp_online_listings where product_id=p;
 if v_price<>1025 then raise exception 'Shop-price change was not propagated'; end if;
 update public.erp_online_listings set published=false where product_id=p;
 if exists(select 1 from public.erp_online_listings where product_id=p and online_price is not null) then
  raise exception 'Unpublished item retained an active online price'; end if;
 update public.erp_online_listings set published=true where product_id=p;
 select online_price into v_price from public.erp_online_listings where product_id=p;
 if v_price<>1025 then raise exception 'Republished online markup compounds'; end if;
 if has_function_privilege('anon','public.rainbow_listing_markup_price()','EXECUTE') or
    has_function_privilege('authenticated','public.rainbow_refresh_markup_on_shop_price()','EXECUTE') then
  raise exception 'Price-maintenance trigger exposed to direct clients'; end if;
end $$;
select 'Automatic online markup ERP checks passed' as result;
