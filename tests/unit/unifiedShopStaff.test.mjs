import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = p => readFileSync(path.resolve(p), "utf8");
const sql = read("supabase/migrations/20261018222000_unify_billing_inventory_staff.sql");
const staffHtml = read("admin/staff.html");
const staffJs = read("admin/staff.js");

describe("unified billing and inventory staff", () => {
  it("migrates existing inventory staff without deleting accounts or sales", () => {
    expect(sql).toContain("update public.staff_profiles");
    expect(sql).toContain("set role = 'cashier'::public.staff_role");
    expect(sql).toContain("where role = 'inventory_staff'::public.staff_role");
    expect(sql).toContain("before insert or update of role on public.staff_profiles");
    expect(sql).toContain("new.role := 'cashier'::public.staff_role");
    expect(sql).not.toMatch(/delete\s+from\s+public\.staff_profiles/i);
  });
  it("extends RLS inventory checks and secure stock updates to the combined staff", () => {
    expect(sql).toContain("create or replace function public.is_inventory_staff()");
    expect(sql).toContain("role in ('cashier', 'inventory_staff')");
    expect(sql).toContain("s.active=true and s.role in ('admin','cashier','inventory_staff')");
    expect(sql).toContain("if v_actor is null or not exists(");
  });
  it("only offers one Staff role and removes role-changing controls", () => {
    expect(staffHtml).toContain('<option value="cashier">Staff — Billing &amp; Inventory</option>');
    expect(staffHtml).not.toContain('<option value="inventory_staff">');
    expect(staffJs).not.toContain("data-role-user");
    expect(staffJs).not.toContain("changeRole(");
    expect(staffJs).toContain('isAdmin?"Admin":"Staff"');
  });
});
