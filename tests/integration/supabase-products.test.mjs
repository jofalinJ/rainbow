import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const productionUrl = "https://ajnicsvtymvvkgepjmmk.supabase.co";

describe("Supabase product integration", () => {
  if (!url || !serviceRoleKey) {
    it.skip("requires an isolated Supabase test environment", () => {});
    return;
  }
  if (url.replace(/\/$/, "") === productionUrl) throw new Error("Refusing to run integration tests against production.");

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const runId = crypto.randomUUID();
  const categoryName = "__TEST__" + runId;
  const codePrefix = ("T" + runId.replace(/-/g, "").slice(0, 2)).toUpperCase();
  let categoryId = null;
  let productId = null;

  afterAll(async () => {
    if (productId) await admin.from("products").delete().eq("id", productId);
    if (categoryId) await admin.from("categories").delete().eq("id", categoryId);
  });

  it("creates a product and variant with generated code and barcode", async () => {
    const { data: category, error: categoryError } = await admin.from("categories").insert({
      name: categoryName, code_prefix: codePrefix, has_color: true, has_size: true,
      has_length: false, has_thickness: false, has_gold_amount: false, active: true
    }).select("id").single();
    expect(categoryError).toBeNull();
    categoryId = category?.id;

    const { data: product, error: productError } = await admin.from("products").insert({
      category_id: categoryId, product_name: "Automated Test Earring", type: "Stone", selling_price: 2450, description: "CI test fixture"
    }).select("id,product_code,selling_price").single();
    expect(productError).toBeNull();
    productId = product?.id;
    expect(product?.selling_price).toBe(2450);
    expect(product?.product_code).toMatch(new RegExp("^" + codePrefix + "\\d{5}$"));

    const { data: variant, error: variantError } = await admin.from("product_variants").insert({
      product_id: productId, color: "Red", size: "0", stock_quantity: 5, low_stock_limit: 2
    }).select("product_id,color,size,stock_quantity,barcode").single();
    expect(variantError).toBeNull();
    expect(variant?.product_id).toBe(productId);
    expect(variant?.stock_quantity).toBe(5);
    expect(variant?.barcode).toMatch(/^89[0-9a-f]+$/);
  });

  it("enforces unique product variants", async () => {
    const first = await admin.from("product_variants").insert({ product_id: productId, color: "Black", size: "0", stock_quantity: 1, low_stock_limit: 1 }).select("id").single();
    expect(first.error).toBeNull();
    const second = await admin.from("product_variants").insert({ product_id: productId, color: "Black", size: "0", stock_quantity: 1, low_stock_limit: 1 }).select("id").single();
    expect(second.error?.code).toBe("23505");
  });
});
