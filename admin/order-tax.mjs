// Pure order-summary helpers shared by the admin Orders screen and unit tests.
// Payment amounts remain server-authoritative; these functions only audit the display.
const amount = value => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export function itemizedOrderTotal(order = {}) {
  return amount(order.subtotal) - amount(order.discount_amount) +
    amount(order.cgst_amount) + amount(order.sgst_amount) +
    amount(order.igst_amount) + amount(order.delivery_fee);
}
export function orderAmountParts(order = {}) {
  return [
    ["Subtotal", amount(order.subtotal)],
    ["Discount", amount(order.discount_amount)],
    ["CGST", amount(order.cgst_amount)],
    ["SGST", amount(order.sgst_amount)],
    ...(amount(order.igst_amount) !== 0 ? [["IGST", amount(order.igst_amount)]] : []),
    ["Delivery", amount(order.delivery_fee)],
    ["Order total", amount(order.total_amount)]
  ];
}
export function hasMixedTaxComponents(order = {}) {
  return amount(order.igst_amount) > 0 &&
    (amount(order.cgst_amount) > 0 || amount(order.sgst_amount) > 0);
}
