-- Remove one independently verified duplicate invoice-token index.
-- Preserves invoices_public_token_uidx, public invoice URL and uniqueness.
-- Production application requires approved migration window and schema verification.
BEGIN;
DO $$
DECLARE duplicate_idx oid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index x
      JOIN pg_class i ON i.oid=x.indexrelid
     WHERE x.indrelid='public.invoices'::regclass
       AND i.relname='invoices_public_token_uidx'
       AND x.indisunique AND x.indisvalid
       AND x.indkey::text=(
          SELECT a.attnum::text FROM pg_attribute a
          WHERE a.attrelid='public.invoices'::regclass
          AND a.attname='public_token' AND NOT a.attisdropped)
  ) THEN
    RAISE EXCEPTION 'Preserved invoice public token unique index missing or changed; stop migration';
  END IF;

  SELECT i.oid INTO duplicate_idx
    FROM pg_class i JOIN pg_namespace n ON n.oid=i.relnamespace
   WHERE n.nspname='public' AND i.relname='idx_invoices_unique_public_token'
     AND i.relkind='i';
  IF duplicate_idx IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid=duplicate_idx) THEN
      RAISE EXCEPTION 'Duplicate invoice token index is constraint-owned; review before removal';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index x
       WHERE x.indexrelid=duplicate_idx AND x.indisunique AND x.indisvalid
         AND x.indrelid='public.invoices'::regclass
         AND x.indkey::text=(
           SELECT a.attnum::text FROM pg_attribute a
           WHERE a.attrelid='public.invoices'::regclass
             AND a.attname='public_token' AND NOT a.attisdropped)
    ) THEN
      RAISE EXCEPTION 'Unexpected duplicate index definition; stop migration';
    END IF;
    EXECUTE 'DROP INDEX public.idx_invoices_unique_public_token';
  END IF;
END;
$$;
COMMIT;
