-- Add a dedicated storefront/admin category for men's jewellery.
-- Keep the existing design categories unchanged.
INSERT INTO public.categories
  (name, code_prefix, has_color, has_size, has_length, has_thickness, has_gold_amount, active)
VALUES
  ('Men''s Jewellery', 'RGMJ', true, true, true, true, true, true)
ON CONFLICT (name) DO UPDATE
  SET code_prefix = EXCLUDED.code_prefix,
      has_color = EXCLUDED.has_color,
      has_size = EXCLUDED.has_size,
      has_length = EXCLUDED.has_length,
      has_thickness = EXCLUDED.has_thickness,
      has_gold_amount = EXCLUDED.has_gold_amount,
      active = true;
