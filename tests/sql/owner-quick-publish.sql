-- Owner quick-publish migration safety checks on disposable PostgreSQL 17 only.
-- These tests deliberately use synthetic products; NEVER run against production.
\set ON_ERROR_STOP on

-- The existing production DB already has an image-limit trigger. In this
-- isolated fixture we install one against the newly updated function.
create trigger owner_test_product_image_limit
 before insert or update of product_id on public.product_images
 for each row execute function public.enforce_product_image_limit();

do $$
declare
 p uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
 rejected boolean;
 total integer;
begin
 insert into public.products(id,product_code,product_name,selling_price)
 values (p,'OWNER-QA-01','Owner QA sample',100);

 -- A blank-photo product must not become publicly listed.
 rejected := false;
 begin
  insert into public.erp_online_listings(product_id,published) values (p,true);
 exception when check_violation then rejected := true;
 end;
 if not rejected then raise exception 'Publishing a photo-less product was accepted'; end if;

 insert into public.product_images(id,product_id,is_primary,sort_order,public_url)
 select gen_random_uuid(),p,n=1,n,'https://example.invalid/qa-'||n||'.webp'
 from generate_series(1,6) n;

 select count(*) into total from public.product_images where product_id=p;
 if total<>6 then raise exception 'Six-photo upload failed: %', total; end if;

 rejected := false;
 begin
  insert into public.product_images(id,product_id,is_primary,sort_order,public_url)
  values (gen_random_uuid(),p,false,7,'https://example.invalid/qa-7.webp');
 exception when check_violation then rejected := true;
 end;
 if not rejected then raise exception 'Seven-photo upload incorrectly accepted'; end if;

 update public.products set selling_price=0 where id=p;
 rejected := false;
 begin
  insert into public.erp_online_listings(product_id,published) values (p,true);
 exception when check_violation then rejected := true;
 end;
 if not rejected then raise exception 'Non-positive price was published'; end if;

 update public.products set selling_price=100, archived_at=now() where id=p;
 rejected := false;
 begin
  insert into public.erp_online_listings(product_id,published) values (p,true);
 exception when check_violation then rejected := true;
 end;
 if not rejected then raise exception 'Archived product was published'; end if;

 update public.products set archived_at=null where id=p;
 insert into public.erp_online_listings(product_id,published) values (p,true);
 if not exists(select 1 from public.erp_online_listings where product_id=p and published) then
  raise exception 'Valid product did not publish';
 end if;

 -- Taking a product offline is allowed even if its metadata changes.
 update public.products set selling_price=0 where id=p;
 update public.erp_online_listings set published=false where product_id=p;
 if exists(select 1 from public.erp_online_listings where product_id=p and published) then
  raise exception 'Unpublish did not persist';
 end if;
end
$$;

do $$
begin
 if has_function_privilege('anon','public.enforce_product_image_limit()','EXECUTE') then
  raise exception 'Image-limit trigger callable by anonymous visitors';
 end if;
 if has_function_privilege('authenticated','public.owner_validate_online_publication()','EXECUTE') then
  raise exception 'Publication validator callable directly by staff';
 end if;
end
$$;
select 'Owner quick-publish SQL gates passed (disposable database only)' as result;
