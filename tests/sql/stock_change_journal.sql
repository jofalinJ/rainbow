\set ON_ERROR_STOP on
-- Run ONLY against the ephemeral postgres:17 CI service. Never use real store data.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(pg_catalog.current_setting('rainbow_test.actor_id',true),'')::uuid $$;
create table public.staff_profiles(
  user_id uuid primary key,
  role text not null,
  active boolean not null
);
create table public.product_variants(
  id uuid primary key,
  product_id uuid not null,
  stock_quantity integer not null check(stock_quantity>=0),
  active boolean default true
);

-- Older current inventory must be represented ONLY as an install-time baseline.
insert into public.product_variants(id,product_id,stock_quantity)
values ('00000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',10);

\ir ../../supabase/migrations/20261017220000_stock_change_journal.sql

do $$
begin
  if (select count(*) from public.stock_change_events) <> 1 then
    raise exception 'baseline: expected one event';
  end if;
  if not exists (
    select 1 from public.stock_change_events
    where event_kind='BASELINE' and stock_before is null
      and stock_after=10 and quantity_delta=10 and actor_user_id is null
  ) then
    raise exception 'baseline: wrong starting record';
  end if;
end $$;

-- The inserted variant and each stock mutation should create one journal row.
set rainbow_test.actor_id='20000000-0000-4000-8000-000000000001';
insert into public.staff_profiles(user_id,role,active)
values ('20000000-0000-4000-8000-000000000001','admin',true);

insert into public.product_variants(id,product_id,stock_quantity)
values ('00000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000002',6);

update public.product_variants set stock_quantity=4
where id='00000000-0000-4000-8000-000000000002';

-- Metadata-only updates must not create false quantity movements.
update public.product_variants set active=false
where id='00000000-0000-4000-8000-000000000002';

do $$
begin
  if (select count(*) from public.stock_change_events)<>3 then
    raise exception 'expected baseline + insert + update';
  end if;
  if not exists (
    select 1 from public.stock_change_events
    where event_kind='UPDATE' and stock_before=6 and stock_after=4
      and quantity_delta=-2
      and actor_user_id='20000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'incorrect stock delta/actor for update';
  end if;
end $$;

-- A rolled-back stock insert must not leave an orphan journal entry.
begin;
insert into public.product_variants(id,product_id,stock_quantity)
values ('00000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003',8);
rollback;
do $$
begin
  if exists (
    select 1 from public.stock_change_events
    where variant_id='00000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'rolled-back event persisted';
  end if;
end $$;

delete from public.product_variants
where id='00000000-0000-4000-8000-000000000002';

do $$
begin
  if not exists (
    select 1 from public.stock_change_events
    where event_kind='DELETE' and stock_before=4 and stock_after is null
      and quantity_delta=-4
  ) then
    raise exception 'delete event missing';
  end if;
end $$;

-- Replay migration should not duplicate the baseline or history.
\ir ../../supabase/migrations/20261017220000_stock_change_journal.sql
do $$
begin
  if (select count(*) from public.stock_change_events)<>4 then
    raise exception 'migration replay changed event count';
  end if;
  if (select count(*) from public.stock_change_events where event_kind='BASELINE')<>1 then
    raise exception 'migration replay duplicated baseline';
  end if;
end $$;

-- Direct table access must be denied; read RPC requires an ACTIVE inventory role.
set role authenticated;
do $$
begin
  begin
    perform count(*) from public.stock_change_events;
    raise exception 'direct audit table read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;

  if (select count(*) from public.get_variant_stock_events(
    '00000000-0000-4000-8000-000000000002',30
  ))<>3 then
    raise exception 'authorized RPC did not return variant events';
  end if;
end $$;
reset role;

update public.staff_profiles set active=false
where user_id='20000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
begin
  begin
    perform * from public.get_variant_stock_events(
      '00000000-0000-4000-8000-000000000002',30
    );
    raise exception 'deactivated staff could read stock journal';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'PASS: stock journal migration, delta recording, rollback, idempotence and permissions'
