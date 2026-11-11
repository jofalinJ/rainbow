import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {itemizedOrderTotal,orderAmountParts,hasMixedTaxComponents} from "../../admin/order-tax.mjs";

describe("admin order GST summary", () => {
  it("reconciles Tamil Nadu CGST and SGST without an IGST row", () => {
    const order={subtotal:1000,discount_amount:100,cgst_amount:13.5,sgst_amount:13.5,igst_amount:0,delivery_fee:40,total_amount:967};
    expect(itemizedOrderTotal(order)).toBe(967);
    expect(orderAmountParts(order).map(([label])=>label)).toEqual(["Subtotal","Discount","CGST","SGST","Delivery","Order total"]);
    expect(hasMixedTaxComponents(order)).toBe(false);
  });
  it("reconciles interstate IGST, including numeric-string database values", () => {
    const order={subtotal:"1000",discount_amount:"100",cgst_amount:"0",sgst_amount:"0",igst_amount:"27",delivery_fee:"40",total_amount:"967"};
    expect(itemizedOrderTotal(order)).toBe(967);
    expect(orderAmountParts(order)).toContainEqual(["IGST",27]);
    expect(hasMixedTaxComponents(order)).toBe(false);
  });
  it("flags inconsistent mixed tax categories without hiding either component", () => {
    const order={subtotal:100,discount_amount:0,cgst_amount:1.5,sgst_amount:1.5,igst_amount:3,delivery_fee:0,total_amount:106};
    expect(hasMixedTaxComponents(order)).toBe(true);
    expect(itemizedOrderTotal(order)).toBe(106);
    expect(orderAmountParts(order).map(([name])=>name)).toContain("IGST");
  });
  it("reads IGST in the order query and keeps it in the modal amount audit", () => {
    const script=readFileSync(new URL("../../admin/orders.js",import.meta.url),"utf8");
    const page=readFileSync(new URL("../../admin/orders.html",import.meta.url),"utf8");
    expect(script).toContain("cgst_amount,sgst_amount,igst_amount,delivery_fee");
    expect(script).toContain("const recordedAmount=itemizedOrderTotal(o)");
    expect(script).toContain("const amounts=orderAmountParts(o)");
    expect(page).toContain("orders.js?v=20261111-igst-display");
  });
});
