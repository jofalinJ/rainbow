import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=file=>readFileSync(new URL("../../"+file,import.meta.url),"utf8");
const order=read("order.html");
const orderJs=read("order.js");
const mobileCss=read("mobile-storefront.css");
const home=read("index.html");
const product=read("product.html");
const ids=html=>[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);

describe("customer checkout compact UX safety",()=>{
  it("retains the bag, delivery, payment and summary panels in order",()=>{
    const sections=["bagHeading","deliveryHeading","paymentHeading","summaryHeading"];
    const positions=sections.map(id=>order.indexOf('id="'+id+'"'));
    expect(positions.every(p=>p>=0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  });
  it("preserves both genuine payment methods and the UPI QR/UTR controls",()=>{
    for(const id of ["payRazorpay","payUpi","checkoutQR","paymentReference","paymentReferenceGroup","gatewayConnection","retryGateway","razorpayDetails","manualPaymentDetails"]){
      expect(ids(order)).toContain(id);
    }
    expect(order).toContain('value="razorpay"');
    expect(order).toContain('value="upi"');
    expect(order).toContain('name="paymentMethod"');
    expect(orderJs).toContain('beginRazorpayTestPayment(');
    expect(orderJs).toContain('pendingApi("/api/upi/prepare"');
    expect(orderJs).toContain('pendingApi("/api/upi/submit"');
    expect(orderJs).not.toContain('sb.rpc("create_online_order"');
  });
  it("never hides the real-money warning or claims manual UPI is verified",()=>{
    expect(order).toContain("Manual UPI transfers real money and requires shop verification.");
    expect(order).toContain("Razorpay TEST does not charge real money.");
    expect(order).not.toContain("Your order remains pending until staff verify your payment.");
    expect(orderJs).toContain("is pending shop verification. It is not confirmed yet.");
    expect(orderJs).toContain("TEST payment verified");
    expect(orderJs).toContain("No real money was deducted.");
    expect(mobileCss).not.toMatch(/\.checkout-test-notice\s*\{[^}]*display\s*:\s*none/);
  });
  it("keeps all existing tax and delivery identifiers and computed totals",()=>{
    for(const id of ["subtotal","discount","cgst","sgst","delivery","total","state","placeOrder","orderMsg"]){
      expect(ids(order)).toContain(id);
    }
    for(const field of ["deliveryFeeForState","roundMoney","cartVerified","paymentReference","razorpayReady"]){
      expect(orderJs).toContain(field);
    }
    expect(order).toContain("CGST (1.5%)");
    expect(order).toContain("SGST (1.5%)");
    expect(order).toContain("Discount (3%)");
  });
  it("keeps WhatsApp consent optional and unselected by default",()=>{
    expect(order).toContain('id="whatsappReceiptConsent" type="checkbox"');
    expect(order).toContain("(optional)");
    expect(orderJs).toContain('whatsapp_opt_in:paymentMethod==="razorpay" &&');
    expect(orderJs).toContain('?.checked===true');
  });
  it("preserves mobile category-first layout and routes",()=>{
    expect(home.indexOf('id="mobileCategorySection"')).toBeLessThan(home.indexOf('id="featuredPromotion"'));
    expect(home).toContain('href="order.html"');
    expect(product).toContain('id="detailBuy"');
    expect(product).toContain('id="detailAdd"');
    for(const page of [home,order,product]){
      const all=ids(page);
      expect(all.length).toBe(new Set(all).size);
    }
  });
  it("keeps mobile-only compact styles and preserves desktop styling",()=>{
    expect(mobileCss).toContain('@media (max-width:767px)');
    expect(mobileCss).toContain('.gateway-connection.is-online{display:none!important}');
    for(const page of [home,order,product])expect(page).toContain('mobile-storefront.css?');
  });
});
