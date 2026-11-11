-- Add up to four extra private face references alongside the existing primary photo.
-- Old single-photo enrollments continue to work unchanged.
alter table public.staff_profiles
  add column if not exists reference_photo_paths text[] not null default '{}'::text[];

alter table public.staff_profiles
  drop constraint if exists staff_reference_photo_paths_valid;
alter table public.staff_profiles
  add constraint staff_reference_photo_paths_valid check (
    cardinality(reference_photo_paths) <= 4
    and array_position(reference_photo_paths, null) is null
    and reference_photo_paths <@ array[
      'profiles/' || user_id::text || '/reference-2',
      'profiles/' || user_id::text || '/reference-3',
      'profiles/' || user_id::text || '/reference-4',
      'profiles/' || user_id::text || '/reference-5'
    ]::text[]
  );

comment on column public.staff_profiles.reference_photo_paths is
  'Additional admin-managed private reference photos, at most 4 per employee, used only for opt-in on-device face preview.';

-- Staff may download their own enrolled extras only while opted in.
-- Admins retain their existing private storage access; staff never gain upload access.
drop policy if exists "Consenting staff read own extra references" on storage.objects;
create policy "Consenting staff read own extra references"
on storage.objects for select to authenticated
using (
  bucket_id = 'staff-private'
  and exists (
    select 1 from public.staff_profiles sp
    join public.staff_face_preview_consent c on c.staff_id = sp.user_id
    where sp.user_id = (select auth.uid())
      and sp.active = true
      and sp.role in ('cashier','inventory_staff')
      and c.consent_version = 1
      and c.withdrawn_at is null
      and name = any(sp.reference_photo_paths)
  )
);
