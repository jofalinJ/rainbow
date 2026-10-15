-- Simplify staff attendance: no biometric test, photo upload or consent required.
-- Preserve existing attendance rows, historical photos and the server-side role/date checks.
-- The function signature is retained for compatibility with existing RPC permissions.
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
    -- Outdated clients must refresh, rather than uploading unnecessary face photos.
    if p_photo_path is not null then
      raise exception 'Photo check-in is no longer supported. Refresh the attendance page.';
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
          photo_path = null,
          photo_review_status = 'Not submitted',
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
        null,
        'Not submitted'
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

revoke all on function public.staff_attendance_action(text, text) from public, anon;
grant execute on function public.staff_attendance_action(text, text) to authenticated;

-- The cancelled face pilot no longer needs private enrolled reference photo read access.
drop policy if exists "staff read own enrolled reference photo" on storage.objects;

-- Prevent uploading new staff attendance photos. Admins retain profile-photo management
-- permission and can still read/review previously stored photos.
drop policy if exists "staff private upload" on storage.objects;
create policy "staff private upload"
on storage.objects for insert to authenticated
with check (bucket_id = 'staff-private' and (select public.is_admin()));
