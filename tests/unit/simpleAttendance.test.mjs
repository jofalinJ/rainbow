import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const page=read("admin/my-attendance.html");
const client=read("admin/my-attendance.js");
const migration=read("supabase/migrations/20261015154500_simple_staff_attendance_no_photos.sql");

describe("direct authenticated staff attendance",()=>{
  it("shows direct Check in and Check out without photo, tick box or face pilot",()=>{
    expect(page).toMatch(/id="checkInButton"[^>]*>Check in<\/button>/);
    expect(page).toMatch(/id="checkOutButton"[^>]*>Check out<\/button>/);
    for(const unsupported of ["facePilot","face-pilot.mjs","photoConsent","checkInPhoto","camera-upload","photoPreviewWrap"]){
      expect(page).not.toContain(unsupported);
    }
  });

  it("records a clock action without uploading photos or demanding consent",()=>{
    expect(client).toContain('rpc("staff_attendance_action",{p_action:action})');
    expect(client).not.toContain('storage.from("staff-private")');
    expect(client).not.toContain('photoConsent');
    expect(client).not.toContain('selectedCheckInPhoto');
    expect(client).toContain("attendanceSaving=true;");
    expect(client).toContain("!attendanceReady||attendanceSaving");
  });

  it("keeps protected server timestamps, signed-in identity and duplicate protection",()=>{
    expect(migration).toContain("v_staff_id uuid := auth.uid()");
    expect(migration).toContain("sp.active = true");
    expect(migration).toContain("staff_id = v_staff_id and date = v_today");
    expect(migration).toContain("You have already checked in today.");
    expect(migration).toContain("(now() at time zone 'Asia/Kolkata')::time");
    expect(migration).toContain("grant execute on function public.staff_attendance_action(text, text) to authenticated");
    expect(migration).toContain("'Not submitted'");
    expect(migration).not.toContain("photo_review_status = 'Pending'");
  });
});
