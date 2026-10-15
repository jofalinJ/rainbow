-- Allow multiple sizes by length for chain products without changing any existing variants.
-- NULLS NOT DISTINCT retains the previous uniqueness behavior for variants without lengths.
-- PostgreSQL 17; duplicates under the old (product_id,color,size) constraint cannot exist.
ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_product_id_color_size_key;
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_product_color_size_length_key
  UNIQUE NULLS NOT DISTINCT (product_id,color,size,length_cm);
