-- Normalise Indian checkout numbers for Meta WhatsApp invoice delivery.
-- Checkout permits ten-digit Indian numbers; the existing outbox and allowlist
-- compare E.164 digits, so a ten-digit number otherwise stays stuck pending.
-- Do not rewrite historic customers/orders or send any messages here.
begin;

create or replace function public.normalize_whatsapp_notification_recipient()
returns trigger language plpgsql
set search_path=pg_catalog,public as $$
declare
  v_digits text := regexp_replace(coalesce(new.recipient_number,''),'[^0-9]','','g');
begin
  if v_digits ~ '^[6-9][0-9]{9}$' then
    new.recipient_number := '91' || v_digits;
  elsif v_digits ~ '^91[6-9][0-9]{9}$' then
    new.recipient_number := v_digits;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_whatsapp_notification_recipient() from public,anon,authenticated;
drop trigger if exists normalize_whatsapp_notification_recipient_before_write
  on public.whatsapp_notifications;
create trigger normalize_whatsapp_notification_recipient_before_write
before insert or update of recipient_number on public.whatsapp_notifications
for each row execute function public.normalize_whatsapp_notification_recipient();

commit;
