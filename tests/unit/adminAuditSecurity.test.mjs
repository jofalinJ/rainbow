import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const migration=read("supabase/migrations/20261121140000_admin_audit_trail.sql");
const page=read("admin/audit.html");
const script=read("admin/audit.js");
const nav=read("admin/app.js");

describe("private operational audit history",()=>{
 it("uses owner-only RLS and revokes all browser writes",()=>{
  expect(migration).toContain("ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY");
  expect(migration).toContain("GRANT SELECT ON public.admin_audit_events TO authenticated");
  expect(migration).toContain("USING ((SELECT app_private.erp_is_admin()))");
  expect(migration).toContain("REVOKE ALL ON TABLE public.admin_audit_events FROM PUBLIC, anon, authenticated");
  expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)\s+ON\s+public\.admin_audit_events\s+TO\s+authenticated/i);
  expect(migration).toContain("app_private.write_rainbow_admin_audit()");
 });
 it("records price, publication, staff access and stock changes without raw personal fields",()=>{
  for(const source of ["rainbow_audit_products","rainbow_audit_online_listings",
   "rainbow_audit_staff_access","rainbow_audit_stock_events"]){
    expect(migration).toContain(source);
  }
  expect(migration).not.toMatch(/(?:to_jsonb|row_to_json)\s*\(\s*(?:OLD|NEW)\s*\)/i);
  expect(migration).not.toContain("whatsapp_number");
  expect(migration).not.toContain("password_hash");
 });
 it("has an owner-only navigation entry and text-only UI rendering",()=>{
  expect(nav).toContain('{label:"Audit History",href:"audit.html",roles:["admin"]}');
  expect(page).toContain("noindex,nofollow");
  expect(page).toContain('id="auditRows"');
  expect(script).toContain('profile.role!=="admin"');
  expect(script).toContain('from("admin_audit_events")');
  expect(script).toContain("textContent");
  expect(script).not.toContain("innerHTML");
 });
});
