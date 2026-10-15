import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { INDIAN_STATES,deliveryFeeForState } from "../../order-pricing.mjs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const html=read("order.html");
const js=read("order.js");
const migration=read("supabase/migrations/20261015183000_online_order_state_delivery_pricing.sql");
describe("state-based shipping preview",()=>{
  it("charges ₹50 for Tamil Nadu regardless of casing",()=>{
    expect(deliveryFeeForState("Tamil Nadu")).toBe(50);
    expect(deliveryFeeForState("tamil nadu")).toBe(50);
    expect(deliveryFeeForState(" TAMIL NADU ")).toBe(50);
  });
  it("charges ₹100 for other Indian states and union territories",()=>{
    expect(deliveryFeeForState("Kerala")).toBe(100);
    expect(deliveryFeeForState("Delhi")).toBe(100);
    expect(deliveryFeeForState("Puducherry")).toBe(100);
    expect(deliveryFeeForState("Andaman and Nicobar Islands")).toBe(100);
  });
  it("does not show a payable amount for absent or unrecognized states",()=>{
    expect(deliveryFeeForState("")).toBeNull();
    expect(deliveryFeeForState("Unknown Country")).toBeNull();
  });
  it("keeps the server state allow-list identical to the frontend",()=>{
    const group=migration.match(/lower\(v_state\) = any \(array\[([^\]]+)\]\)/);
    expect(group).not.toBeNull();
    const dbStates=[...group[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).sort();
    expect(dbStates).toEqual(INDIAN_STATES.map(x=>x.toLowerCase()).sort());
    expect(INDIAN_STATES).toHaveLength(36);
    expect(migration).toContain("then 50 else 100 end");
    expect(migration).toContain("v_taxable+v_cgst+v_sgst+v_delivery");
    expect(migration).toContain("null,v_delivery,v_total,v_address");
    expect(migration).toContain("v_payment_method is distinct from 'upi'");
  });
});
describe("gateway readiness and manual UPI",()=>{
  it("does not activate payment methods without merchant setup",()=>{
    expect(html).toContain("Razorpay gateway · activation pending");
    for(const value of ["razorpay_upi","razorpay_card","razorpay_netbanking","razorpay_wallet"]){
      expect(html).toContain('value="'+value+'" disabled');
    }
    expect(html).not.toContain('id="paymentConfirmed"');
    expect(html).not.toContain('id="deliveryNote"');
    expect(html).not.toContain("Your order stays pending until an admin verifies");
  });
  it("requires a verified cart, a shipping state, and a UPI transaction reference",()=>{
    expect(js).toContain("shipping!==null");
    expect(js).toContain("cart.every(cartItemHasStock)");
    expect(js).toContain('$(\"paymentMethod\").value!==\"upi\"');
    expect(js).toContain('rpc(\"create_online_order\"');
    expect(js).not.toContain("paymentConfirmed");
    expect(html).toContain('id="checkoutQR"');
    expect(html).toContain("hidden");
  });
});
