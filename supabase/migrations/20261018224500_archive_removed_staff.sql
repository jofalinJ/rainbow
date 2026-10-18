-- Preserve sales and inventory audit history when removing staff access.
alter table public.staff_profiles
  add column if not exists archived_at timestamptz;

alter table public.staff_profiles
  drop constraint if exists staff_profiles_archived_are_inactive;
alter table public.staff_profiles
  add constraint staff_profiles_archived_are_inactive
  check (archived_at is null or active = false);

create index if not exists staff_profiles_current_staff_idx
  on public.staff_profiles (created_at)
  where archived_at is null;

comment on column public.staff_profiles.archived_at is
  'Archived from staff management. Auth identity is preserved to attribute historical sales and stock changes.';
