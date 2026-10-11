-- Keep staff reference and attendance photos in a private Storage bucket.
alter table public.staff_profiles
  add column if not exists photo_path text;

alter table public.attendance
  add column if not exists photo_path text,
  add column if not exists photo_review_status text not null default 'Not submitted',
  add column if not exists photo_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists photo_reviewed_at timestamptz;

do $
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_photo_review_status_check'
  ) then
    alter table public.attendance
      add constraint attendance_photo_review_status_check
      check (photo_review_status in ('Not submitted', 'Pending', 'Approved', 'Rejected'));
  end if;
end
$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-private',
  'staff-private',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff private admin select" on storage.objects;
create policy "staff private admin select"
on storage.objects for select to authenticated
using (bucket_id = 'staff-private' and (select public.is_admin()));

drop policy if exists "staff private upload" on storage.objects;
create policy "staff private upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'staff-private'
  and (
    (select public.is_admin())
    or (
      (storage.foldername(name))[1] = 'attendance'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and exists (
        select 1
        from public.staff_profiles as sp
        where sp.user_id = (select auth.uid())
          and sp.active = true
          and sp.role in ('admin', 'cashier', 'inventory_staff')
      )
    )
  )
);

drop policy if exists "staff private admin update" on storage.objects;
create policy "staff private admin update"
on storage.objects for update to authenticated
using (bucket_id = 'staff-private' and (select public.is_admin()))
with check (bucket_id = 'staff-private' and (select public.is_admin()));

drop policy if exists "staff private admin delete" on storage.objects;
create policy "staff private admin delete"
on storage.objects for delete to authenticated
using (bucket_id = 'staff-private' and (select public.is_admin()));

drop policy if exists "staff read own attendance" on public.attendance;
create policy "staff read own attendance"
on public.attendance for select to authenticated
using (
  staff_id = (select auth.uid())
  and exists (
    select 1
    from public.staff_profiles as sp
    where sp.user_id = (select auth.uid())
      and sp.active = true
  )
);

create or replace function public.staff_attendance_action(
  p_action text,
  p_photo_path text default null
)
returns public.attendance
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_prefix text;
  v_record public.attendance%rowtype;
begin
  if v_staff_id is null then
    raise exception 'Please sign in to record attendance.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.user_id = v_staff_id
      and sp.active = true
      and sp.role in ('admin', 'cashier', 'inventory_staff')
  ) then
    raise exception 'An active staff account is required to record attendance.' using errcode = '42501';
  end if;

  if p_action = 'check_in' then
    v_prefix := 'attendance/' || v_staff_id::text || '/' || to_char(v_today, 'YYYY-MM-DD') || '/';
    if p_photo_path is null
       or left(p_photo_path, length(v_prefix)) <> v_prefix
       or length(p_photo_path) > length(v_prefix) + 100 then
      raise exception 'Take and upload today’s attendance photo before checking in.';
    end if;

    select * into v_record
    from public.attendance
    where staff_id = v_staff_id and date = v_today
    for update;

    if found and v_record.check_in is not null then
      raise exception 'You have already checked in today.';
    end if;

    if found then
      update public.attendance
      set check_in = (now() at time zone 'Asia/Kolkata')::time,
          status = 'Present',
          photo_path = p_photo_path,
          photo_review_status = 'Pending',
          photo_reviewed_by = null,
          photo_reviewed_at = null
      where id = v_record.id
      returning * into v_record;
    else
      insert into public.attendance (
        staff_id, date, check_in, status, photo_path, photo_review_status
      ) values (
        v_staff_id,
        v_today,
        (now() at time zone 'Asia/Kolkata')::time,
        'Present',
        p_photo_path,
        'Pending'
      )
      returning * into v_record;
    end if;
    return v_record;
  elsif p_action = 'check_out' then
    update public.attendance
    set check_out = (now() at time zone 'Asia/Kolkata')::time
    where staff_id = v_staff_id
      and date = v_today
      and check_in is not null
      and check_out is null
    returning * into v_record;

    if not found then
      raise exception 'Check in before checking out, or you have already checked out.';
    end if;
    return v_record;
  else
    raise exception 'Unsupported attendance action.';
  end if;
end;
$$;

revoke all on function public.staff_attendance_action(text, text) from public;
revoke all on function public.staff_attendance_action(text, text) from anon;
grant execute on function public.staff_attendance_action(text, text) to authenticated;

create unique index if not exists whatsapp_new_order_alert_once_idx
on public.whatsapp_notifications (order_id)
where notification_type = 'new_order_alert'
  and status in ('pending', 'sent');
