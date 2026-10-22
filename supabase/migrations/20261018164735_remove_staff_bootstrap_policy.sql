-- The obsolete initial-admin policy tests table emptiness through caller-visible
-- RLS and recursively queries staff_profiles during INSERT policy expansion.
-- That query raises 42P17 for authenticated INSERTs. An admin already exists.
-- Keep the existing active-admin policy and service-role staff provisioning.
DROP POLICY IF EXISTS "bootstrap first admin" ON public.staff_profiles;
