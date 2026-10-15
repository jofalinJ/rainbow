-- Admins supervise staff attendance; personal punches are for cashier/inventory staff only.
-- Historical admin attendance entries are preserved.
create or replace function public.staff_attendance_action(
  p_action text,p_photo_path text default null
) returns public.attendance language plpgsql security definer
set search_path=public,pg_temp as $$
declare
 v_staff_id uuid:=auth.uid();
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_record public.attendance%rowtype;
begin
 if v_staff_id is null then
   raise exception 'Please sign in to record attendance.' using errcode='42501';
 end if;
 if not exists(select 1 from public.staff_profiles sp
   where sp.user_id=v_staff_id and sp.active and sp.role in ('cashier','inventory_staff')) then
   raise exception 'Personal attendance is available to active non-admin staff only.' using errcode='42501';
 end if;
 if p_action='check_in' then
   if p_photo_path is not null then raise exception 'Photo check-in is no longer supported. Refresh the attendance page.'; end if;
   select * into v_record from public.attendance
   where staff_id=v_staff_id and date=v_today for update;
   if found and v_record.check_in is not null then raise exception 'You have already checked in today.'; end if;
   if found then
     update public.attendance set check_in=(now() at time zone 'Asia/Kolkata')::time,
       status='Present',photo_path=null,photo_review_status='Not submitted',
       photo_reviewed_by=null,photo_reviewed_at=null
     where id=v_record.id returning * into v_record;
   else
     insert into public.attendance(staff_id,date,check_in,status,photo_path,photo_review_status)
     values(v_staff_id,v_today,(now() at time zone 'Asia/Kolkata')::time,'Present',null,'Not submitted')
     returning * into v_record;
   end if;
   return v_record;
 elsif p_action='check_out' then
   update public.attendance set check_out=(now() at time zone 'Asia/Kolkata')::time
   where staff_id=v_staff_id and date=v_today and check_in is not null and check_out is null
   returning * into v_record;
   if not found then raise exception 'Check in before checking out, or you have already checked out.'; end if;
   return v_record;
 else raise exception 'Unsupported attendance action.'; end if;
end; $$;
revoke all on function public.staff_attendance_action(text,text) from public,anon;
grant execute on function public.staff_attendance_action(text,text) to authenticated;
