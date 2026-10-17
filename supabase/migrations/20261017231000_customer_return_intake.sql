-- Phase 5B: original-sale-linked, exactly-once physical customer return intake.
-- NOT A REFUND / CREDIT NOTE: money, tax and original invoice remain untouched.
-- Requires Phase 1 ledger columns and Phase 3 sale source ledger.
-- Staged migration; never apply directly to the live Rainbow database.
begin;

create table if not exists public.customer_returns (
 id uuid primary key,
 order_id uuid not null references public.orders(id),
 order_item_id uuid not null references public.order_items(id),
 variant_id uuid not null references public.product_variants(id),
 quantity integer not null check(quantity between 1 and 100000),
 condition text not null check(condition in ('sellable','quarantine')),
 reason text not null check(length(btrim(reason)) between 12 and 240),
 received_by uuid not null references auth.users(id),
 request_hash text not null check(length(request_hash)=64),
 financial_status text not null default 'review_required'
  check(financial_status in ('review_required')),
 stock_before integer,
 stock_after integer,
 received_at timestamptz not null default now(),
 check(
   (condition='quarantine' and stock_before is null and stock_after is null)
    or
   (condition='sellable' and stock_before is not null and stock_after is not null
     and stock_before>=0 and stock_after=stock_before+quantity)
 )
);
create index if not exists customer_returns_item_idx
 on public.customer_returns(order_item_id,received_at desc);
create index if not exists customer_returns_order_idx
 on public.customer_returns(order_id,received_at desc);

alter table public.inventory_transactions
 add column if not exists reference_customer_return_id uuid
 references public.customer_returns(id);
create unique index if not exists inventory_once_per_customer_return
 on public.inventory_transactions(reference_customer_return_id)
 where reference_customer_return_id is not null;
alter table public.inventory_transactions
 drop constraint if exists inventory_customer_return_balance;
alter table public.inventory_transactions
 add constraint inventory_customer_return_balance check(
   reference_customer_return_id is null or
   (transaction_type='return'::public.inventory_tx_type
    and quantity_delta=quantity and quantity_delta>0
    and stock_after=stock_before+quantity and stock_before>=0)
 ) not valid;

alter table public.customer_returns enable row level security;
revoke all on public.customer_returns from public,anon,authenticated;
grant select on public.customer_returns to authenticated;
drop policy if exists "Admin reviews customer returns" on public.customer_returns;
create policy "Admin reviews customer returns" on public.customer_returns
 for select to authenticated using(
  exists(select 1 from public.staff_profiles s where s.user_id=(select auth.uid())
    and s.active=true and s.role='admin')
 );

create or replace function public.intake_customer_return(
 p_operation_id uuid,
 p_order_item_id uuid,
 p_quantity integer,
 p_condition text,
 p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid:=auth.uid();
 v_reason text:=btrim(coalesce(p_reason,''));
 v_order_id uuid;
 v_order public.orders%rowtype;
 v_line public.order_items%rowtype;
 v_previous record;
 v_hash text;
 v_already integer;
 v_stock_before integer;
 v_stock_after bigint;
begin
 if v_actor is null or not exists(
  select 1 from public.staff_profiles s where s.user_id=v_actor
   and s.active=true and s.role='admin'
 ) then raise exception 'Customer returns require an active administrator'
    using errcode='42501';end if;
 if p_operation_id is null or p_order_item_id is null or
    p_quantity is null or p_quantity not between 1 and 100000 or
    p_condition not in ('sellable','quarantine') or
    length(v_reason) not between 12 and 240 then
  raise exception 'Invalid quantity, item, condition or reason' using errcode='22023';
 end if;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
   jsonb_build_object('order_item',p_order_item_id,'qty',p_quantity,
   'condition',p_condition,'reason',v_reason)::text,'UTF8')),'hex');
 -- Lock the parent order to serialize simultaneous returns for any line.
 select oi.order_id into v_order_id from public.order_items oi
 where oi.id=p_order_item_id;
 if not found then raise exception 'Original order item missing' using errcode='22023';end if;
 select * into v_order from public.orders o where o.id=v_order_id for update;
 if not found then raise exception 'Original order missing' using errcode='23514';end if;

 select r.received_by,r.request_hash,r.quantity,r.condition into v_previous
 from public.customer_returns r where r.id=p_operation_id;
 if found then
  if v_previous.received_by<>v_actor or v_previous.request_hash<>v_hash then
   raise exception 'Return ID reused with different details' using errcode='22023';
  end if;
  return jsonb_build_object('return_id',p_operation_id,'replayed',true,
    'quantity',v_previous.quantity,'condition',v_previous.condition,
    'financial_status','review_required');
 end if;

 -- Never accept a return against a pending allocation, an unverified payment,
 -- or a previously cancelled/refunded order. No automatic financial refund.
 if v_order.payment_status<>'paid' or
    v_order.status in ('cancelled','refunded') or
    (v_order.source='online' and v_order.status<>'delivered') or
    (v_order.source='local_store' and v_order.status<>'confirmed') then
  raise exception 'Only fully paid, completed sales can have goods returned'
    using errcode='23514';
 end if;
 if not exists(select 1 from public.payments pay
  where pay.order_id=v_order_id and pay.status='paid') then
  raise exception 'Original paid payment record not found' using errcode='23514';
 end if;

 select * into v_line from public.order_items oi
 where oi.id=p_order_item_id and oi.order_id=v_order_id;
 if not found then raise exception 'Original order item missing' using errcode='23514';end if;

 -- Verify original stock-out exists. Legacy local sales are allowed only
 -- if exactly one same-quantity sale_local row exists for the variant/order.
 if not exists(
  select 1 from public.inventory_transactions it
  where it.reference_order_id=v_order_id and it.variant_id=v_line.variant_id
   and it.transaction_type=case when v_order.source='online'
     then 'sale_online'::public.inventory_tx_type
     else 'sale_local'::public.inventory_tx_type end
 ) then raise exception 'Original stock-out ledger missing; manual reconciliation required'
  using errcode='23514';end if;

 select coalesce(sum(r.quantity),0)::integer into v_already
 from public.customer_returns r where r.order_item_id=p_order_item_id;
 if v_already+p_quantity>v_line.quantity then
  raise exception 'Return exceeds remaining quantity on original sale'
    using errcode='23514';
 end if;

 if p_condition='sellable' then
  select pv.stock_quantity into v_stock_before
  from public.product_variants pv where pv.id=v_line.variant_id
  for update;
  if not found then raise exception 'Product variant missing; quarantine/manual review'
    using errcode='23514';end if;
  v_stock_after:=v_stock_before::bigint+p_quantity::bigint;
  if v_stock_after>1000000000 then
   raise exception 'Stock exceeds supported range' using errcode='22003';
  end if;
 else
  v_stock_before:=null;
  v_stock_after:=null;
 end if;

 insert into public.customer_returns(
  id,order_id,order_item_id,variant_id,quantity,condition,reason,
  received_by,request_hash,stock_before,stock_after)
 values(p_operation_id,v_order_id,v_line.id,v_line.variant_id,p_quantity,
  p_condition,v_reason,v_actor,v_hash,v_stock_before,v_stock_after::integer);

 if p_condition='sellable' then
  update public.product_variants pv
  set stock_quantity=v_stock_after::integer,updated_at=now()
  where pv.id=v_line.variant_id;

  insert into public.inventory_transactions(
   variant_id,transaction_type,quantity,quantity_delta,stock_before,stock_after,
   reference_order_id,reference_customer_return_id,reason,created_by
  ) values(
   v_line.variant_id,'return',p_quantity,p_quantity,v_stock_before,v_stock_after::integer,
   v_order_id,p_operation_id,'Received sellable customer return: '||v_reason,v_actor
  );
 end if;

 return jsonb_build_object('return_id',p_operation_id,'replayed',false,
  'order_id',v_order_id,'order_number',v_order.order_number,
  'quantity',p_quantity,'condition',p_condition,
  'financial_status','review_required',
  'stock_released',p_condition='sellable');
end $fn$;

revoke all on function public.intake_customer_return(uuid,uuid,integer,text,text)
 from public,anon,authenticated;
grant execute on function public.intake_customer_return(uuid,uuid,integer,text,text)
 to authenticated;
commit;
