#!/usr/bin/env bash
# Competing checkout and cashier sale against one physical-shop balance.
# Only runs inside the disposable GitHub Actions PostgreSQL service.
set -euo pipefail
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

cat > "$dir/checkout.sql" <<'SQL'
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select pg_sleep(0.5);
update public.product_variants
set stock_quantity=stock_quantity-5
where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
commit;
SQL

cat > "$dir/pos.sql" <<'SQL'
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_sleep(0.5);
select public.erp_create_local_sale(
 '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":5}]'::jsonb,
 '{"name":"Synthetic Customer"}'::jsonb,'cash',
 (select id from public.erp_locations where code='BR-ONE'),
 '77777777-7777-4777-8777-777777777777');
commit;
SQL

set +e
PGOPTIONS="-c lock_timeout=8s -c statement_timeout=15s" psql -X -q -f "$dir/checkout.sql" > "$dir/checkout.log" 2>&1 &
checkout_pid=$!
PGOPTIONS="-c lock_timeout=8s -c statement_timeout=15s" psql -X -q -f "$dir/pos.sql" > "$dir/pos.log" 2>&1 &
pos_pid=$!
wait "$checkout_pid"; checkout_result=$?
wait "$pos_pid"; pos_result=$?
set -e

printf '\nCheckout result: %d\n' "$checkout_result"
cat "$dir/checkout.log"
printf '\nPOS result: %d\n' "$pos_result"
cat "$dir/pos.log"

if [ "$checkout_result" -eq "$pos_result" ]; then
 echo 'Expected exactly one competing sale/reservation to succeed'
 exit 1
fi

if grep -Eiq 'deadlock detected|lock timeout|statement timeout' "$dir/checkout.log" "$dir/pos.log"; then
 echo 'A deadlock or timeout occurred; shared inventory lock ordering failed'
 exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $concurrent_assert$
declare v_onhand integer;v_reserved integer;v_available integer;v_mirror integer;v_sales integer;
begin
 select b.on_hand,b.reserved,b.on_hand-b.reserved
  into v_onhand,v_reserved,v_available
 from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id
 where l.code='BR-ONE' and b.variant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 select v.stock_quantity into v_mirror from public.product_variants v
 where v.id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 select count(*) into v_sales from public.orders where source='local_store';
 if v_available<>2 or v_mirror<>2 then
  raise exception 'Shared availability differs after concurrent POS/checkout: branch %, mirror %',v_available,v_mirror;
 end if;
 if not ((v_onhand=7 and v_reserved=5 and v_sales=0)
   or (v_onhand=2 and v_reserved=0 and v_sales=1)) then
  raise exception 'Concurrent sale/hold state invalid: on_hand %, reserved %, POS sales %',v_onhand,v_reserved,v_sales;
 end if;
 if exists(select 1 from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id
  where l.kind='online' and (b.on_hand>0 or b.reserved>0)) then
  raise exception 'Concurrent activity created duplicate Online Store stock';
 end if;
end
$concurrent_assert$;
SQL

echo 'Shared branch inventory race passed: exactly one 5-piece transaction succeeded.'
