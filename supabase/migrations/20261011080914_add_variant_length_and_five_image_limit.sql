-- Allow a product's stocked variants to represent selectable lengths.
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS length_cm numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_length_cm_positive'
      AND conrelid = 'public.product_variants'::regclass
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_length_cm_positive
      CHECK (length_cm IS NULL OR length_cm > 0);
  END IF;
END $$;

-- Enforce at most five image records per product, including concurrent uploads.
CREATE OR REPLACE FUNCTION public.enforce_product_image_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  existing_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.products WHERE id = NEW.product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found for image.';
  END IF;

  SELECT count(*) INTO existing_count
  FROM public.product_images WHERE product_id = NEW.product_id;

  IF existing_count >= 5 THEN
    RAISE EXCEPTION 'A product may have no more than 5 images.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_product_image_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_limit_product_images ON public.product_images;
CREATE TRIGGER trg_limit_product_images
  BEFORE INSERT OR UPDATE OF product_id ON public.product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_image_limit();
