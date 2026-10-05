export function validateProductDraft(input) {
  const categoryId = String(input?.categoryId ?? "").trim();
  const name = String(input?.name ?? "").trim();
  const type = String(input?.type ?? "").trim();
  const sellingPrice = Number(input?.sellingPrice);
  if (!categoryId) return { ok: false, error: "Choose a category." };
  if (!name) return { ok: false, error: "Product name is required." };
  if (!type) return { ok: false, error: "Product type is required." };
  if (!Number.isFinite(sellingPrice) || sellingPrice < 0) return { ok: false, error: "Selling price must be a valid non-negative amount." };
  return { ok: true, value: { categoryId, name, type, sellingPrice } };
}
