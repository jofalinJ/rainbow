import { describe, it, expect } from "vitest";
import { getStockStatus, normalizeNonNegativeInteger } from "../../src/domain/inventoryRules.mjs";

describe("inventory rules", () => {
  it("marks zero stock as out of stock", () => expect(getStockStatus(0, 3)).toEqual({ label: "Out of stock", tone: "orange" }));
  it("marks the threshold as low stock", () => expect(getStockStatus(3, 3)).toEqual({ label: "Low stock", tone: "orange" }));
  it("marks stock above the threshold as in stock", () => expect(getStockStatus(4, 3)).toEqual({ label: "In stock", tone: "green" }));
  it("normalizes fractional and invalid quantities", () => {
    expect(normalizeNonNegativeInteger("4.9")).toBe(4);
    expect(normalizeNonNegativeInteger(-1, 7)).toBe(7);
    expect(normalizeNonNegativeInteger("bad", 5)).toBe(5);
  });
});
