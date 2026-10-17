-- Phase 5B: customer returns with independently verified refunds.
-- Staging-only. A return may restock an inspected item; it NEVER sends funds.
-- Refund confirmation records evidence of a separate external settlement.
begin;
create table if not exists public.customer_returns (
 id uuid primary key,
 order_id uuid not null references public.orders(id),
 request_hash text not null check(length(request_hash)=64),
 reason text not null check(length(btrim(reason)) between 12 and 240),
 expected_refund numeric(12,2) not null check(expected_refund>=0),
 received_by uuid not null references auth.users(id),
 received_at timestamptz not null default now()
);
create index if not exists customer_returns_order_idx on public.customer_returns(order_id);
create table if not exists public.customer_return_lines (
 id uuid primary key default gen_random_uuid(),
 return_id uuid not null references public.customer_returns(id),
 order_item_id uuid not null references public.order_items(id),
 variant_id uuid not null references public.product_variants(id),
 quantity integer not null check(quantity between 1 and 100000),
 restockable boolean not null,
 unique(return_id,order_item_id)
);
create table if not exists public.customer_refund_confirmations (
 return_id uuid primary key references public.customer_returns(id),
 amount numeric(12,2) not null check(amount>0),
 method text not null check(method in ('cash','upi','card','bank_transfer')),
 external_reference text not null check(length(btrim(external_reference)) between 6 and 100),
 confirmed_by uuid not null references auth.users(id),
 confirmed_at timestamptz not null default now()
);
create unique index if not exists customer_refunds_unique_payment_evidence
 on public.customer_refund_confirmations(method,lower(btrim(external_reference)));
alter table public.inventory_transactions add column if not exists
 reference_customer_return_line_id uuid references public.customer_return_lines(id);
create unique index if not exists stock_return_unique_source_line
 on public.inventory_transactions(reference_customer_return_line_id)
 where reference_customer_return_line_id is not null;
alter table public.inventory_transactions drop constraint if exists customer_stock_return_balances;
alter table public.inventory_transactions add constraint customer_stock_return_balances
 check(reference_customer_return_line_id is null or
   (transaction_type='return'::public.inventory_tx_type
    and quantity_delta=quantity and quantity_delta>0
    and stock_before>=0 and stock_after=stock_before+quantity)) not valid;

revoke all on public.customer_returns,public.customer_return_lines,
 public.customer_refund_confirmations from public,anon,authenticated;
grant select on public.customer_returns,public.customer_return_lines,
 public.customer_refund_confirmations to authenticated;
alter table public.customer_returns enable row level security;
alter table public.customer_return_lines enable row level security;
alter table public.customer_refund_confirmations enable row level security;
drop policy if exists "admins inspect returns" on public.customer_returns;
create policy "admins inspect returns" on public.customer_returns
 for select to authenticated using(exists(select 1 from public.staff_profiles s
 where s.user_id=auth.uid() and s.active=true and s.role='admin'));
drop policy if exists "admins inspect return lines" on public.customer_return_lines;
create policy "admins inspect return lines" on public.customer_return_lines
 for select to authenticated using(exists(select 1 from public.staff_profiles s
 where s.user_id=auth.uid() and s.active=true and s.role='admin'));
drop policy if exists "admins inspect refund evidence" on public.customer_refund_confirmations;
create policy "admins inspect refund evidence" on public.customer_refund_confirmations
 for select to authenticated using(exists(select 1 from public.staff_profiles s
 where s.user_id=auth.uid() and s.active=true and s.role='admin'));

create or replace function public.receive_customer_return(
 p_return_id uuid,p_order_id uuid,p_lines jsonb,p_reason text,
 p_expected_refund numeric
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid:=auth.uid();v_order public.orders%rowtype;
 v_reason text:=btrim(coalesce(p_reason,''));v_hash text;
 v_existing record;v_item record;v_order_item record;
 v_before integer;v_new bigint;v_prev integer;v_paid numeric;
 v_prior_due numeric;v_count integer:=0;v_line_id uuid;
begin
 if v_actor is null or not exists(select 1 from public.staff_profiles s
  where s.user_id=v_actor and s.active=true and s.role='admin') then
  raise exception 'Only active administrators may receive customer returns'
   using errcode='42501';
 end if;
 if p_return_id is null or p_order_id is null
  or length(v_reason) not between 12 and 240
  or p_expected_refund is null or p_expected_refund<0
  or p_expected_refund>99999999.99
  or p_expected_refund<>round(p_expected_refund,2)
  or jsonb_typeof(p_lines)<>'array'
  or jsonb_array_length(p_lines) not between 1 and 50 then
  raise exception 'Invalid customer return request' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x
   where jsonb_typeof(x.value)<>'object'
   or (x.value->>'quantity') !~ '^[0-9]{1,6}$'
   or (x.value->>'quantity')::integer not between 1 and 100000
   or (x.value->>'restockable') not in ('true','false')
   or coalesce(x.value->>'order_item_id','')='')
 or (select count(*) from jsonb_array_elements(p_lines)) <>
    (select count(distinct x.value->>'order_item_id')
       from jsonb_array_elements(p_lines) x) then
  raise exception 'Invalid or repeated returned order line' using errcode='22023';
 end if;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  jsonb_build_object('order',p_order_id,'lines',p_lines,
   'reason',v_reason,'refund',p_expected_refund)::text,'UTF8')),'hex');
 -- Serializes new returns and payment confirmations for one order.
 select * into v_order from public.orders
  where id=p_order_id for update;
 if not found then raise exception 'Original sale not found' using errcode='22023';end if;
 select r.id,r.order_id,r.request_hash,r.received_by
  into v_existing from public.customer_returns r where r.id=p_return_id;
 if found then
  if v_existing.order_id<>p_order_id or v_existing.request_hash<>v_hash
     or v_existing.received_by<>v_actor then
   raise exception 'Return ID reused with changed details' using errcode='22023';
  end if;
  return jsonb_build_object('return_id',p_return_id,'replayed',true,
    'refund_recorded',false);
 end if;
 if v_order.status in ('cancelled','refunded')
   or v_order.payment_status<>'paid' then
  raise exception 'Only paid, non-cancelled sales qualify for this workflow'
   using errcode='23514';
 end if;
 select coalesce(sum(p.amount),0) into v_paid from public.payments p
  where p.order_id=p_order_id and p.status='paid';
 if v_paid<=0 then
  raise exception 'Original settled payment not found' using errcode='23514';
 end if;
 select coalesce(sum(r.expected_refund),0) into v_prior_due
  from public.customer_returns r where r.order_id=p_order_id;
 if v_prior_due+p_expected_refund >
    least(v_paid,coalesce(v_order.total_amount,v_paid)) then
  raise exception 'Cumulative refund request exceeds original payment'
   using errcode='23514';
 end if;
 -- Legacy/manual return postings are ambiguous; never compensate twice.
 if exists(select 1 from public.inventory_transactions t
   where t.reference_order_id=p_order_id
    and t.transaction_type='return'
    and t.reference_customer_return_line_id is null) then
  raise exception 'Unlinked prior return exists; supervisor reconciliation required'
   using errcode='23514';
 end if;
 insert into public.customer_returns
  (id,order_id,request_hash,reason,expected_refund,received_by)
  values(p_return_id,p_order_id,v_hash,v_reason,p_expected_refund,v_actor);
 for v_item in
  select x.value->>'order_item_id' as item_id,
   (x.value->>'quantity')::integer as qty,
   (x.value->>'restockable')::boolean as restockable
  from jsonb_array_elements(p_lines) x order by x.value->>'order_item_id'
 loop
  select oi.id,oi.variant_id,oi.quantity into v_order_item
  from public.order_items oi
  where oi.id=v_item.item_id::uuid and oi.order_id=p_order_id;
  if not found then raise exception 'Item does not belong to original sale'
   using errcode='23514';end if;
  select coalesce(sum(rl.quantity),0)::integer into v_prev
   from public.customer_return_lines rl
   join public.customer_returns rr on rr.id=rl.return_id
   where rr.order_id=p_order_id and rl.order_item_id=v_order_item.id;
  if v_prev+v_item.qty>v_order_item.quantity then
   raise exception 'Returned quantity exceeds original sale'
    using errcode='23514';
  end if;
  insert into public.customer_return_lines
   (return_id,order_item_id,variant_id,quantity,restockable)
  values(p_return_id,v_order_item.id,v_order_item.variant_id,v_item.qty,
   v_item.restockable) returning id into v_line_id;
  if v_item.restockable then
   select v.stock_quantity into v_before from public.product_variants v
    where v.id=v_order_item.variant_id and v.active=true for update;
   if not found then raise exception 'Stock variant unavailable; reconcile manually'
    using errcode='23514';end if;
   v_new:=v_before::bigint+v_item.qty;
   if v_new>1000000000 then
    raise exception 'Stock after return exceeds limit' using errcode='22003';
   end if;
   update public.product_variants set stock_quantity=v_new::integer,updated_at=now()
    where id=v_order_item.variant_id;
   insert into public.inventory_transactions(
    variant_id,transaction_type,quantity,quantity_delta,
    stock_before,stock_after,reference_order_id,
    reference_customer_return_line_id,reason,created_by
   ) values(
    v_order_item.variant_id,'return',v_item.qty,v_item.qty,
    v_before,v_new::integer,p_order_id,v_line_id,
    'Customer return '||p_return_id::text||': '||v_reason,v_actor
   );
  end if;
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('return_id',p_return_id,'replayed',false,
  'line_count',v_count,'refund_due',p_expected_refund,
  'refund_status',case when p_expected_refund=0 then 'not_applicable'
                       else 'pending_external_settlement' end);
end $fn$;

create or replace function public.confirm_customer_refund(
 p_return_id uuid,p_method text,p_reference text,p_settlement_checked boolean
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_actor uuid:=auth.uid();v_return public.customer_returns%rowtype;
 v_existing public.customer_refund_confirmations%rowtype;
 v_reference text:=btrim(coalesce(p_reference,''));
begin
 if v_actor is null or not exists(select 1 from public.staff_profiles s
  where s.user_id=v_actor and s.active=true and s.role='admin') then
  raise exception 'Refund confirmation requires an active admin' using errcode='42501';
 end if;
 if p_return_id is null or p_method not in ('cash','upi','card','bank_transfer')
  or length(v_reference) not between 6 and 100 or p_settlement_checked is distinct from true then
  raise exception 'External refund evidence and administrator confirmation required'
   using errcode='22023';
 end if;
 select * into v_return from public.customer_returns where id=p_return_id for update;
 if not found then raise exception 'Return not found' using errcode='22023';end if;
 if v_return.expected_refund<=0 then
  raise exception 'This return has no monetary refund due' using errcode='23514';
 end if;
 -- Never issue funds here. This call records a previously completed external
 -- settlement/voucher; the provider remains the financial source of truth.
 select * into v_existing from public.customer_refund_confirmations
  where return_id=p_return_id;
 if found then
  if v_existing.method<>p_method or v_existing.external_reference<>v_reference then
   raise exception 'Refund already confirmed with different evidence'
    using errcode='23514';
  end if;
  return jsonb_build_object('return_id',p_return_id,'confirmed',true,'replayed',true);
 end if;
 insert into public.customer_refund_confirmations
  (return_id,amount,method,external_reference,confirmed_by)
 values(p_return_id,v_return.expected_refund,p_method,v_reference,v_actor);
 return jsonb_build_object('return_id',p_return_id,'confirmed',true,'replayed',false,
  'amount',v_return.expected_refund);
end $fn$;
revoke all on function public.receive_customer_return(uuid,uuid,jsonb,text,numeric)
 from public,anon,authenticated;
revoke all on function public.confirm_customer_refund(uuid,text,text,boolean)
 from public,anon,authenticated;
grant execute on function public.receive_customer_return(uuid,uuid,jsonb,text,numeric)
 to authenticated;
grant execute on function public.confirm_customer_refund(uuid,text,text,boolean)
 to authenticated;
commit;
