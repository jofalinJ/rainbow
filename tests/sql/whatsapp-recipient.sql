\set ON_ERROR_STOP on
-- Disposable payment fixture only. This test never contacts Meta or real customers.
create table public.whatsapp_notifications (
  id uuid primary key,
  recipient_number text not null,
  notification_type text not null
);
\i supabase/migrations/20261111234500_normalize_whatsapp_recipient.sql
begin;
insert into public.whatsapp_notifications(id,recipient_number,notification_type)
values
 ('11111111-1111-4111-8111-111111111111','9876543210','payment_receipt'),
 ('22222222-2222-4222-8222-222222222222','+91 98765-43210','payment_receipt'),
 ('33333333-3333-4333-8333-333333333333','447911123456','payment_receipt');
do $$
begin
  if (select recipient_number from public.whatsapp_notifications
    where id='11111111-1111-4111-8111-111111111111') <> '919876543210'
    then raise exception 'Domestic ten-digit WhatsApp destination lacks country code'; end if;
  if (select recipient_number from public.whatsapp_notifications
    where id='22222222-2222-4222-8222-222222222222') <> '919876543210'
    then raise exception 'Already-prefixed Indian number not canonicalized'; end if;
  if (select recipient_number from public.whatsapp_notifications
    where id='33333333-3333-4333-8333-333333333333') <> '447911123456'
    then raise exception 'Non-Indian recipient should not change'; end if;
  update public.whatsapp_notifications set recipient_number='9123456780'
   where id='33333333-3333-4333-8333-333333333333';
  if (select recipient_number from public.whatsapp_notifications
    where id='33333333-3333-4333-8333-333333333333') <> '919123456780'
    then raise exception 'Updated domestic number not normalized'; end if;
end $$;
rollback;
