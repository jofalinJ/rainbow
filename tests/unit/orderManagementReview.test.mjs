import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const orders=read("admin/orders.js");
const page=read("admin/orders.html");
const styles=read("admin/orders.css");
const migration=read("supabase/migrations/20261015201000_secure_online_order_status.sql");
const promotionFix=read("supabase/migrations/20261015200500_fix_promotion_delete_filter.sql");

describe("complete online order review",()=>{
  it("loads online orders only and retrieves all billing breakdown fields",()=>{
    expect(orders).toContain('rpc("search_online_orders"');
    expect(read("supabase/migrations/20261025120700_paginated_online_orders.sql")).toContain("where o.source='online'");
    for(const field of ["subtotal","discount_amount","cgst_amount","sgst_amount","delivery_fee",
      "variant_color","variant_size","length_cm","thickness","unit_price","line_total",
      "transaction_reference","verified_at","amount"]){
      expect(orders).toContain(field);
    }
  });
  it("shows individual ordered items, payment references, delivery details and a clear status warning",()=>{
    for(const phrase of ["Ordered items","Billing breakdown","order-amount-breakdown",
      "Payment verified","Transaction reference","Delivery address",
      "Delivered order has no verified payment","Manage Shipment"]){
      expect(orders).toContain(phrase);
    }
    expect(styles).toContain(".order-detail-warning");
    expect(styles).toContain(".orders-table{min-width:900px");
    expect(page).toContain("orders.js?v=20261021-refund-review-v1");
    expect(orders).toContain("needsPaymentReconciliation(o)");
    expect(orders).toContain("Review captured payment / refund");
    expect(orders).toContain("Do not ship or send a paid-order notification");
  });
  it("never changes order status directly from the browser",()=>{
    expect(orders).toContain('rpc("update_online_order_status"');
    expect(orders).not.toContain('from("orders").update({status');
    expect(orders).toContain("manualStatusChoices(o)");
    expect(orders).toContain("online_order_status_events");
  });
  it("guards manual status editing on the server and retains history",()=>{
    expect(migration).toContain("source='online'");
    expect(migration).toContain("sp.active and sp.role='admin'");
    expect(migration).toContain("v_order.payment_status<>'paid'");
    expect(migration).toContain("v_order.status in ('cancelled','refunded','delivered')");
    expect(migration).toContain("Use Manage Shipment for dispatch and delivery");
    expect(migration).toContain("insert into public.online_order_status_events");
    expect(migration).toContain("revoke all on function public.update_online_order_status");
  });
});
describe("promotional gallery fix",()=>{
  it("adds a restricted WHERE to the atomic replacement of featured photos",()=>{
    expect(promotionFix).toContain("where display_order between 1 and 8");
    expect(promotionFix).toContain("pg_advisory_xact_lock");
    expect(promotionFix).toContain("s.role='admin'");
    expect(promotionFix).toContain("v_count>8");
    const editor=read("admin/promotion.js");
    expect(editor).toContain('rpc("set_homepage_promotions"');
  });
});
