-- Disposable payment database only. Run AFTER online markup and no-discount migration.
\set ON_ERROR_STOP on
DO $$
DECLARE v_result jsonb; v_order record; v_total numeric; v_bad boolean;
BEGIN
  -- Previous checkout records must keep their original historical discounts.
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o JOIN public.razorpay_checkouts rc ON rc.order_id=o.id
    WHERE rc.checkout_id='66666666-6666-4666-8666-666666666666'::uuid AND o.discount_amount>0
  ) THEN RAISE EXCEPTION 'Historical order discount was changed'; END IF;

  -- New orders use full online list price; GST and shipping remain unchanged.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT public.create_razorpay_checkout(
    '91111111-1111-4111-8111-111111111111'::uuid,
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"No discount test","whatsapp_number":"9999999999","state":"Tamil Nadu","address":"Fixture"}'::jsonb
  ) INTO v_result;
  SELECT o.subtotal,o.discount_amount,o.cgst_amount,o.sgst_amount,o.igst_amount,o.delivery_fee,o.total_amount,
    r.amount_paise INTO v_order
  FROM public.razorpay_checkouts r JOIN public.orders o ON o.id=r.order_id
  WHERE r.checkout_id='91111111-1111-4111-8111-111111111111'::uuid;
  IF v_order.subtotal<>102 OR v_order.discount_amount<>0
      OR v_order.cgst_amount<>1.53 OR v_order.sgst_amount<>1.53
      OR v_order.igst_amount<>0 OR v_order.delivery_fee<>50 OR v_order.total_amount<>155.06
      OR v_order.amount_paise<>15506
  THEN RAISE EXCEPTION 'No-discount Razorpay subtotal, GST or amount mismatch: %',row_to_json(v_order); END IF;
  SELECT public.create_razorpay_checkout(
    '91111111-1111-4111-8111-111111111111'::uuid,'[]'::jsonb,'{}'::jsonb
  ) INTO v_result;
  IF (v_result->>'amount_paise')::bigint<>15506 THEN RAISE EXCEPTION 'Razorpay idempotency amount changed'; END IF;

  PERFORM set_config('request.jwt.claim.role','anon',true);
  SELECT public.create_online_order(
    '[{"variant_id":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb","quantity":1}]'::jsonb,
    '{"name":"No discount manual test","whatsapp_number":"9999999999","state":"Kerala","address":"Fixture","payment_method":"upi","payment_reference":"NO-DISCOUNT-20261111","checkout_id":"92222222-2222-4222-8222-222222222222"}'::jsonb
  ) INTO v_result;
  SELECT subtotal,discount_amount,cgst_amount,sgst_amount,igst_amount,delivery_fee,total_amount INTO v_order
  FROM public.orders WHERE id=(v_result->>'order_id')::uuid;
  IF v_order.subtotal<>102 OR v_order.discount_amount<>0
      OR v_order.cgst_amount<>0 OR v_order.sgst_amount<>0
      OR v_order.igst_amount<>3.06 OR v_order.delivery_fee<>100
      OR v_order.total_amount<>205.06
  THEN RAISE EXCEPTION 'Manual online no-discount GST/totals mismatch: %',row_to_json(v_order); END IF;

  UPDATE public.products SET warranty_months=8 WHERE product_code='TEST001';
  UPDATE public.products SET warranty_months=60 WHERE product_code='TEST001';
  v_bad:=false;
  BEGIN
    UPDATE public.products SET warranty_months=7 WHERE product_code='TEST001';
  EXCEPTION WHEN check_violation THEN v_bad:=true;
  END;
  IF NOT v_bad THEN RAISE EXCEPTION 'Warranty shorter than 8 months was accepted'; END IF;
  v_bad:=false;
  BEGIN
    UPDATE public.products SET warranty_months=61 WHERE product_code='TEST001';
  EXCEPTION WHEN check_violation THEN v_bad:=true;
  END;
  IF NOT v_bad THEN RAISE EXCEPTION 'Warranty longer than five years was accepted'; END IF;
  UPDATE public.products SET warranty_months=NULL WHERE product_code='TEST001';
END $$;
SELECT 'Online no-discount and product warranty checks passed' AS result;
