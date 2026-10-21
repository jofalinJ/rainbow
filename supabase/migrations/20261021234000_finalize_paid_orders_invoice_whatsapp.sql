-- TEST-payment post-settlement pipeline. Pending gateway reservations are NOT placed orders.
-- All effects below occur in the same Postgres transaction as verified payment_status='paid'.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

alter table public.razorpay_checkouts
  add column if not exists whatsapp_opt_in boolean not null default false;
alter table public.whatsapp_notifications
  add column if not exists send_started_at timestamptz,
  add column if not exists send_attempts integer not null default 0;
create sequence if not exists public.online_invoice_number_seq;
create unique index if not exists idx_paid_razorpay_inventory_ledger_once
 on public.inventory_transactions(reference_order_id,variant_id,transaction_type)
 where transaction_type='sale_online'::public.inventory_tx_type and reference_order_id is not null;
create unique index if not exists idx_whatsapp_paid_receipt_once
 on public.whatsapp_notifications(order_id,notification_type)
 where notification_type='payment_receipt';

create or replace function public.set_razorpay_whatsapp_opt_in(
 p_checkout_id uuid, p_opt_in boolean
) returns boolean language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized'; end if;
  update public.razorpay_checkouts set whatsapp_opt_in=coalesce(p_opt_in,false)
   where checkout_id=p_checkout_id and status in ('creating','ready');
  return found;
end $$;
revoke all on function public.set_razorpay_whatsapp_opt_in(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_razorpay_whatsapp_opt_in(uuid,boolean) to service_role;

create or replace function app_private.finalize_paid_razorpay(p_order_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_checkout public.razorpay_checkouts%rowtype;
        v_invoice public.invoices%rowtype;
begin
  select rc.* into v_checkout from public.razorpay_checkouts rc
   join public.orders o on o.id=rc.order_id
   where rc.order_id=p_order_id and rc.status='paid'
     and rc.gateway_payment_id is not null and o.payment_status='paid'
     and exists (select 1 from public.payments p where p.order_id=o.id
                and p.method='razorpay' and p.status='paid'
                and p.transaction_reference=rc.gateway_payment_id);
  if not found then return; end if;

  update public.orders set status='confirmed',updated_at=now()
   where id=p_order_id and status='pending';

  insert into public.invoices(order_id,invoice_number)
    values(p_order_id,'RGC-INV-'||to_char(now(),'YYYYMMDD')||'-'||
      lpad(nextval('public.online_invoice_number_seq')::text,6,'0'))
    on conflict (order_id) do nothing;
  select * into v_invoice from public.invoices where order_id=p_order_id;

  -- Stock was physically reserved at checkout initiation. A sale ledger entry
  -- is recorded only after verified capture; do not subtract stock twice.
  insert into public.inventory_transactions(
      variant_id,transaction_type,quantity,quantity_delta,reference_order_id,reason)
    select oi.variant_id,'sale_online'::public.inventory_tx_type,oi.quantity,
      -oi.quantity,oi.order_id,'Razorpay captured; stock reserved at checkout'
    from public.order_items oi where oi.order_id=p_order_id
    on conflict do nothing;

  -- Opt-in is explicit; no WhatsApp message is sent by this DB transaction.
  if v_checkout.whatsapp_opt_in then
    insert into public.whatsapp_notifications(
      order_id,recipient_number,notification_type,message_template,invoice_url,status)
    select p_order_id,c.whatsapp_number,'payment_receipt',
      'rainbow_paid_order_invoice',
      'https://rainbowgoldcovering.com/invoice.html?token='||v_invoice.public_token::text,
      'pending'::public.whatsapp_status
    from public.orders o join public.customers c on c.id=o.customer_id
    where o.id=p_order_id and c.whatsapp_number is not null
    on conflict do nothing;
  end if;
end $$;
revoke all on function app_private.finalize_paid_razorpay(uuid) from public,anon,authenticated;

-- Manual UPI is placed ONLY after an authenticated shop admin has verified
-- its transaction reference using verify_online_order_payment().
create or replace function app_private.finalize_paid_manual_upi(p_order_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_verified boolean;
begin
  select exists(
    select 1 from public.orders o join public.payments p on p.order_id=o.id
    where o.id=p_order_id and o.source='online' and o.payment_status='paid'
      and p.method='upi' and p.status='paid' and p.verified_by is not null
      and p.verified_at is not null
      and not exists(select 1 from public.razorpay_checkouts rc where rc.order_id=o.id)
  ) into v_verified;
  if not v_verified then return; end if;
  update public.orders set status='confirmed',updated_at=now()
    where id=p_order_id and status='pending';
  insert into public.invoices(order_id,invoice_number)
    values(p_order_id,'RGC-INV-'||to_char(now(),'YYYYMMDD')||'-'||
      lpad(nextval('public.online_invoice_number_seq')::text,6,'0'))
    on conflict (order_id) do nothing;
  insert into public.inventory_transactions(
    variant_id,transaction_type,quantity,quantity_delta,reference_order_id,reason)
  select oi.variant_id,'sale_online'::public.inventory_tx_type,
    oi.quantity,-oi.quantity,oi.order_id,'Shop verified manual UPI transfer'
    from public.order_items oi where oi.order_id=p_order_id
    on conflict do nothing;
end $;
revoke all on function app_private.finalize_paid_manual_upi(uuid) from public,anon,authenticated;

create or replace function app_private.on_verified_razorpay_order()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.source='online' and new.payment_status='paid'
    and old.payment_status is distinct from 'paid' then
    perform app_private.finalize_paid_razorpay(new.id);
    perform app_private.finalize_paid_manual_upi(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_finalize_verified_razorpay_order on public.orders;
create trigger trg_finalize_verified_razorpay_order
after update of payment_status on public.orders
for each row execute function app_private.on_verified_razorpay_order();

create or replace function app_private.prevent_unpaid_online_fulfillment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.source='online' and new.status in ('confirmed','processing','shipped','delivered')
    and new.payment_status <> 'paid' then
    raise exception 'An unpaid online checkout cannot be placed or fulfilled.';
  end if;
  return new;
end $$;
drop trigger if exists trg_prevent_unpaid_online_fulfillment on public.orders;
create trigger trg_prevent_unpaid_online_fulfillment
before insert or update of status,payment_status on public.orders
for each row execute function app_private.prevent_unpaid_online_fulfillment();

-- Private RPC: only a successful HMAC-verified Razorpay browser callback gets this token.
create or replace function public.get_paid_razorpay_receipt(
 p_checkout_id uuid,p_gateway_order_id text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized'; end if;
  select jsonb_build_object(
    'order_number',o.order_number,'invoice_number',i.invoice_number,
    'invoice_url','https://rainbowgoldcovering.com/invoice.html?token='||i.public_token::text
  ) into v_result
  from public.razorpay_checkouts rc
  join public.orders o on o.id=rc.order_id
  join public.invoices i on i.order_id=o.id
  where rc.checkout_id=p_checkout_id and rc.gateway_order_id=p_gateway_order_id
    and rc.status='paid' and o.payment_status='paid'
    and o.status in ('confirmed','processing','shipped','delivered');
  return v_result;
end $$;
revoke all on function public.get_paid_razorpay_receipt(uuid,text) from public,anon,authenticated;
grant execute on function public.get_paid_razorpay_receipt(uuid,text) to service_role;

-- Existing public token viewer limited invoices to local-store orders.
-- Extend only to fully paid, placed Razorpay online orders; never pending orders.
create or replace function public.get_public_invoice(p_token uuid)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'invoice_number',i.invoice_number,
    'order_number',o.order_number,
    'issued_at',i.issued_at,
    'customer_name',coalesce(c.name,'Walk-in Customer'),
    'customer_phone',c.whatsapp_number,
    'customer_email',c.email,
    'customer_address',c.address,
    'customer_city',c.city,
    'customer_state',c.state,
    'customer_pin_code',c.pin_code,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_code',oi.product_code,'product_name',oi.product_name,
        'product_type',oi.product_type,'variant_color',oi.variant_color,
        'variant_size',oi.variant_size,'length_cm',oi.length_cm,
        'thickness',oi.thickness,'gold_amount_g',oi.gold_amount_g,
        'quantity',oi.quantity,'unit_price',oi.unit_price,
        'discount_amount',oi.discount_amount,'line_total',oi.line_total
      ) order by oi.created_at,oi.id)
      from public.order_items oi where oi.order_id=o.id
    ),'[]'::jsonb),
    'subtotal',o.subtotal,'discount_amount',o.discount_amount,
    'cgst_amount',o.cgst_amount,'sgst_amount',o.sgst_amount,
    'delivery_fee',o.delivery_fee,'total_amount',o.total_amount,
    'payment_method',(
      select p.method::text from public.payments p
       where p.order_id=o.id and p.status='paid'
       order by p.paid_at desc nulls last,p.created_at desc limit 1
    )
  )
  from public.invoices i
  join public.orders o on o.id=i.order_id
  left join public.customers c on c.id=o.customer_id
  where i.public_token=p_token
    and o.status not in ('cancelled','refunded')
    and (o.source='local_store'
      or (o.source='online' and o.payment_status='paid'
        and o.status in ('confirmed','processing','shipped','delivered')
        and (exists(select 1 from public.razorpay_checkouts rc
          where rc.order_id=o.id and rc.status='paid')
          or exists(select 1 from public.payments p
             where p.order_id=o.id and p.method='upi' and p.status='paid'
               and p.verified_by is not null and p.verified_at is not null))));
$$;
revoke all on function public.get_public_invoice(uuid) from public;
grant execute on function public.get_public_invoice(uuid) to anon,authenticated,service_role;

-- WhatsApp outbox can be claimed only by the backend, only after payment.
create or replace function public.claim_paid_invoice_whatsapp(p_limit integer default 5,p_allowed_numbers text[] default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized'; end if;
  if p_limit not between 1 and 20 then raise exception 'Invalid batch size'; end if;
  with picked as (
    select n.id from public.whatsapp_notifications n
    join public.orders o on o.id=n.order_id
    join public.razorpay_checkouts rc on rc.order_id=o.id
    where n.notification_type='payment_receipt' and n.status='pending'
      and n.send_started_at is null
      and (p_allowed_numbers is null or regexp_replace(n.recipient_number,'[^0-9]','','g')=any(p_allowed_numbers))
      and o.payment_status='paid' and rc.status='paid' and rc.whatsapp_opt_in
    order by n.created_at limit p_limit for update of n skip locked
  ), claimed as (
    update public.whatsapp_notifications n set
      send_started_at=now(),send_attempts=send_attempts+1
    from picked where n.id=picked.id
    returning n.id,n.order_id,n.recipient_number,n.invoice_url
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'recipient',x.recipient_number,'invoice_url',x.invoice_url,
    'order_number',o.order_number,'customer_name',c.name
  )),'[]'::jsonb) into v_result
  from claimed x join public.orders o on o.id=x.order_id
  join public.customers c on c.id=o.customer_id;
  return v_result;
end $$;
revoke all on function public.claim_paid_invoice_whatsapp(integer,text[]) from public,anon,authenticated;
grant execute on function public.claim_paid_invoice_whatsapp(integer,text[]) to service_role;

create or replace function public.finish_paid_invoice_whatsapp(
 p_notification_id uuid,p_provider_id text,p_error text default null
) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Unauthorized'; end if;
  update public.whatsapp_notifications set
    status=(case when p_provider_id is not null then 'sent' else 'failed' end)::public.whatsapp_status,
    provider_message_id=p_provider_id,
    error_message=case when p_provider_id is null then left(coalesce(p_error,'Delivery not confirmed'),240) else null end,
    sent_at=case when p_provider_id is not null then now() else null end
  where id=p_notification_id and notification_type='payment_receipt'
    and status='pending' and send_started_at is not null;
  return found;
end $$;
revoke all on function public.finish_paid_invoice_whatsapp(uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_paid_invoice_whatsapp(uuid,text,text) to service_role;

-- Repair the one previously paid TEST checkout idempotently. No stock is deducted here.
do $$
declare r record;
begin
  for r in select rc.order_id from public.razorpay_checkouts rc
    join public.orders o on o.id=rc.order_id
    where rc.status='paid' and rc.gateway_payment_id is not null
       and o.payment_status='paid'
  loop
    perform app_private.finalize_paid_razorpay(r.order_id);
  end loop;
end $$;
