-- Narrow read access for the free, opt-in, browser-only face comparison pilot.
-- Staff may download ONLY their own enrolled reference photo after signing in.
-- No access is granted to other employees' photos or any attendance photos.
-- The existing admin Storage policies remain unchanged.
drop policy if exists "staff read own enrolled reference photo" on storage.objects;
create policy "staff read own enrolled reference photo"
on storage.objects for select to authenticated
using (
  bucket_id = 'staff-private'
  and name = 'profiles/' || (select auth.uid())::text || '/reference'
  and exists (
    select 1 from public.staff_profiles as sp
    where sp.user_id = (select auth.uid())
      and sp.active = true
      and sp.role in ('admin','cashier','inventory_staff')
      and sp.photo_path = name
  )
);
