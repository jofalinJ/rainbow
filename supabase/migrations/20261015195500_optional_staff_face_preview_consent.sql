-- Optional staff face-comparison preview: consent required before private photo access.
-- NOT an authoritative attendance or payroll verification mechanism.
create table if not exists public.staff_face_preview_consent(
 staff_id uuid primary key references auth.users(id) on delete cascade,
 consent_version integer not null default 1 check(consent_version=1),
 consented_at timestamptz not null default now(),
 withdrawn_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.staff_face_preview_consent enable row level security;
revoke all on public.staff_face_preview_consent from public,anon,authenticated;
grant select,insert,update on public.staff_face_preview_consent to authenticated;

drop policy if exists "Staff read own face preview consent" on public.staff_face_preview_consent;
create policy "Staff read own face preview consent" on public.staff_face_preview_consent for select to authenticated
using(staff_id=(select auth.uid()));
drop policy if exists "Staff accept own face preview consent" on public.staff_face_preview_consent;
create policy "Staff accept own face preview consent" on public.staff_face_preview_consent for insert to authenticated
with check(staff_id=(select auth.uid()) and
 exists(select 1 from public.staff_profiles sp where sp.user_id=(select auth.uid())
 and sp.active=true and sp.role in ('cashier','inventory_staff')));
drop policy if exists "Staff update own face preview consent" on public.staff_face_preview_consent;
create policy "Staff update own face preview consent" on public.staff_face_preview_consent for update to authenticated
using(staff_id=(select auth.uid()))
with check(staff_id=(select auth.uid()) and
 exists(select 1 from public.staff_profiles sp where sp.user_id=(select auth.uid())
 and sp.active=true and sp.role in ('cashier','inventory_staff')));

-- Own reference photo is downloadable only for consenting, active non-admin staff.
-- Employer/admin policies for normal profile-photo administration remain unchanged.
drop policy if exists "Consenting staff read own reference for face preview" on storage.objects;
create policy "Consenting staff read own reference for face preview" on storage.objects for select to authenticated
using(bucket_id='staff-private' and name='profiles/'||(select auth.uid())::text||'/reference'
 and exists(select 1 from public.staff_profiles sp where sp.user_id=(select auth.uid())
   and sp.active=true and sp.role in ('cashier','inventory_staff'))
 and exists(select 1 from public.staff_face_preview_consent c where c.staff_id=(select auth.uid())
   and c.consent_version=1 and c.withdrawn_at is null));

comment on table public.staff_face_preview_consent is
'Consent for on-device experimental face preview ONLY; no authoritative attendance decisions are based on it.';
