-- Disposable PostgreSQL only; no customer details or production data.
CREATE TABLE public.invoices (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 invoice_number text NOT NULL,
 public_token uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE UNIQUE INDEX idx_invoices_unique_public_token
 ON public.invoices(public_token);
CREATE UNIQUE INDEX invoices_public_token_uidx
 ON public.invoices(public_token);
INSERT INTO public.invoices(invoice_number,public_token)
 VALUES('TEST-ONLY-INVOICE','00000000-0000-4000-8000-000000000001');
