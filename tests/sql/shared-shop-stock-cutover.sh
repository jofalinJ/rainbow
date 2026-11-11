#!/usr/bin/env bash
# Destructive fixtures. Run only on the disposable ERP test database.
set -euo pipefail
[[ "${PGDATABASE:-}" == rainbow_erp_cutover || "${PGDATABASE:-}" == rainbow_erp_qa ]]
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
ops=supabase/operations

run_sql() {
  psql -X -q -v ON_ERROR_STOP=1 "$@"
}
expect_refused() {
  local script="$1" expected="$2"
  if run_sql -f "$ops/$script" >"$dir/guard.log" 2>&1; then
    echo "Unexpectedly accepted $script" >&2
    return 1
  fi
  cat "$dir/guard.log"
  grep -Fq "$expected" "$dir/guard.log"
}
snapshot() {
  run_sql -At <<'SQL'
select jsonb_build_array(
 app_private.erp_shared_branch_stock(),
 (select jsonb_agg(to_jsonb(b) order by location_id,variant_id) from public.erp_stock_balances b),
 (select jsonb_agg(stock_quantity order by id) from public.product_variants),
 (select count(*) from public.erp_stock_events),
 (select count(*) from public.erp_transfers)
);
SQL
}

run_sql <<'SQL'
begin;
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.create_razorpay_checkout(
 '77000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '[{"variant_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","quantity":1}]',
 '{"name":"Synthetic Rollback","whatsapp_number":"9000000001","address":"Synthetic QA Lane","state":"Tamil Nadu"}'
);
commit;
SQL
held="$(snapshot)"
expect_refused deactivate_shared_branch_stock_MANUAL.sql 'Drain online payments and stock holds'
[[ "$(snapshot)" == "$held" ]]

run_sql <<'SQL'
begin;
update public.razorpay_checkouts set expires_at=now()-interval '1 hour'
where checkout_id='77000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
set local request.jwt.claim.role='service_role';
select public.expire_razorpay_checkouts();
commit;
SQL
before_rollback="$(run_sql -At -c 'select jsonb_agg(to_jsonb(b) order by location_id,variant_id) from public.erp_stock_balances b')"
run_sql -f "$ops/deactivate_shared_branch_stock_MANUAL.sql"
[[ "$(run_sql -At -c 'select jsonb_agg(to_jsonb(b) order by location_id,variant_id) from public.erp_stock_balances b')" == "$before_rollback" ]]
[[ "$(run_sql -At -c 'select not app_private.erp_shared_branch_stock() and not exists(select 1 from public.product_variants where stock_quantity<>0)')" == t ]]

# Reproduce the production blocker with synthetic stock. Adjust and transfer
# through the legacy ERP paths while shared stock is disabled.
run_sql <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.erp_adjust_stock((select id from public.erp_locations where code='BR-ONE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',88,'Synthetic cutover blocker',
 '77100000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.erp_adjust_stock((select id from public.erp_locations where code='ONLINE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',3,'Synthetic cutover blocker',
 '77200000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.erp_dispatch_transfer(
 (select id from public.erp_locations where code='BR-ONE'),
 (select id from public.erp_locations where code='ONLINE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',1,'Synthetic cutover blocker',
 '77300000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.erp_dispatch_transfer(
 (select id from public.erp_locations where code='BR-ONE'),
 (select id from public.erp_locations where code='ONLINE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',2,'Synthetic cutover blocker',
 '77400000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
commit;
SQL
[[ "$(run_sql -At -c "select sum(b.on_hand) filter(where l.kind='branch')=92 and sum(b.on_hand) filter(where l.kind='online')=3 from public.erp_stock_balances b join public.erp_locations l on l.id=b.location_id")" == t ]]
blocked="$(snapshot)"
expect_refused activate_shared_branch_stock_MANUAL.sql 'Resolve existing stock holds and Online Store balances'
[[ "$(snapshot)" == "$blocked" ]]
run_sql <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.erp_adjust_stock((select id from public.erp_locations where code='ONLINE'),
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',-3,'Clear synthetic Online Store balance',
 '77500000-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
commit;
SQL
blocked="$(snapshot)"
expect_refused activate_shared_branch_stock_MANUAL.sql 'Resolve in-transit Online Store transfers'
[[ "$(snapshot)" == "$blocked" ]]
echo 'Cutover and rollback checks passed: rejected unresolved state, preserved physical balances.'
