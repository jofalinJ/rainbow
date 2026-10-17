-- Invoice printing in admin/bills.js uses the logged-in staff's Supabase session.
-- The token-based public invoice RPC was executable by anon but not authenticated,
-- resulting in "permission denied for function get_public_invoice" while printing.
-- Keep the UUID token requirement and the existing public invoice behavior intact;
-- grant no additional table privileges or service secrets.
GRANT EXECUTE ON FUNCTION public.get_public_invoice(uuid) TO authenticated;
