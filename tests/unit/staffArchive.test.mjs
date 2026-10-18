import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
const sql=read("supabase/migrations/20261018224500_archive_removed_staff.sql");
const edge=read("supabase/functions/delete-staff-user/index.ts");
const ui=read("admin/staff.js");
const html=read("admin/staff.html");
describe("staff removal without deleting audit records",()=>{
 it("records archived time while requiring inactive profiles",()=>{
  expect(sql).toContain("add column if not exists archived_at timestamptz");
  expect(sql).toContain("archived_at is null or active = false");
 });
 it("protects admin and disables access without removing the authentication identity",()=>{
  expect(edge).toContain('callerProfile.role !== "admin"');
  expect(edge).toContain('target.role === "admin"');
  expect(edge).toContain('active: false, archived_at: new Date().toISOString()');
  expect(edge).toContain('ban_duration: "876000h"');
  expect(edge).not.toContain("auth.admin.deleteUser");
 });
 it("only shows one Staff role and hides archived accounts",()=>{
  expect(html).toContain('<option value="cashier">Staff</option>');
  expect(html).not.toContain('<option value="inventory_staff">');
  expect(ui).toContain('.is("archived_at",null)');
  expect(ui).toContain("Past orders and inventory records have been preserved.");
 });
});
