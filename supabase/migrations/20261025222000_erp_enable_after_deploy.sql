-- Final activation gate. Apply ONLY after the matching client version is deployed,
-- the empty-inventory preflight passes, and live checkout regression tests pass.
begin;
do $$
declare v_legacy_stock bigint; v_online_available bigint; v_pending bigint;
begin
 if not exists(select 1 from public.erp_locations where kind='online' and active)
 or (select count(*) from public.erp_locations where kind='branch' and active)<1
 then raise exception 'Locations not configured'; end if;
 if exists(select 1 from public.orders) then
 raise exception 'Cannot switch checkout inventory with existing orders; reconcile first'; end if;
 select coalesce(sum(stock_quantity),0) into v_legacy_stock from public.product_variants;
 select coalesce(sum(b.on_hand-b.reserved),0) into v_online_available
 from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id
 where l.kind='online';
 if v_legacy_stock<>v_online_available then
 raise exception 'Legacy and online availability disagree (% vs %)',
 v_legacy_stock,v_online_available; end if;
 if exists(select 1 from public.product_variants where stock_quantity<>0) then
 raise exception 'Expected zero legacy opening inventory; review stock before activation';end if;
 select count(*) into v_pending from public.razorpay_checkouts
 where status in ('creating','ready');
 if v_pending>0 then raise exception 'Unsettled Razorpay checkouts exist'; end if;
end $$;
-- Legacy cached staff browsers must fail safely rather than deduct ONLINE stock.
revoke execute on function public.create_local_sale(jsonb,jsonb,text)
 from public,authenticated,anon;
revoke execute on function public.adjust_variant_stock(uuid,integer,text)
 from public,authenticated,anon;
update app_private.erp_activation_state set enabled=true,activated_at=now() where singleton;
commit;
