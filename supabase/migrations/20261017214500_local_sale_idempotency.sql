-- Rainbow P0: at-most-once local POS sales for the same authenticated staff operation.
-- Review and apply to ISOLATED STAGING before any client uses create_local_sale_once.
-- Do not run against production as part of a Git branch change.
--
-- The existing create_local_sale(jsonb,jsonb,text) is the legacy transactional
-- implementation. The wrapper reuses it in the same PostgreSQL transaction,
-- so an interrupted HTTP response can be retried with the same operation UUID.
-- This protects a REPLAY of one request; distinct operation IDs still represent
-- distinct purchases. Never substitute this for payment reconciliation.

create table if not exists public.local_sale_idempotency (
  operation_id uuid primary key,
  actor_id uuid not null,
  request_hash text not null check (length(request_hash) = 32),
  response jsonb,
  created_at timestamptz not null default now()
);
create index if not exists local_sale_idempotency_actor_created_idx
  on public.local_sale_idempotency(actor_id,created_at desc);
alter table public.local_sale_idempotency enable row level security;
-- Neither customer nor staff browsers can inspect or mutate operation records.
revoke all on table public.local_sale_idempotency from public,anon,authenticated;

create or replace function public.create_local_sale_once(
  p_operation_id uuid,
  p_items jsonb,
  p_customer jsonb default null::jsonb,
  p_payment_method text default 'cash'::text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_hash text;
  v_inserted uuid;
  v_saved record;
  v_result jsonb;
begin
  -- Check authorization even for cached replays (deactivated staff cannot replay).
  if v_actor is null or not exists (
    select 1 from public.staff_profiles s
    where s.user_id=v_actor and s.active=true and s.role in ('admin','cashier')
  ) then
    raise exception 'Billing access denied' using errcode='42501';
  end if;
  if p_operation_id is null then
    raise exception 'A sale operation ID is required' using errcode='22023';
  end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Invalid sale items' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x.value) <> 'object'
       or nullif(x.value->>'variant_id','') is null
  ) then
    raise exception 'Invalid sale line item' using errcode='22023';
  end if;
  -- The legacy RPC individually checks stock per line. Reject duplicate SKUs
  -- here instead of allowing one cart to check the same stock twice.
  if (select count(*) from jsonb_array_elements(p_items)) <> (
    select count(distinct x.value->>'variant_id') from jsonb_array_elements(p_items) x
  ) then
    raise exception 'Duplicate variants in one sale are not allowed' using errcode='22023';
  end if;

  -- Canonical jsonb textual form gives stable hashing despite object-key order.
  -- Hash only; do not persist customer PII or full cart payload.
  v_hash := pg_catalog.md5(
    jsonb_build_object('items',p_items,'customer',p_customer,'payment_method',p_payment_method)::text
  );

  -- Concurrent calls with the same UUID wait on the unique constraint.
  -- Only the winner creates a sale; all subsequent calls replay its result.
  insert into public.local_sale_idempotency(operation_id,actor_id,request_hash)
  values(p_operation_id,v_actor,v_hash)
  on conflict (operation_id) do nothing
  returning operation_id into v_inserted;

  if v_inserted is null then
    select actor_id,request_hash,response into v_saved
    from public.local_sale_idempotency where operation_id=p_operation_id;
    if not found then
      raise exception 'Sale request is not yet available; retry with the same ID';
    end if;
    if v_saved.actor_id <> v_actor then
      raise exception 'Operation belongs to another cashier' using errcode='42501';
    end if;
    if v_saved.request_hash <> v_hash then
      raise exception 'Sale operation ID cannot be reused with different details'
        using errcode='22023';
    end if;
    if v_saved.response is null then
      raise exception 'Sale operation is unresolved; retry with same ID';
    end if;
    return v_saved.response;
  end if;

  -- No exception handling here: failed sales roll back the key and all writes.
  -- On success, the sale and saved response commit atomically.
  v_result := public.create_local_sale(p_items,p_customer,p_payment_method);
  update public.local_sale_idempotency
    set response=v_result where operation_id=p_operation_id;
  return v_result;
end;
$function$;

revoke execute on function public.create_local_sale_once(uuid,jsonb,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.create_local_sale_once(uuid,jsonb,jsonb,text)
  to authenticated;

-- IMPORTANT:
-- Existing create_local_sale remains callable during phased client migration.
-- After all counter apps are upgraded, separately deprecate its direct EXECUTE
-- grant and audit online order paths; otherwise older clients can bypass this
-- wrapper. Do not revoke it in this deployment before existing clients switch.
