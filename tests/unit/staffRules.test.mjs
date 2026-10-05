import { describe, it, expect } from "vitest";
import { validateStaffCreation, STAFF_ROLES } from "../../src/domain/staffRules.mjs";

describe("staff rules", () => {
  it("accepts valid staff data", () => {
    const result = validateStaffCreation({ name: "Arun", username: "ARUN_01", password: "secret1", role: "cashier" });
    expect(result).toEqual({ ok: true, value: { name: "Arun", username: "arun_01", password: "secret1", role: "cashier" } });
  });
  it("rejects missing names, invalid usernames, weak passwords and admin creation", () => {
    expect(validateStaffCreation({ name: "", username: "arun", password: "secret1", role: "cashier" }).ok).toBe(false);
    expect(validateStaffCreation({ name: "Arun", username: "ab", password: "secret1", role: "cashier" }).ok).toBe(false);
    expect(validateStaffCreation({ name: "Arun", username: "arun", password: "12345", role: "cashier" }).ok).toBe(false);
    expect(validateStaffCreation({ name: "Arun", username: "arun", password: "secret1", role: "admin" }).ok).toBe(false);
  });
  it("exposes only self-service staff roles", () => {
    expect(STAFF_ROLES).toEqual(expect.arrayContaining(["cashier", "inventory_staff"]));
    expect(STAFF_ROLES).not.toContain("admin");
  });
});
