import { describe, it, expect } from "vitest";
import { validateStaffCreation, STAFF_ROLES } from "../../src/domain/staffRules.mjs";

describe("unified shop staff creation", () => {
  it("creates a single staff role for billing and inventory", () => {
    const result = validateStaffCreation({ name: "Arun", username: "ARUN_01", password: "secret1", role: "cashier" });
    expect(result).toEqual({ ok: true, value: { name: "Arun", username: "arun_01", password: "secret1", role: "cashier" } });
  });
  it("rejects invalid staff details and legacy or admin role selection", () => {
    expect(validateStaffCreation({ name: "", username: "arun", password: "secret1", role: "cashier" }).ok).toBe(false);
    expect(validateStaffCreation({ name: "Arun", username: "ab", password: "secret1", role: "cashier" }).ok).toBe(false);
    expect(validateStaffCreation({ name: "Arun", username: "arun", password: "12345", role: "cashier" }).ok).toBe(false);
    expect(validateStaffCreation({ name: "Arun", username: "arun", password: "secret1", role: "admin" }).ok).toBe(false);
    expect(validateStaffCreation({ name: "Arun", username: "arun", password: "secret1", role: "inventory_staff" }).ok).toBe(false);
  });
  it("offers exactly one non-admin role", () => {
    expect(STAFF_ROLES).toEqual(["cashier"]);
  });
});
