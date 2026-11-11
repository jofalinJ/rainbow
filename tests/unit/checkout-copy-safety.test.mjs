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
  it("keeps only online Razorpay payment and removes the manual transfer notice",()=>{
    for(const id of ["payRazorpay","gatewayConnection","retryGateway"]){
      expect(ids(order)).toContain(id);
    }
    for(const id of ["payUpi","manualUpiChoice","checkoutQR","paymentReference","paymentReferenceGroup","manualPaymentDetails"]){
      expect(ids(order)).not.toContain(id);
    }
    expect(order).toContain('value="razorpay"');
    expect(order).not.toContain('value="upi"');
    expect(order).not.toContain('class="checkout-test-notice"');
    expect(orderJs).toContain('beginRazorpayPayment(');
    expect(orderJs).not.toContain('sb.rpc("create_online_order"');
  });
  it("retains accurate TEST-mode and pending-payment messages without a manual fallback",()=>{
    expect(orderJs).toContain("TEST payment verified");
    expect(orderJs).toContain("No real money was deducted.");
    expect(orderJs).toContain("is awaiting confirmation. Do not pay again");
    expect(orderJs).not.toContain("Choose manual UPI instead");
    expect(orderJs).not.toContain("UPI reference submitted");
  });
  it("keeps all existing tax and delivery identifiers and computed totals",()=>{
    for(const id of ["subtotal","cgst","sgst","delivery","total","state","placeOrder","orderMsg"]){
      expect(ids(order)).toContain(id);
    }
    for(const field of ["deliveryFeeForState","roundMoney","cartVerified","razorpayReady"]){
      expect(orderJs).toContain(field);
    }
    expect(order).toContain("CGST (1.5%)");
    expect(order).toContain("SGST (1.5%)");
    expect(order).not.toContain("Discount (3%)");
  });
  it("offers optional unchecked consent before sending a paid invoice by WhatsApp",()=>{
    expect(order).toContain('id="whatsappReceiptConsent"');
    expect(order).toContain('type="checkbox"');
    const consentInput=order.match(/<input[^>]*id="whatsappReceiptConsent"[^>]*>/)?.[0]||"";
    expect(consentInput).not.toContain("checked");
    expect(order).toContain("verified-payment invoice link");
    expect(orderJs).toContain('whatsapp_opt_in:$("whatsappReceiptConsent")?.checked===true');
    expect(order).toContain('href="privacy-policy.html"');
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
