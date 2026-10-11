alter table public.customers
  add column if not exists auth_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_auth_user_id_fkey'
  ) then
    alter table public.customers
      add constraint customers_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_auth_user_id_key'
  ) then
    alter table public.customers
      add constraint customers_auth_user_id_key unique (auth_user_id);
  end if;
end
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.handle_storefront_customer_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_phone text := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'), '');
begin
  if coalesce(new.raw_user_meta_data ->> 'account_type', '') <> 'storefront_customer' then
    return new;
  end if;

  if v_name is null or length(v_name) > 120
     or new.email is null
     or v_phone is null or length(v_phone) < 10 or length(v_phone) > 13 then
    raise exception 'Storefront account requires a name, email, and valid phone number';
  end if;

  insert into public.customers (auth_user_id, name, whatsapp_number, email)
  values (new.id, v_name, v_phone, lower(btrim(new.email)))
  on conflict (auth_user_id) do update
    set name = excluded.name,
        whatsapp_number = excluded.whatsapp_number,
        email = excluded.email,
        updated_at = now();

  return new;
end;
$function$;

revoke all on function private.handle_storefront_customer_signup() from public, anon, authenticated;

create trigger on_storefront_customer_created
  after insert on auth.users
  for each row
  execute function private.handle_storefront_customer_signup();
