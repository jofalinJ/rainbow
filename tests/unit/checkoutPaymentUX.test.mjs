import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const page=read("order.html");
const script=read("order.js");
const gateway=read("order-razorpay.mjs");
const styles=read("order.css");
const build=read("scripts/build-cloudflare.mjs");

describe("Rainbow secure checkout release",()=>{
  it("publishes both payment dependencies with the Cloudflare Pages build",()=>{
    expect(build).toContain('"payment-config.js","order-razorpay.mjs"');
    expect(build).toContain('"order.js"');
    expect(page).toContain('src="payment-config.js?v=20261021-checkout-v2"');
    expect(script).toContain('order-razorpay.mjs?v=20261021-paid-confirmation-v4');
  });
  it("offers only supported choices and updates the order amount alongside the payment selector",()=>{
    expect(page).toContain('id="payRazorpay"');
    expect(page).toContain('id="payUpi"');
    expect(page).toContain('id="manualPaymentDetails"');
    expect(page).toContain('id="razorpayDetails"');
    expect(page).toContain('id="whatsappReceiptConsent"');
    expect(script).toContain('Order placed — payment verified!');
    expect(script).toContain('View / Print Invoice');
    expect(script).toContain('whatsapp_opt_in:paymentMethod==="razorpay"');
    expect(gateway).toContain('invoiceUrl:result.invoiceUrl||null');
    expect(page).toContain('id="summaryHeading"');
    expect(page).toContain('id="placeOrder"');
    expect(page).not.toMatch(/name="paymentMethod"[^>]*value="cod"/i);
    expect(styles).toContain(".checkout-layout");
    expect(styles).toContain(".checkout-aside");
    expect(styles).toContain("@media(max-width:520px)");
  });
  it("fails closed and explains outages rather than enabling an unverified gateway",()=>{
    expect(page).toMatch(/id="payRazorpay"[^>]*disabled/);
    expect(script).toContain("gateway.disabled=!status.available");
    expect(script).toContain('manual.checked=true');
    expect(script).toContain('retryGateway');
    expect(gateway).toContain('razorpayAvailability()');
    expect(gateway).toContain('data.enabled===true && keyMatches');
     expect(gateway).toContain('gateway.mode!==mode');
     expect(gateway).toContain('"rainbow_razorpay_live_pending_v1"');
    expect(gateway).toContain('cache:"no-store"');
    expect(gateway).toContain("Could not connect to the secure payment service");
    expect(gateway).toContain("/api/razorpay/provider-check?check=");
    expect(gateway).toContain('result.provider==="credentials_rejected"');
    expect(gateway).toContain('data.code==="CHECKOUT_EXPIRED"');
    expect(gateway).toContain('error.code!=="CHECKOUT_EXPIRED"');
  });
  it("preserves manual UPI verification and clarifies it can transfer actual money",()=>{
    expect(page).toContain('id="checkoutQR"');
    expect(page).toContain('id="paymentReference"');
    expect(page).toContain('Manual UPI transfer is separate and can move real funds.');
    expect(script).toContain('rpc("create_online_order"');
    expect(script).toContain('/^[A-Za-z0-9-]{8,64}$/.test(paymentReference)');
  });
});
