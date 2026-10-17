-- Authoritative attendance is committed only after a server-verified, one-use
-- liveness session. Historical time-only records and photo reviews are retained.
alter table public.attendance
  add column check_in_at timestamptz,
  add column check_out_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add column verification_method text not null default 'legacy'
    check (verification_method in ('legacy', 'manual', 'face_liveness')),
  add column verification_result text not null default 'legacy'
    check (verification_result in ('legacy', 'manual', 'verified'));

update public.attendance
set check_in_at = (date + check_in) at time zone 'Asia/Kolkata',
    check_out_at = (date + check_out + case
      when check_out < check_in then interval '1 day' else interval '0 days' end)
      at time zone 'Asia/Kolkata';

alter table public.attendance
  add column working_seconds bigint generated always as (
    case when check_in_at is not null and check_out_at >= check_in_at
      then floor(extract(epoch from (check_out_at - check_in_at)))::bigint end
  ) stored,
  add constraint attendance_verified_timestamps_check check (
    verification_method = 'legacy' or (
      (check_out_at is null or (check_in_at is not null
        and check_out_at >= check_in_at and check_out_at <= check_in_at + interval '24 hours'))
      and (check_in_at is null or (check_in_at at time zone 'Asia/Kolkata')::date = date)
      and check_in is not distinct from (check_in_at at time zone 'Asia/Kolkata')::time
      and check_out is not distinct from (check_out_at at time zone 'Asia/Kolkata')::time
    )
  ),
  add constraint attendance_verification_consistency_check check (
    (verification_method = 'legacy' and verification_result = 'legacy')
    or (verification_method = 'manual' and verification_result = 'manual')
    or (verification_method = 'face_liveness' and verification_result = 'verified')
  );

alter table public.attendance alter column date set default ((now() at time zone 'Asia/Kolkata')::date);
create index attendance_open_shift_idx on public.attendance (staff_id, check_in_at)
  where check_in_at is not null and check_out_at is null;

-- Remove every old write policy, including permissive administrator policies.
do $$ declare p record; begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'attendance'
  loop execute format('drop policy %I on public.attendance', p.policyname); end loop;
end $$;
revoke all on public.attendance from public, anon, authenticated;
grant select on public.attendance to authenticated;
grant all on public.attendance to service_role;
create policy attendance_admin_read on public.attendance for select to authenticated
  using ((select public.is_admin()));
create policy attendance_staff_read on public.attendance for select to authenticated
  using (staff_id = (select auth.uid()) and exists (
    select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
      and sp.active and sp.role in ('cashier', 'inventory_staff')
  ));

create or replace function public.staff_attendance_action(p_action text, p_photo_path text default null)
returns public.attendance language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Attendance now requires a live face verification. Refresh My attendance, or ask an administrator for a recorded manual correction.'
    using errcode = '42501';
end $$;
revoke all on function public.staff_attendance_action(text,text) from public, anon;
grant execute on function public.staff_attendance_action(text,text) to authenticated;

-- The cancelled preview's browser photo-download permission is no longer needed.
drop policy if exists "Consenting staff read own reference for face preview" on storage.objects;

create table public.biometric_enrollments (
  staff_id uuid primary key references public.staff_profiles(user_id) on delete restrict,
  -- AES-GCM sealed provider collection identifier; never a face image or embedding.
  collection_ref text not null check (length(collection_ref) between 20 and 2048),
  generation uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'indexing', 'active', 'deleting')),
  sample_count integer not null default 0 check (sample_count between 0 and 3),
  consent_version text not null check (consent_version in ('2026-10-15-v1','2026-10-17-self-hosted-v1')),
  consent_at timestamptz not null default now(),
  enrolled_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  updated_at timestamptz not null default now(),
  constraint biometric_enrollment_state_check check (
    (status = 'active' and sample_count = 3)
    or (status in ('pending', 'indexing') and sample_count < 3) or status = 'deleting'
  )
);
create index biometric_enrollments_enrolled_by_idx on public.biometric_enrollments (enrolled_by);
create index biometric_enrollments_expiry_idx on public.biometric_enrollments (expires_at);

create table public.biometric_sessions (
  id uuid primary key default gen_random_uuid(),
  provider_session_id text not null unique check (length(provider_session_id) between 1 and 200),
  actor_id uuid not null references auth.users(id) on delete cascade,
  staff_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  purpose text not null check (purpose in ('enrollment', 'check_in', 'check_out')),
  enrollment_generation uuid not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'verified', 'failed')),
  expires_at timestamptz not null default (now() + interval '3 minutes'),
  created_at timestamptz not null default now()
);
create index biometric_sessions_actor_created_idx on public.biometric_sessions (actor_id, created_at desc);
create index biometric_sessions_staff_idx on public.biometric_sessions (staff_id);

create table public.biometric_audit_events (
  id bigint generated always as identity primary key,
  -- IDs intentionally have no cascading FK: the audit survives account deletion.
  actor_id uuid,
  staff_id uuid,
  attendance_id uuid,
  event text not null,
  reason text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index biometric_audit_events_created_idx on public.biometric_audit_events (created_at desc);
create index biometric_audit_events_staff_idx on public.biometric_audit_events (staff_id, created_at desc);
alter table public.biometric_enrollments enable row level security;
alter table public.biometric_sessions enable row level security;
alter table public.biometric_audit_events enable row level security;
revoke all on public.biometric_enrollments, public.biometric_sessions, public.biometric_audit_events
  from public, anon, authenticated;
grant all on public.biometric_enrollments, public.biometric_sessions, public.biometric_audit_events to service_role;
grant usage, select on sequence public.biometric_audit_events_id_seq to service_role;
grant select on public.biometric_audit_events to authenticated;
create policy biometric_audit_admin_read on public.biometric_audit_events for select to authenticated
  using ((select public.is_admin()));
-- Service role is the only table actor; explicit policies also work in an isolated
-- deployment that does not give that role BYPASSRLS.
create policy biometric_enrollments_service on public.biometric_enrollments for all to service_role using (true) with check (true);
create policy biometric_sessions_service on public.biometric_sessions for all to service_role using (true) with check (true);
create policy biometric_audit_service on public.biometric_audit_events for all to service_role using (true) with check (true);

create function public.biometric_prepare_enrollment(
  p_actor uuid, p_staff uuid, p_collection_ref text, p_consent_version text
) returns public.biometric_enrollments
language plpgsql security invoker set search_path = '' as $$
declare v_record public.biometric_enrollments%rowtype;
begin
  if not exists (select 1 from public.staff_profiles where user_id = p_actor and active and role = 'admin') then
    raise exception 'An active administrator is required.' using errcode = '42501';
  end if;
  perform 1 from public.staff_profiles where user_id = p_staff and active and role in ('cashier', 'inventory_staff') for update;
  if not found then raise exception 'Choose an active cashier or inventory staff member.' using errcode = '42501'; end if;
  if p_consent_version is null or p_consent_version not in ('2026-10-15-v1','2026-10-17-self-hosted-v1') then
    raise exception 'The current staff consent is required.' using errcode = '22023';
  end if;
  if exists (select 1 from public.biometric_enrollments where staff_id = p_staff) then
    raise exception 'Delete the existing biometric enrollment before enrolling again.' using errcode = '23505';
  end if;
  insert into public.biometric_enrollments(staff_id, collection_ref, consent_version, enrolled_by)
  values (p_staff, p_collection_ref, p_consent_version, p_actor) returning * into v_record;
  insert into public.biometric_audit_events(actor_id, staff_id, event, details)
  values (p_actor, p_staff, 'enrollment_started', jsonb_build_object('consent_version', p_consent_version));
  return v_record;
end $$;

create function public.biometric_open_session(
  p_actor uuid, p_staff uuid, p_purpose text, p_provider_session_id text
) returns public.biometric_sessions
language plpgsql security invoker set search_path = '' as $$
declare v_enrollment public.biometric_enrollments%rowtype;
  v_session public.biometric_sessions%rowtype; v_now timestamptz;
begin
  if p_purpose is null or p_purpose not in ('enrollment', 'check_in', 'check_out') then
    raise exception 'Unsupported verification purpose.' using errcode = '22023';
  end if;
  -- Serialize rate-limit checks even when there is no session row to lock yet.
  perform pg_advisory_xact_lock(hashtextextended('biometric:actor:' || p_actor::text, 0));
  perform 1 from public.staff_profiles where user_id = p_staff and active and role in ('cashier', 'inventory_staff') for update;
  if not found then raise exception 'Active non-admin staff is required.' using errcode = '42501'; end if;
  if p_purpose = 'enrollment' then
    if not exists (select 1 from public.staff_profiles where user_id = p_actor and active and role = 'admin') then
      raise exception 'An active administrator is required.' using errcode = '42501';
    end if;
  elsif p_actor is distinct from p_staff then
    raise exception 'Staff can record only their own attendance.' using errcode = '42501';
  end if;
  select * into v_enrollment from public.biometric_enrollments where staff_id = p_staff for update;
  v_now := clock_timestamp();
  if not found or v_enrollment.expires_at <= v_now or v_enrollment.status = 'deleting'
    or (p_purpose = 'enrollment' and (v_enrollment.status <> 'pending' or v_enrollment.sample_count >= 3))
    or (p_purpose <> 'enrollment' and (v_enrollment.status <> 'active' or v_enrollment.sample_count <> 3)) then
    raise exception 'A current biometric enrollment is required.' using errcode = '42501';
  end if;
  if (select count(*) from public.biometric_sessions where actor_id = p_actor and created_at > v_now - interval '1 minute') >= 5 then
    raise exception 'Too many verification attempts. Wait one minute and try again.' using errcode = '54000';
  end if;
  if exists (select 1 from public.biometric_sessions where (actor_id = p_actor or staff_id = p_staff)
    and status in ('pending', 'processing') and expires_at > v_now) then
    raise exception 'Finish or cancel the current verification first.' using errcode = '55000';
  end if;
  insert into public.biometric_sessions(provider_session_id, actor_id, staff_id, purpose, enrollment_generation, expires_at, created_at)
  values (p_provider_session_id, p_actor, p_staff, p_purpose, v_enrollment.generation, v_now + interval '3 minutes', v_now)
  returning * into v_session;
  return v_session;
end $$;

create function public.biometric_claim_session(p_actor uuid, p_session uuid)
returns public.biometric_sessions language plpgsql security invoker set search_path = '' as $$
declare v_session public.biometric_sessions%rowtype; v_enrollment public.biometric_enrollments%rowtype;
begin
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor;
  if not found then raise exception 'Verification session not found.' using errcode = '42501'; end if;
  perform 1 from public.staff_profiles where user_id = v_session.staff_id and active and role in ('cashier', 'inventory_staff') for update;
  if not found then raise exception 'Active non-admin staff is required.' using errcode = '42501'; end if;
  select * into v_enrollment from public.biometric_enrollments where staff_id = v_session.staff_id for update;
  if not found then raise exception 'Biometric enrollment not found.' using errcode = '42501'; end if;
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor for update;
  if v_session.status <> 'pending' or v_session.expires_at <= clock_timestamp() then
    raise exception 'Verification expired or was already used. Start again.' using errcode = '55000';
  end if;
  if v_enrollment.generation <> v_session.enrollment_generation or v_enrollment.expires_at <= clock_timestamp()
    or v_enrollment.status = 'deleting' then
    raise exception 'Biometric enrollment changed or expired. Start again.' using errcode = '42501';
  end if;
  if v_session.purpose = 'enrollment' then
    if v_enrollment.status <> 'pending' or v_enrollment.sample_count >= 3
      or not exists (select 1 from public.staff_profiles where user_id = p_actor and active and role = 'admin') then
      raise exception 'An active administrator and pending enrollment are required.' using errcode = '42501';
    end if;
  elsif p_actor is distinct from v_session.staff_id or v_enrollment.status <> 'active' or v_enrollment.sample_count <> 3 then
    raise exception 'Only the enrolled staff member can verify attendance.' using errcode = '42501';
  end if;
  update public.biometric_sessions set status = 'processing' where id = p_session returning * into v_session;
  return v_session;
end $$;

-- Freeze the enrollment before any non-transactional provider index write.
-- Cancellation, expiry, or a crashed request deliberately leaves it frozen:
-- the provider may have accepted the sample, so an admin must delete/reset it.
create function public.biometric_begin_index(p_actor uuid, p_session uuid)
returns public.biometric_enrollments language plpgsql security invoker set search_path = '' as $$
declare v_session public.biometric_sessions%rowtype; v_enrollment public.biometric_enrollments%rowtype; v_now timestamptz;
begin
  if not exists (select 1 from public.staff_profiles where user_id = p_actor and active and role = 'admin') then
    raise exception 'An active administrator is required.' using errcode = '42501';
  end if;
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor;
  if not found then raise exception 'Verification session not found.' using errcode = '42501'; end if;
  perform 1 from public.staff_profiles where user_id = v_session.staff_id and active and role in ('cashier', 'inventory_staff') for update;
  if not found then raise exception 'Active non-admin staff is required.' using errcode = '42501'; end if;
  select * into v_enrollment from public.biometric_enrollments where staff_id = v_session.staff_id for update;
  if not found then raise exception 'Biometric enrollment not found.' using errcode = '42501'; end if;
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor for update;
  v_now := clock_timestamp();
  if not found or v_session.status <> 'processing' or v_session.purpose <> 'enrollment' or v_session.expires_at <= v_now
    or v_enrollment.generation <> v_session.enrollment_generation or v_enrollment.expires_at <= v_now
    or v_enrollment.status <> 'pending' or v_enrollment.sample_count >= 3 then
    raise exception 'Enrollment verification expired, changed, or was already used.' using errcode = '55000';
  end if;
  update public.biometric_enrollments set status = 'indexing', updated_at = v_now
  where staff_id = v_session.staff_id returning * into v_enrollment;
  return v_enrollment;
end $$;

create function public.biometric_finish_sample(p_actor uuid, p_session uuid)
returns public.biometric_enrollments language plpgsql security invoker set search_path = '' as $$
declare v_session public.biometric_sessions%rowtype; v_enrollment public.biometric_enrollments%rowtype; v_now timestamptz;
begin
  if not exists (select 1 from public.staff_profiles where user_id = p_actor and active and role = 'admin') then
    raise exception 'An active administrator is required.' using errcode = '42501';
  end if;
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor;
  if not found then raise exception 'Verification session not found.' using errcode = '42501'; end if;
  perform 1 from public.staff_profiles where user_id = v_session.staff_id and active and role in ('cashier', 'inventory_staff') for update;
  if not found then raise exception 'Active non-admin staff is required.' using errcode = '42501'; end if;
  select * into v_enrollment from public.biometric_enrollments where staff_id = v_session.staff_id for update;
  if not found then raise exception 'Biometric enrollment not found.' using errcode = '42501'; end if;
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor for update;
  v_now := clock_timestamp();
  if not found or v_session.status <> 'processing' or v_session.purpose <> 'enrollment' or v_session.expires_at <= v_now
    or v_enrollment.generation <> v_session.enrollment_generation or v_enrollment.expires_at <= v_now
    or v_enrollment.status <> 'indexing' or v_enrollment.sample_count >= 3 then
    raise exception 'Enrollment verification expired, changed, or was already used.' using errcode = '55000';
  end if;
  update public.biometric_enrollments set sample_count = sample_count + 1,
    status = case when sample_count + 1 = 3 then 'active' else 'pending' end,
    expires_at = case when sample_count + 1 = 3 then v_now + interval '90 days' else expires_at end,
    updated_at = v_now
  where staff_id = v_session.staff_id returning * into v_enrollment;
  update public.biometric_sessions set status = 'verified' where id = p_session;
  insert into public.biometric_audit_events(actor_id, staff_id, event, details)
  values (p_actor, v_session.staff_id, case when v_enrollment.status = 'active' then 'enrollment_completed' else 'enrollment_sample_verified' end,
    jsonb_build_object('sample_count', v_enrollment.sample_count));
  return v_enrollment;
end $$;

create function public.biometric_finish_attendance(p_actor uuid, p_session uuid)
returns public.attendance language plpgsql security invoker set search_path = '' as $$
declare v_session public.biometric_sessions%rowtype; v_enrollment public.biometric_enrollments%rowtype;
  v_record public.attendance%rowtype; v_now timestamptz; v_today date; v_count integer;
begin
  -- A staff row always exists, including before the first attendance row. Its
  -- lock prevents concurrent check-in absent-row races and overlapping shifts.
  perform 1 from public.staff_profiles where user_id = p_actor and active and role in ('cashier', 'inventory_staff') for update;
  if not found then raise exception 'Active non-admin staff is required.' using errcode = '42501'; end if;
  select * into v_enrollment from public.biometric_enrollments where staff_id = p_actor for update;
  if not found then raise exception 'Biometric enrollment not found.' using errcode = '42501'; end if;
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor and staff_id = p_actor for update;
  if not found then raise exception 'Verification session not found.' using errcode = '42501'; end if;
  v_now := clock_timestamp(); v_today := (v_now at time zone 'Asia/Kolkata')::date;
  if v_session.status <> 'processing' or v_session.purpose not in ('check_in', 'check_out')
    or v_session.expires_at <= v_now or v_enrollment.generation <> v_session.enrollment_generation
    or v_enrollment.status <> 'active' or v_enrollment.sample_count <> 3 or v_enrollment.expires_at <= v_now then
    raise exception 'Attendance verification expired, changed, or was already used.' using errcode = '55000';
  end if;
  if v_session.purpose = 'check_in' then
    if exists (select 1 from public.attendance where staff_id = p_actor and check_in_at is not null and check_out_at is null) then
      raise exception 'An open shift already exists. Check out or ask an administrator to correct it.' using errcode = '55000';
    end if;
    select * into v_record from public.attendance where staff_id = p_actor and date = v_today for update;
    if found and v_record.check_in_at is not null then raise exception 'You have already checked in today.' using errcode = '23505'; end if;
    insert into public.attendance(staff_id, date, check_in, check_in_at, status, verification_method, verification_result, updated_at)
    values (p_actor, v_today, (v_now at time zone 'Asia/Kolkata')::time, v_now, 'Present', 'face_liveness', 'verified', v_now)
    on conflict (staff_id, date) do update set
      check_in = excluded.check_in, check_in_at = excluded.check_in_at, status = 'Present',
      verification_method = 'face_liveness', verification_result = 'verified', updated_at = v_now
    returning * into v_record;
  else
    select count(*) into v_count from public.attendance where staff_id = p_actor and check_in_at is not null and check_out_at is null;
    if v_count <> 1 then raise exception 'A single open shift is required. Ask an administrator to correct attendance.' using errcode = '55000'; end if;
    select * into v_record from public.attendance where staff_id = p_actor and check_in_at is not null and check_out_at is null for update;
    if v_record.date not in (v_today, v_today - 1) or v_record.check_in_at > v_now
      or v_now - v_record.check_in_at > interval '24 hours'
      or (v_record.date <> v_today and exists (select 1 from public.attendance where staff_id = p_actor and date = v_today and check_in_at is not null)) then
      raise exception 'The open shift is too old or conflicts with today. Ask an administrator to correct it.' using errcode = '55000';
    end if;
    update public.attendance set check_out_at = v_now, check_out = (v_now at time zone 'Asia/Kolkata')::time,
      verification_method = 'face_liveness', verification_result = 'verified', updated_at = v_now
    where id = v_record.id returning * into v_record;
  end if;
  update public.biometric_sessions set status = 'verified' where id = p_session;
  insert into public.biometric_audit_events(actor_id, staff_id, attendance_id, event, details)
  values (p_actor, p_actor, v_record.id, 'attendance_' || v_session.purpose,
    jsonb_build_object('date', v_record.date, 'verification_method', 'face_liveness'));
  return v_record;
end $$;

create function public.biometric_fail_session(p_actor uuid, p_session uuid, p_reason text)
returns public.biometric_sessions language plpgsql security invoker set search_path = '' as $$
declare v_session public.biometric_sessions%rowtype; v_reason text;
begin
  select * into v_session from public.biometric_sessions where id = p_session and actor_id = p_actor for update;
  if not found then raise exception 'Verification session not found.' using errcode = '42501'; end if;
  if v_session.status = 'verified' then
    raise exception 'This verification already completed. Refresh attendance to see its result.' using errcode = '55000';
  end if;
  if v_session.status = 'failed' then return v_session; end if;
  -- Never write provider responses or image data into audit metadata.
  v_reason := case when lower(p_reason) in ('liveness_failed', 'face_mismatch', 'face_not_matched',
    'no_face', 'multiple_faces', 'poor_quality', 'provider_error', 'expired', 'cancelled',
    'enrollment_changed', 'internal_error', 'provider_start_failed') then lower(p_reason) else 'verification_failed' end;
  update public.biometric_sessions set status = 'failed' where id = p_session returning * into v_session;
  insert into public.biometric_audit_events(actor_id, staff_id, event, reason, details)
  values (p_actor, v_session.staff_id, 'verification_failed', v_reason, jsonb_build_object('purpose', v_session.purpose));
  return v_session;
end $$;

-- Mark deletion before calling the external provider. If that call fails, the
-- retention worker can retry immediately rather than waiting for retention.
create function public.biometric_request_deletion(p_actor uuid, p_staff uuid, p_generation uuid, p_reason text)
returns public.biometric_enrollments language plpgsql security invoker set search_path = '' as $$
declare v_enrollment public.biometric_enrollments%rowtype; v_now timestamptz;
begin
  if not exists (select 1 from public.staff_profiles where user_id = p_actor and active and role = 'admin') then
    raise exception 'An active administrator is required.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(p_reason) > 500 then
    raise exception 'Enter a deletion reason between 5 and 500 characters.' using errcode = '22023';
  end if;
  perform 1 from public.staff_profiles where user_id = p_staff for update;
  select * into v_enrollment from public.biometric_enrollments where staff_id = p_staff for update;
  if not found then raise exception 'Biometric enrollment not found.' using errcode = '42501'; end if;
  if v_enrollment.generation is distinct from p_generation then
    raise exception 'Biometric enrollment changed. Refresh before deleting it.' using errcode = '55000';
  end if;
  if v_enrollment.status = 'deleting' and v_enrollment.expires_at <= clock_timestamp() then return v_enrollment; end if;
  v_now := clock_timestamp();
  update public.biometric_enrollments set status = 'deleting', expires_at = v_now, updated_at = v_now
  where staff_id = p_staff returning * into v_enrollment;
  insert into public.biometric_audit_events(actor_id, staff_id, event, reason)
  values (p_actor, p_staff, 'enrollment_deletion_requested', btrim(p_reason));
  return v_enrollment;
end $$;

create function public.biometric_remove_enrollment(p_actor uuid, p_staff uuid, p_generation uuid, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_enrollment public.biometric_enrollments%rowtype;
begin
  if not exists (select 1 from public.staff_profiles where user_id = p_actor and active and role = 'admin') then
    raise exception 'An active administrator is required.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(p_reason) > 500 then
    raise exception 'Enter a deletion reason between 5 and 500 characters.' using errcode = '22023';
  end if;
  perform 1 from public.staff_profiles where user_id = p_staff for update;
  select * into v_enrollment from public.biometric_enrollments where staff_id = p_staff for update;
  if not found then return; end if;
  if v_enrollment.status <> 'deleting' or v_enrollment.generation is distinct from p_generation then
    raise exception 'Delete the provider template before removing its enrollment record.' using errcode = '55000';
  end if;
  update public.biometric_sessions set status = 'failed' where staff_id = p_staff and status in ('pending', 'processing');
  delete from public.biometric_enrollments where staff_id = p_staff;
  insert into public.biometric_audit_events(actor_id, staff_id, event, reason) values (p_actor, p_staff, 'enrollment_deleted', btrim(p_reason));
end $$;

create function public.biometric_purge_enrollment(p_staff uuid, p_generation uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_enrollment public.biometric_enrollments%rowtype;
begin
  perform 1 from public.staff_profiles where user_id = p_staff for update;
  select * into v_enrollment from public.biometric_enrollments where staff_id = p_staff for update;
  if not found then return; end if;
  if v_enrollment.status <> 'deleting' or v_enrollment.generation is distinct from p_generation
    or v_enrollment.expires_at > clock_timestamp() then
    raise exception 'Only the matching, expired provider-deleted enrollment can be purged.' using errcode = '55000';
  end if;
  update public.biometric_sessions set status = 'failed' where staff_id = p_staff and status in ('pending', 'processing');
  delete from public.biometric_enrollments where staff_id = p_staff;
  insert into public.biometric_audit_events(staff_id, event, reason)
  values (p_staff, 'enrollment_purged', 'Retention or requested deletion cleanup');
end $$;

-- Browser API -> invoker wrapper -> deliberately narrow private definer.
-- The private schema must not be added to the API's exposed schemas.
create schema if not exists biometric_private;
revoke all on schema biometric_private from public, anon;
grant usage on schema biometric_private to authenticated;
create function biometric_private.admin_correct_attendance(
  p_staff_id uuid, p_date date, p_action text, p_reason text,
  p_status text default null, p_check_in_at timestamptz default null,
  p_check_out_at timestamptz default null, p_notes text default null,
  p_photo_review_status text default null
) returns public.attendance language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_record public.attendance%rowtype; v_before jsonb;
  v_now timestamptz; v_today date; v_exists boolean;
begin
  if v_actor is null or not exists (select 1 from public.staff_profiles where user_id = v_actor and active and role = 'admin') then
    raise exception 'An active administrator is required.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(p_reason) > 500 then
    raise exception 'Enter a correction reason between 5 and 500 characters.' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('check_in', 'check_out', 'status', 'correct', 'review_photo') or p_date is null then
    raise exception 'A valid date and correction action are required.' using errcode = '22023';
  end if;
  perform 1 from public.staff_profiles where user_id = p_staff_id and role in ('cashier', 'inventory_staff') for update;
  if not found then raise exception 'Choose a non-admin staff member.' using errcode = '42501'; end if;
  v_now := clock_timestamp(); v_today := (v_now at time zone 'Asia/Kolkata')::date;
  if p_date > v_today then raise exception 'Attendance cannot be recorded for a future date.' using errcode = '22023'; end if;
  if p_action in ('check_in', 'check_out') and not exists (select 1 from public.staff_profiles where user_id = p_staff_id and active) then
    raise exception 'An active staff member is required for a manual punch.' using errcode = '42501';
  end if;
  select * into v_record from public.attendance where staff_id = p_staff_id and date = p_date for update;
  v_exists := found;
  v_before := jsonb_build_object('status', v_record.status, 'check_in_at', v_record.check_in_at,
    'check_out_at', v_record.check_out_at, 'verification_method', v_record.verification_method,
    'photo_review_status', v_record.photo_review_status);
  if p_action = 'review_photo' then
    if not v_exists or v_record.photo_path is null or p_photo_review_status is null or p_photo_review_status not in ('Approved', 'Rejected') then
      raise exception 'Choose an existing attendance photo and review decision.' using errcode = '22023';
    end if;
    update public.attendance set photo_review_status = p_photo_review_status,
      photo_reviewed_by = v_actor, photo_reviewed_at = v_now, updated_at = v_now
    where id = v_record.id returning * into v_record;
  else
    if not v_exists then
      insert into public.attendance(staff_id, date, status, verification_method, verification_result)
      values (p_staff_id, p_date, 'Absent', 'manual', 'manual') returning * into v_record;
    end if;
    if p_action = 'check_in' then
      if p_date <> v_today or v_record.check_in_at is not null then
        raise exception 'Manual check-in is available once for today only.' using errcode = '55000';
      end if;
      if exists (select 1 from public.attendance where staff_id = p_staff_id and id <> v_record.id
        and check_in_at is not null and check_out_at is null) then
        raise exception 'Correct the existing open shift before checking in.' using errcode = '55000';
      end if;
      v_record.check_in_at := v_now; v_record.status := 'Present';
    elsif p_action = 'check_out' then
      if v_record.check_in_at is null or v_record.check_out_at is not null or v_record.check_in_at > v_now
        or v_now - v_record.check_in_at > interval '24 hours' or p_date not in (v_today, v_today - 1)
        or exists (select 1 from public.attendance where staff_id = p_staff_id and id <> v_record.id
          and check_in_at is not null and (check_out_at is null or date = v_today)) then
        raise exception 'A current, unambiguous open shift is required for manual check-out.' using errcode = '55000';
      end if;
      v_record.check_out_at := v_now;
    elsif p_action = 'status' then
      if p_status is null or p_status not in ('Present', 'Absent', 'Half Day', 'On Leave') then
        raise exception 'Choose a valid attendance status.' using errcode = '22023';
      end if;
      v_record.status := p_status;
    elsif p_action = 'correct' then
      if p_check_in_at > v_now or p_check_out_at > v_now
        or (p_check_in_at is not null and (p_check_in_at at time zone 'Asia/Kolkata')::date <> p_date)
        or (p_check_out_at is not null and (p_check_in_at is null or p_check_out_at < p_check_in_at
          or p_check_out_at > p_check_in_at + interval '24 hours')) then
        raise exception 'Correction times must match the IST attendance date and form a shift of at most 24 hours in the past.' using errcode = '22023';
      end if;
      -- Prevent a correction from creating an overlapping or second open shift.
      if p_check_in_at is not null and exists (select 1 from public.attendance a
        where a.staff_id = p_staff_id and a.id <> v_record.id and a.check_in_at is not null
          and a.check_in_at < coalesce(p_check_out_at, 'infinity'::timestamptz)
          and coalesce(a.check_out_at, 'infinity'::timestamptz) > p_check_in_at) then
        raise exception 'The corrected shift overlaps another attendance record.' using errcode = '22023';
      end if;
      v_record.check_in_at := p_check_in_at; v_record.check_out_at := p_check_out_at;
      if p_status is not null then v_record.status := p_status; end if;
    end if;
    update public.attendance set check_in_at = v_record.check_in_at, check_out_at = v_record.check_out_at,
      check_in = (v_record.check_in_at at time zone 'Asia/Kolkata')::time,
      check_out = (v_record.check_out_at at time zone 'Asia/Kolkata')::time,
      status = v_record.status, notes = coalesce(p_notes, notes), verification_method = 'manual',
      verification_result = 'manual', updated_at = v_now
    where id = v_record.id returning * into v_record;
  end if;
  insert into public.biometric_audit_events(actor_id, staff_id, attendance_id, event, reason, details)
  values (v_actor, p_staff_id, v_record.id, 'admin_' || p_action, btrim(p_reason),
    jsonb_build_object('date', p_date, 'before', v_before, 'after', jsonb_build_object(
      'status', v_record.status, 'check_in_at', v_record.check_in_at, 'check_out_at', v_record.check_out_at,
      'verification_method', v_record.verification_method, 'photo_review_status', v_record.photo_review_status)));
  return v_record;
end $$;
revoke all on function biometric_private.admin_correct_attendance(uuid,date,text,text,text,timestamptz,timestamptz,text,text) from public, anon;
grant execute on function biometric_private.admin_correct_attendance(uuid,date,text,text,text,timestamptz,timestamptz,text,text) to authenticated;

create function public.admin_correct_attendance(
  p_staff_id uuid, p_date date, p_action text, p_reason text,
  p_status text default null, p_check_in_at timestamptz default null,
  p_check_out_at timestamptz default null, p_notes text default null,
  p_photo_review_status text default null
) returns public.attendance language sql security invoker set search_path = '' as $$
  select biometric_private.admin_correct_attendance(p_staff_id, p_date, p_action, p_reason,
    p_status, p_check_in_at, p_check_out_at, p_notes, p_photo_review_status);
$$;
revoke all on function public.admin_correct_attendance(uuid,date,text,text,text,timestamptz,timestamptz,text,text) from public, anon;
grant execute on function public.admin_correct_attendance(uuid,date,text,text,text,timestamptz,timestamptz,text,text) to authenticated;

-- Default PUBLIC function execution is always revoked explicitly.
revoke all on function public.biometric_prepare_enrollment(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.biometric_open_session(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.biometric_claim_session(uuid,uuid) from public, anon, authenticated;
revoke all on function public.biometric_begin_index(uuid,uuid) from public, anon, authenticated;
revoke all on function public.biometric_finish_sample(uuid,uuid) from public, anon, authenticated;
revoke all on function public.biometric_finish_attendance(uuid,uuid) from public, anon, authenticated;
revoke all on function public.biometric_fail_session(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.biometric_request_deletion(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.biometric_remove_enrollment(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.biometric_purge_enrollment(uuid,uuid) from public, anon, authenticated;
grant execute on function public.biometric_prepare_enrollment(uuid,uuid,text,text) to service_role;
grant execute on function public.biometric_open_session(uuid,uuid,text,text) to service_role;
grant execute on function public.biometric_claim_session(uuid,uuid) to service_role;
grant execute on function public.biometric_begin_index(uuid,uuid) to service_role;
grant execute on function public.biometric_finish_sample(uuid,uuid) to service_role;
grant execute on function public.biometric_finish_attendance(uuid,uuid) to service_role;
grant execute on function public.biometric_fail_session(uuid,uuid,text) to service_role;
grant execute on function public.biometric_request_deletion(uuid,uuid,uuid,text) to service_role;
grant execute on function public.biometric_remove_enrollment(uuid,uuid,uuid,text) to service_role;
grant execute on function public.biometric_purge_enrollment(uuid,uuid) to service_role;

comment on table public.biometric_enrollments is 'Server-only enrollment metadata. collection_ref is an AES-GCM sealed provider identifier; no face images, embeddings, or browser grants.';
comment on table public.biometric_sessions is 'Server-only, short-lived one-use provider sessions. The verified state and attendance write commit in one transaction.';
comment on table public.biometric_audit_events is 'Append-only application audit: active administrators can read; browsers cannot insert, update, or delete.';
