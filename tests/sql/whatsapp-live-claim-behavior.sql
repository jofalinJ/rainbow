-- Runs in a disposable database only. No Meta calls or real customer data.
INSERT INTO public.customers(id,name) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Opted-In Test'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','No Consent Test'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Unpaid Test');
INSERT INTO public.orders(id,customer_id,order_number,payment_status,status,total_amount) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','RG-TEST1','paid','confirmed',100),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','RG-TEST2','paid','confirmed',100),
 ('33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','RG-TEST3','failed','cancelled',100);
INSERT INTO public.razorpay_checkouts(
 order_id,status,amount_refunded_paise,reservation_released_at,
 amount_paise,whatsapp_opt_in,gateway_payment_id) VALUES
 ('11111111-1111-4111-8111-111111111111','paid',0,null,10000,true,'pay_example1'),
 ('22222222-2222-4222-8222-222222222222','paid',0,null,10000,false,'pay_example2'),
 ('33333333-3333-4333-8333-333333333333','failed',0,null,10000,true,'pay_example3');
INSERT INTO public.invoices(order_id,public_token) VALUES
 ('11111111-1111-4111-8111-111111111111','11111111-aaaa-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222','22222222-bbbb-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333','33333333-cccc-4333-8333-333333333333');
INSERT INTO public.payments(order_id,method,status,verified_at,transaction_reference,amount) VALUES
 ('11111111-1111-4111-8111-111111111111','razorpay','paid',now(),'pay_example1',100),
 ('22222222-2222-4222-8222-222222222222','razorpay','paid',now(),'pay_example2',100),
 ('33333333-3333-4333-8333-333333333333','razorpay','failed',null,'pay_example3',100);
INSERT INTO public.whatsapp_notifications(id,order_id,recipient_number,notification_type,status,invoice_url) VALUES
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','919999999999',
   'payment_receipt','pending','https://rainbowgoldcovering.com/invoice.html?token=11111111-aaaa-4111-8111-111111111111'),
 ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','919999999998',
   'payment_receipt','pending','https://rainbowgoldcovering.com/invoice.html?token=22222222-bbbb-4222-8222-222222222222'),
 ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','919999999997',
   'payment_receipt','pending','https://rainbowgoldcovering.com/invoice.html?token=33333333-cccc-4333-8333-333333333333');

DO $rights$
BEGIN
 IF has_function_privilege('anon','public.claim_paid_invoice_whatsapp_production(integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.claim_paid_invoice_whatsapp_production(integer)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.claim_paid_invoice_whatsapp_production(integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Production paid invoice claim callable by wrong role'; END IF;
END;
$rights$;

SET request.jwt.claim.role='service_role';
DO $claim$
DECLARE result jsonb;
BEGIN
 result:=public.claim_paid_invoice_whatsapp_production(5);
 IF jsonb_array_length(result)<>1 THEN
  RAISE EXCEPTION 'Expected only one opted-in verified paid invoice, got %',result;
 END IF;
 IF result->0->>'recipient'<>'919999999999' OR result->0->>'whatsapp_opt_in'<>'true'
  OR result->0->>'payment_verified'<>'true' THEN
  RAISE EXCEPTION 'Incorrect invoice claim';
 END IF;
 IF (SELECT count(*) FROM public.whatsapp_notifications
   WHERE send_started_at IS NOT NULL)<>1 THEN
  RAISE EXCEPTION 'Unconsented or unpaid rows were claimed';
 END IF;
 IF public.claim_paid_invoice_whatsapp_production(5)<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Already claimed invoice was reissued';
 END IF;
END;
$claim$;

SET request.jwt.claim.role='authenticated';
DO $failclosed$
BEGIN
 BEGIN
  PERFORM public.claim_paid_invoice_whatsapp_production(5);
  RAISE EXCEPTION 'Non-service caller could claim invoices';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Non-service caller could claim invoices' THEN RAISE; END IF;
 END;
END;
$failclosed$;
