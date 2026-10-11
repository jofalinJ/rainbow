-- Attendance belongs to the staff profile identified by its auth user UUID.
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  date date not null default current_date,
  check_in time,
  check_out time,
  status text not null default 'Present'
    check (status in ('Present', 'Absent', 'Half Day', 'On Leave')),
  notes text,
  created_at timestamptz not null default now(),
  constraint attendance_staff_id_fkey
    foreign key (staff_id) references public.staff_profiles(user_id) on delete cascade,
  constraint attendance_staff_date_unique unique (staff_id, date)
);

create index attendance_date_idx on public.attendance (date);

alter table public.attendance enable row level security;

-- The admin dashboard only allows active administrators to read or change attendance.
grant select, insert, update on public.attendance to authenticated;

create policy "admin manage attendance"
  on public.attendance
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
