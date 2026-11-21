-- Verify removal of one duplicate index did not weaken lookup uniqueness.
DO $$
BEGIN
 IF to_regclass('public.idx_invoices_unique_public_token') IS NOT NULL THEN
  RAISE EXCEPTION 'Redundant invoice token index was not removed';
 END IF;
 IF to_regclass('public.invoices_public_token_uidx') IS NULL THEN
  RAISE EXCEPTION 'Unique public invoice token index was removed';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
   WHERE x.indrelid='public.invoices'::regclass
     AND i.relname='invoices_public_token_uidx' AND x.indisunique AND x.indisvalid
 ) THEN
  RAISE EXCEPTION 'Retained invoice index is not valid and unique';
 END IF;
 BEGIN
  INSERT INTO public.invoices(invoice_number,public_token)
   VALUES('TEST-ONLY-DUPLICATE','00000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'A duplicated invoice token was accepted';
 EXCEPTION WHEN unique_violation THEN
  NULL;
 END;
 IF (SELECT count(*) FROM public.invoices)<>1 THEN
  RAISE EXCEPTION 'Migration mutated invoice records';
 END IF;
END;
$$;
