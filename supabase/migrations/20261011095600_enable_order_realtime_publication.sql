-- Publish customer orders and line items so authorized staff screens can refresh in real time.
-- Existing table grants and RLS policies remain unchanged.
alter publication supabase_realtime add table public.orders, public.order_items;
