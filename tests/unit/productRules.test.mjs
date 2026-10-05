import { describe, it, expect } from "vitest";
import { validateProductDraft } from "../../src/domain/productRules.mjs";

describe("product rules", () => {
  it("accepts and normalizes a valid product draft", () => {
    expect(validateProductDraft({ categoryId: "cat-1", name: " Stone Earring ", type: "Stone", sellingPrice: "2450" })).toEqual({ ok: true, value: { categoryId: "cat-1", name: "Stone Earring", type: "Stone", sellingPrice: 2450 } });
  });
  it("rejects missing required fields", () => {
    expect(validateProductDraft({ categoryId: "", name: "Stone Earring", type: "Stone", sellingPrice: 100 }).ok).toBe(false);
    expect(validateProductDraft({ categoryId: "cat", name: "", type: "Stone", sellingPrice: 100 }).ok).toBe(false);
    expect(validateProductDraft({ categoryId: "cat", name: "Stone Earring", type: "", sellingPrice: 100 }).ok).toBe(false);
  });
  it("rejects invalid prices", () => {
    expect(validateProductDraft({ categoryId: "cat", name: "Stone Earring", type: "Stone", sellingPrice: -1 }).ok).toBe(false);
    expect(validateProductDraft({ categoryId: "cat", name: "Stone Earring", type: "Stone", sellingPrice: "abc" }).ok).toBe(false);
  });
});
