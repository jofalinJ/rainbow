import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const page=read("admin/my-attendance.html");
const client=read("admin/my-attendance.js");
const migration=read("supabase/migrations/20261015154500_simple_staff_attendance_no_photos.sql");

describe("migration from direct attendance to verified attendance",()=>{
  it("replaces direct check-in with the authenticated liveness flow",()=>{
    expect(page).toContain('id="checkInButton"');
    expect(page).toContain("Face Check-in");
    expect(page).toContain("Face Check-out");
    expect(page).not.toContain("face-preview.mjs");
    expect(client).toContain('faceRequest(myAttendanceClient,"start_verification",{action})');
    expect(client).toContain('captureLiveness(');
    expect(client).not.toContain('rpc("staff_attendance_action"');
    expect(client).not.toContain('storage.from("staff-private")');
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
