-- Invoked as anonymous customer so the security-definer invoice RPC
-- is verified without granting direct SELECT on customers/orders/invoices.
GRANT EXECUTE ON FUNCTION public.get_public_invoice(uuid) TO anon;
SET ROLE anon;
DO $$
DECLARE public_invoice jsonb;local_invoice jsonb;
BEGIN
  SELECT public.get_public_invoice('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    INTO public_invoice;
  IF public_invoice IS NULL
     OR public_invoice->>'invoice_number'<>'TEST-PAID'
     OR public_invoice->>'customer_name'<>'Test Customer'
     OR public_invoice->>'customer_phone'<>'919999999999'
     OR public_invoice->>'payment_method'<>'razorpay'
     OR (public_invoice->>'igst_amount')::numeric<>18
     OR (public_invoice->>'total_amount')::numeric<>118
     OR jsonb_array_length(public_invoice->'items')<>1 THEN
    RAISE EXCEPTION 'Paid invoice data was changed or hidden';
  END IF;
  IF public_invoice ?| array['customer_email','customer_address',
      'customer_city','customer_state','customer_pin_code'] OR
     public_invoice::text LIKE '%SECRET STREET%' OR
     public_invoice::text LIKE '%private@example.test%' THEN
    RAISE EXCEPTION 'Anonymous invoice leaks hidden personal details';
  END IF;
  SELECT public.get_public_invoice('aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    INTO local_invoice;
  IF local_invoice IS NULL OR local_invoice->>'invoice_number'<>'TEST-LOCAL' THEN
    RAISE EXCEPTION 'Legitimate local-store receipt was broken';
  END IF;
  IF public.get_public_invoice('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa') IS NOT NULL THEN
    RAISE EXCEPTION 'Unpaid online checkout exposed invoice';
  END IF;
  IF public.get_public_invoice('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown bearer token exposed invoice';
  END IF;
END;
$$;
RESET ROLE;
UPDATE public.orders SET status='cancelled'
 WHERE id='22222222-2222-4222-8222-222222222222';
SET ROLE anon;
DO $$
BEGIN
  IF public.get_public_invoice('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa') IS NOT NULL THEN
    RAISE EXCEPTION 'Cancelled invoice remained available';
  END IF;
END;
$$;
RESET ROLE;
