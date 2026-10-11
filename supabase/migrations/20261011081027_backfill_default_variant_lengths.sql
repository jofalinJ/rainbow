-- Preserve the existing product-level length for its currently stocked variants.
UPDATE public.product_variants AS v
   SET length_cm = p.length_cm
  FROM public.products AS p
 WHERE p.id = v.product_id
   AND v.length_cm IS NULL
   AND p.length_cm IS NOT NULL
   AND p.length_cm > 0;
