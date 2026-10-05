export function normalizeNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function getStockStatus(stockQuantity, lowStockLimit) {
  const stock = normalizeNonNegativeInteger(stockQuantity, 0);
  const limit = normalizeNonNegativeInteger(lowStockLimit, 0);
  if (stock === 0) return { label: "Out of stock", tone: "orange" };
  if (stock <= limit) return { label: "Low stock", tone: "orange" };
  return { label: "In stock", tone: "green" };
}
