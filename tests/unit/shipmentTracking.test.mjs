import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {
 normalizeIndianPhone,formatShipmentMessage,whatsappTrackingUrl,
 canNotifyShipment,shipmentTimeline,dateForMessage,TRACKING_URL
} from "../../admin/shipment-utils.mjs";

const sql=readFileSync(new URL("../../supabase/migrations/20261015193000_professional_couriers_tracking.sql",import.meta.url),"utf8");
const admin=readFileSync(new URL("../../admin/orders.js",import.meta.url),"utf8");
const tracking=readFileSync(new URL("../../content.js",import.meta.url),"utf8");
const order={order_number:"RG-20261015-A123",customer_name:"Test Customer"};
const shipment={consignment_number:"TPC123456",dispatch_date:"2026-10-15",status:"shipped"};

describe("Indian WhatsApp contact validation",()=>{
  it.each([
    ["9876543210","919876543210"],["+91 98765 43210","919876543210"],
    ["0919876543210",null],["09876543210","919876543210"],
    ["919876543210","919876543210"],["1234567890",null],
    ["+1 9876543210",null],["919876543210000",null],["",null]
  ])("%s normalizes to %s",(input,expected)=>{
    expect(normalizeIndianPhone(input)).toBe(expected);
  });
  it("refuses missing contacts and empty messages",()=>{
    expect(whatsappTrackingUrl("", "hello")).toBeNull();
    expect(whatsappTrackingUrl("9876543210","")).toBeNull();
  });
});
describe("Professional Couriers WhatsApp message",()=>{
  it("includes order, customer, AWB, dispatch date and official site",()=>{
    const text=formatShipmentMessage(order,shipment);
    expect(text).toContain("Hello Test Customer 👋");
    expect(text).toContain(order.order_number);
    expect(text).toContain(shipment.consignment_number);
    expect(text).toContain("15 October 2026");
    expect(text).toContain("The Professional Couriers");
    expect(text).toContain(TRACKING_URL);
    expect(text).toContain("Enter your consignment number");
    const url=whatsappTrackingUrl("+91 98765 43210",text);
    expect(url).toContain("https://wa.me/919876543210?text=");
    expect(decodeURIComponent(new URL(url).searchParams.get("text"))).toBe(text);
  });
  it("requires complete saved shipment info",()=>{
    expect(()=>formatShipmentMessage(order,{...shipment,consignment_number:""})).toThrow();
    expect(()=>formatShipmentMessage(order,{...shipment,dispatch_date:null})).toThrow();
    expect(dateForMessage("not-a-date")).toBe("");
    expect(dateForMessage("2026-02-31")).toBe("");
  });
  it("blocks unopened, invalid or already confirmed notifications",()=>{
    expect(canNotifyShipment(shipment,"9876543210")).toBe(true);
    expect(canNotifyShipment(shipment,"9876543210",true)).toBe(false);
    expect(canNotifyShipment({...shipment,status:"packed"},"9876543210")).toBe(false);
    expect(canNotifyShipment(shipment,"1234")).toBe(false);
    expect(canNotifyShipment({...shipment,consignment_number:null},"9876543210")).toBe(false);
  });
});
describe("shipment status UI and secured storage",()=>{
  it("maps progressive milestones without showing imaginary live data",()=>{
    const placed=shipmentTimeline("pending",null);
    expect(placed.steps[0].state).toBe("current");
    const shipped=shipmentTimeline("shipped","in_transit");
    expect(shipped.steps[3].state).toBe("current");
    expect(shipped.steps[4].state).toBe("pending");
    expect(shipmentTimeline("delivered","delivered").steps[4].state).toBe("current");
  });
  it("persists a unique shipment per order and tracks changes",()=>{
    expect(sql).toContain("order_id uuid not null unique references public.orders(id)");
    expect(sql).toContain("unique(shipment_id,awb_snapshot)");
    expect(sql).toContain("create trigger trg_audit_order_shipment");
    expect(sql).toContain("p_status in ('packed','shipped','in_transit','out_for_delivery','delivered','exception')");
    expect(sql).toContain("p_dispatch_date");
    expect(sql).toContain("confirmed_by uuid not null references auth.users(id)");
    expect(sql).toContain("confirmed_at timestamptz not null default now()");
  });
  it("checks active admin membership and isolates customer tracking from raw tables",()=>{
    expect(sql).toContain("sp.active and sp.role='admin'");
    expect(sql).toContain("v_order.payment_status::text <> 'paid'");
    expect(sql).toContain("auth.uid() is not null");
    expect(sql).toContain("lower(trim(auth.jwt()->>'email'))");
    expect(sql).toContain("length(trim(coalesce(p_product_code,''))) between 1 and 64");
    expect(sql).toContain("on conflict(shipment_id,awb_snapshot) do nothing");
    expect(admin).toContain('setupShipmentManagement');
    expect(tracking).toContain('client.rpc("track_my_order_shipments")');
    expect(tracking).toContain('client.rpc("track_guest_order_shipments"');
    expect(tracking).toContain("Not a live courier update.");
  });
});
