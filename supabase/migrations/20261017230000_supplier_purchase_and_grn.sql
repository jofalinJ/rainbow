-- Phase 5A: supplier → purchase order → guarded goods receipt.
-- Staging only. Requires the existing inventory_transactions balance columns.
-- Does not modify any stock when this migration is installed.
begin;

create table if not exists public.suppliers (
 id uuid primary key default gen_random_uuid(),
 supplier_name text not null check(length(btrim(supplier_name)) between 2 and 120),
 phone text,
 gstin text,
 active boolean not null default true,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create sequence if not exists public.purchase_po_number_seq;
create sequence if not exists public.purchase_grn_number_seq;

create table if not exists public.purchase_orders (
 id uuid primary key,
 po_number text not null unique default
   ('PO-' || lpad(nextval('public.purchase_po_number_seq')::text,8,'0')),
 supplier_id uuid not null references public.suppliers(id),
 status text not null default 'ordered'
   check(status in ('ordered','partially_received','received','cancelled')),
 notes text,
 request_hash text not null check(length(request_hash)=64),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
 purchase_order_id uuid not null references public.purchase_orders(id),
 variant_id uuid not null references public.product_variants(id),
 quantity_ordered integer not null check(quantity_ordered between 1 and 100000),
 unit_cost numeric(12,2) not null check(unit_cost>=0),
 primary key(purchase_order_id,variant_id)
);

create table if not exists public.goods_receipts (
 id uuid primary key,
 grn_number text not null unique default
   ('GRN-' || lpad(nextval('public.purchase_grn_number_seq')::text,8,'0')),
 purchase_order_id uuid not null references public.purchase_orders(id),
 supplier_id uuid not null references public.suppliers(id),
 supplier_invoice text not null check(length(btrim(supplier_invoice)) between 3 and 80),
 request_hash text not null check(length(request_hash)=64),
 received_by uuid not null references auth.users(id),
 received_at timestamptz not null default now()
);

create unique index if not exists goods_receipts_supplier_invoice_unique
  on public.goods_receipts(supplier_id,lower(btrim(supplier_invoice)));

create table if not exists public.goods_receipt_lines (
 id uuid primary key default gen_random_uuid(),
 goods_receipt_id uuid not null references public.goods_receipts(id),
 variant_id uuid not null references public.product_variants(id),
 quantity_received integer not null check(quantity_received between 1 and 100000),
 stock_before integer not null check(stock_before>=0),
 stock_after integer not null check(stock_after>=0),
 unique(goods_receipt_id,variant_id),
 check(stock_after=stock_before+quantity_received)
);

alter table public.inventory_transactions
 add column if not exists reference_goods_receipt_line_id uuid
 references public.goods_receipt_lines(id);
create unique index if not exists stock_in_unique_goods_receipt_line
 on public.inventory_transactions(reference_goods_receipt_line_id)
 where reference_goods_receipt_line_id is not null;
alter table public.inventory_transactions
 drop constraint if exists stock_in_receipt_balance_check;
alter table public.inventory_transactions
 add constraint stock_in_receipt_balance_check check (
   reference_goods_receipt_line_id is null or (
    transaction_type='stock_in'::public.inventory_tx_type
    and quantity_delta=quantity and quantity_delta>0
    and stock_before>=0 and stock_after=stock_before+quantity
   )
 ) not valid;

-- Lock stock movement writes to SECURITY DEFINER RPCs (existing policy in
-- 20261015195000_inventory_adjustments_and_history.sql).
revoke all on public.suppliers,public.purchase_orders,public.purchase_order_lines,
 public.goods_receipts,public.goods_receipt_lines from public,anon,authenticated;
grant select on public.suppliers,public.purchase_orders,public.purchase_order_lines,
 public.goods_receipts,public.goods_receipt_lines to authenticated;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;

drop policy if exists "staff read suppliers" on public.suppliers;
create policy "staff read suppliers" on public.suppliers for select to authenticated
 using (exists(select 1 from public.staff_profiles s where s.user_id=auth.uid()
 and s.active=true and s.role in ('admin','inventory_staff')));
drop policy if exists "staff read purchase orders" on public.purchase_orders;
create policy "staff read purchase orders" on public.purchase_orders for select to authenticated
 using (exists(select 1 from public.staff_profiles s where s.user_id=auth.uid()
 and s.active=true and s.role in ('admin','inventory_staff')));
drop policy if exists "staff read purchase order lines" on public.purchase_order_lines;
create policy "staff read purchase order lines" on public.purchase_order_lines for select to authenticated
 using (exists(select 1 from public.staff_profiles s where s.user_id=auth.uid()
 and s.active=true and s.role in ('admin','inventory_staff')));
drop policy if exists "staff read goods receipts" on public.goods_receipts;
create policy "staff read goods receipts" on public.goods_receipts for select to authenticated
 using (exists(select 1 from public.staff_profiles s where s.user_id=auth.uid()
 and s.active=true and s.role in ('admin','inventory_staff')));
drop policy if exists "staff read goods receipt lines" on public.goods_receipt_lines;
create policy "staff read goods receipt lines" on public.goods_receipt_lines for select to authenticated
 using (exists(select 1 from public.staff_profiles s where s.user_id=auth.uid()
 and s.active=true and s.role in ('admin','inventory_staff')));

create or replace function public.create_supplier(
 p_name text, p_phone text default null, p_gstin text default null
) returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_actor is null or not exists(select 1 from public.staff_profiles s
  where s.user_id=v_actor and s.active=true and s.role='admin') then
  raise exception 'Supplier creation requires an active administrator' using errcode='42501';
 end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 120 then
  raise exception 'Supplier name must contain 2–120 characters' using errcode='22023';
 end if;
 if length(coalesce(p_phone,''))>30 or length(coalesce(p_gstin,''))>20 then
  raise exception 'Supplier contact information is too long' using errcode='22023';
 end if;
 insert into public.suppliers(supplier_name,phone,gstin,created_by)
 values (btrim(p_name),nullif(btrim(p_phone),''),nullif(upper(btrim(p_gstin)),''),
 v_actor) returning id into v_id;
 return v_id;
end $fn$;

create or replace function public.create_purchase_order(
 p_operation_id uuid,p_supplier_id uuid,p_items jsonb,p_notes text default null
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid(); v_hash text; v_prior record; v_row record;
 v_po_number text; v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
begin
 if v_actor is null or not exists(select 1 from public.staff_profiles s
  where s.user_id=v_actor and s.active=true and s.role in ('admin','inventory_staff')) then
  raise exception 'Purchase order access denied' using errcode='42501';
 end if;
 if p_operation_id is null or p_supplier_id is null or
    jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 or
    length(coalesce(v_notes,''))>240 then
  raise exception 'Invalid purchase order header or lines' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_items) x
  where jsonb_typeof(x.value)<>'object'
    or coalesce(x.value->>'variant_id','')=''
    or (x.value->>'quantity') !~ '^[0-9]{1,6}$'
    or (x.value->>'unit_cost') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
    or (x.value->>'quantity')::integer not between 1 and 100000
    or (x.value->>'unit_cost')::numeric>99999999.99)
 or (select count(*) from jsonb_array_elements(p_items)) <>
    (select count(distinct x.value->>'variant_id')
     from jsonb_array_elements(p_items) x) then
  raise exception 'Invalid or duplicated purchase order line' using errcode='22023';
 end if;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
 jsonb_build_object('supplier',p_supplier_id,'items',p_items,'notes',v_notes)::text,'UTF8')),'hex');
 -- Stable operation-level transaction lock makes concurrent retries serialize.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
 select po.id,po.created_by,po.request_hash,po.po_number
 into v_prior from public.purchase_orders po where po.id=p_operation_id;
 if found then
  if v_prior.created_by<>v_actor or v_prior.request_hash<>v_hash then
   raise exception 'Purchase operation ID reused with different details' using errcode='22023';
  end if;
  return jsonb_build_object('id',p_operation_id,'po_number',v_prior.po_number,'replayed',true);
 end if;
 perform 1 from public.suppliers s where s.id=p_supplier_id and s.active=true;
 if not found then raise exception 'Active supplier not found' using errcode='22023'; end if;
 -- The purchase order does not modify inventory; receiving does.
 insert into public.purchase_orders(id,supplier_id,notes,request_hash,created_by)
 values (p_operation_id,p_supplier_id,v_notes,v_hash,v_actor)
 returning po_number into v_po_number;
 for v_row in
  select x.value->>'variant_id' as variant,
   (x.value->>'quantity')::integer as qty,
   (x.value->>'unit_cost')::numeric(12,2) as cost
  from jsonb_array_elements(p_items) x
  order by x.value->>'variant_id'
 loop
  if not exists(select 1 from public.product_variants v
   join public.products p on p.id=v.product_id
   where v.id=v_row.variant::uuid and v.active=true and p.active=true) then
   raise exception 'PO contains inactive or missing product variant' using errcode='22023';
  end if;
  insert into public.purchase_order_lines(purchase_order_id,variant_id,quantity_ordered,unit_cost)
  values (p_operation_id,v_row.variant::uuid,v_row.qty,v_row.cost);
 end loop;
 return jsonb_build_object('id',p_operation_id,'po_number',v_po_number,'replayed',false);
end $fn$;

create or replace function public.receive_purchase_order(
 p_receipt_id uuid,p_purchase_order_id uuid,p_supplier_invoice text,p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid();v_order public.purchase_orders%rowtype;
 v_hash text;v_existing record;v_item record;v_before integer;v_new bigint;
 v_ordered integer;v_received integer;v_finished boolean;
 v_grn text;v_line_id uuid;
begin
 if v_actor is null or not exists(select 1 from public.staff_profiles s
  where s.user_id=v_actor and s.active=true and s.role in ('admin','inventory_staff')) then
  raise exception 'Goods receipt access denied' using errcode='42501';
 end if;
 if p_receipt_id is null or p_purchase_order_id is null or
  length(btrim(coalesce(p_supplier_invoice,''))) not between 3 and 80 or
  jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then
  raise exception 'Invalid goods receipt header or lines' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x.value)<>'object'
    or coalesce(x.value->>'variant_id','')=''
    or (x.value->>'quantity') !~ '^[0-9]{1,6}$'
    or (x.value->>'quantity')::integer not between 1 and 100000)
    or (select count(*) from jsonb_array_elements(p_items)) <>
       (select count(distinct x.value->>'variant_id') from jsonb_array_elements(p_items) x) then
  raise exception 'Invalid or duplicated receipt line' using errcode='22023';
 end if;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  jsonb_build_object('po',p_purchase_order_id,'invoice',btrim(p_supplier_invoice),
   'items',p_items)::text,'UTF8')),'hex');
 -- Lock order first, same lock order for every receipt and status update.
 select * into v_order from public.purchase_orders
 where id=p_purchase_order_id for update;
 if not found then raise exception 'Purchase order not found' using errcode='22023'; end if;
 select g.id,g.purchase_order_id,g.received_by,g.request_hash,g.grn_number
 into v_existing from public.goods_receipts g where g.id=p_receipt_id;
 if found then
  if v_existing.purchase_order_id<>p_purchase_order_id or
     v_existing.received_by<>v_actor or v_existing.request_hash<>v_hash then
   raise exception 'Receipt ID reused with different details' using errcode='22023';
  end if;
  return jsonb_build_object('id',p_receipt_id,'grn_number',v_existing.grn_number,
    'replayed',true,'status',v_order.status);
 end if;
 if exists(select 1 from public.goods_receipts where id=p_receipt_id) then
  raise exception 'Receipt ID conflicts with another purchase' using errcode='22023';
 end if;
 if v_order.status not in ('ordered','partially_received') then
  raise exception 'Purchase order no longer accepts receipts' using errcode='23514';
 end if;
 -- Customer- or cashier-submitted bill numbers cannot inject duplicate stock.
 if exists(select 1 from public.goods_receipts g where g.supplier_id=v_order.supplier_id
 and lower(btrim(g.supplier_invoice))=lower(btrim(p_supplier_invoice))) then
  raise exception 'Supplier invoice already received; review the earlier GRN' using errcode='23505';
 end if;
 insert into public.goods_receipts
 (id,purchase_order_id,supplier_id,supplier_invoice,request_hash,received_by)
 values (p_receipt_id,p_purchase_order_id,v_order.supplier_id,btrim(p_supplier_invoice),v_hash,v_actor)
 returning grn_number into v_grn;
 for v_item in
  select x.value->>'variant_id' as variant,(x.value->>'quantity')::integer as qty
  from jsonb_array_elements(p_items) x order by x.value->>'variant_id'
 loop
  select pol.quantity_ordered into v_ordered from public.purchase_order_lines pol
  where pol.purchase_order_id=p_purchase_order_id and pol.variant_id=v_item.variant::uuid;
  if not found then raise exception 'Item not included in original PO' using errcode='23514';end if;
  select coalesce(sum(grl.quantity_received),0)::integer into v_received
  from public.goods_receipt_lines grl
  join public.goods_receipts gr on gr.id=grl.goods_receipt_id
  where gr.purchase_order_id=p_purchase_order_id and grl.variant_id=v_item.variant::uuid;
  if v_item.qty>v_ordered-v_received then
   raise exception 'Receipt exceeds remaining PO quantity' using errcode='23514';
  end if;
  select pv.stock_quantity into v_before from public.product_variants pv
  where pv.id=v_item.variant::uuid and pv.active=true for update;
  if not found then raise exception 'Active variant missing from stock' using errcode='23514';end if;
  v_new:=v_before::bigint+v_item.qty::bigint;
  if v_new>1000000000 then raise exception 'Receipt exceeds maximum supported stock' using errcode='22003';end if;
  update public.product_variants
  set stock_quantity=v_new::integer,updated_at=now()
  where id=v_item.variant::uuid;
  insert into public.goods_receipt_lines
  (goods_receipt_id,variant_id,quantity_received,stock_before,stock_after)
  values(p_receipt_id,v_item.variant::uuid,v_item.qty,v_before,v_new::integer)
  returning id into v_line_id;
  insert into public.inventory_transactions(
   variant_id,transaction_type,quantity,quantity_delta,stock_before,stock_after,
   reference_goods_receipt_line_id,reason,created_by)
  values(v_item.variant::uuid,'stock_in',v_item.qty,v_item.qty,v_before,v_new::integer,
   v_line_id,'Goods receipt '||v_grn||' / supplier invoice '||btrim(p_supplier_invoice),v_actor);
 end loop;
 select not exists (
   select 1 from public.purchase_order_lines pol
   where pol.purchase_order_id=p_purchase_order_id
     and coalesce((select sum(grl.quantity_received)
       from public.goods_receipt_lines grl join public.goods_receipts gr
       on gr.id=grl.goods_receipt_id
       where gr.purchase_order_id=pol.purchase_order_id and grl.variant_id=pol.variant_id),0)
       < pol.quantity_ordered
 ) into v_finished;
 update public.purchase_orders set
 status=case when v_finished then 'received' else 'partially_received' end,
 updated_at=now() where id=p_purchase_order_id;
 return jsonb_build_object('id',p_receipt_id,'grn_number',v_grn,
  'replayed',false,'status',case when v_finished then 'received' else 'partially_received' end);
end $fn$;

revoke execute on function public.create_supplier(text,text,text) from public,anon,authenticated;
revoke execute on function public.create_purchase_order(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function public.receive_purchase_order(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_supplier(text,text,text) to authenticated;
grant execute on function public.create_purchase_order(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.receive_purchase_order(uuid,uuid,text,jsonb) to authenticated;
commit;
