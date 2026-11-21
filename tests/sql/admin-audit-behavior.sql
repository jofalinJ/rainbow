-- Runs only against disposable PostgreSQL fixture, never production.
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

INSERT INTO public.staff_profiles(user_id,role,active) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cashier',true);
INSERT INTO public.products(id,selling_price,active) VALUES
('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1000,true);
UPDATE public.products SET selling_price=1200
 WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
-- Irrelevant no-op changes must not produce journal noise.
UPDATE public.products SET selling_price=1200
 WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
INSERT INTO public.erp_online_listings(product_id,published,online_price,updated_by)
 VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',false,null,
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
UPDATE public.erp_online_listings SET published=true,online_price=1230
 WHERE product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
INSERT INTO public.erp_stock_events(location_id,variant_id,action,quantity_delta,actor_id)
 VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
         'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','adjust',5,
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
UPDATE public.staff_profiles SET active=false
 WHERE user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

DO $assert$
BEGIN
 IF (SELECT count(*) FROM public.admin_audit_events) <> 8 THEN
   RAISE EXCEPTION 'Expected 8 narrow audit events';
 END IF;
 IF (SELECT count(*) FROM public.admin_audit_events
     WHERE entity_type='product' AND event_type='price_or_visibility_changed') <> 1 THEN
   RAISE EXCEPTION 'Product price audit missing or no-op logged';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.admin_audit_events
     WHERE entity_type='staff_access' AND event_type='access_changed') THEN
   RAISE EXCEPTION 'Staff permission change not recorded';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.admin_audit_events
     WHERE entity_type='stock_event' AND detail->>'delta'='5') THEN
   RAISE EXCEPTION 'Stock adjustment not recorded';
 END IF;
 IF EXISTS (SELECT 1 FROM public.admin_audit_events
     WHERE detail::text ILIKE '%password%' OR detail::text ILIKE '%email%'
        OR detail::text ILIKE '%whatsapp%' OR detail::text ILIKE '%access_token%') THEN
   RAISE EXCEPTION 'Sensitive content leaked into audit detail';
 END IF;
 IF has_table_privilege('authenticated','public.admin_audit_events','INSERT')
    OR has_table_privilege('anon','public.admin_audit_events','SELECT') THEN
   RAISE EXCEPTION 'Unsafe audit table privileges';
 END IF;
END;
$assert$;

-- Actual RLS assertions as an authenticated owner, then as a cashier.
SET ROLE authenticated;
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $owner$
BEGIN
 IF (SELECT count(*) FROM public.admin_audit_events) <> 8 THEN
   RAISE EXCEPTION 'Active admin cannot read all audit events';
 END IF;
END;
$owner$;
SET request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $cashier$
BEGIN
 IF (SELECT count(*) FROM public.admin_audit_events) <> 0 THEN
   RAISE EXCEPTION 'Non-admin can read private audit events';
 END IF;
END;
$cashier$;
RESET ROLE;
