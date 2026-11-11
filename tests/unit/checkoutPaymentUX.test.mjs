import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const page=read("order.html");
const script=read("order.js");
const gateway=read("order-razorpay.mjs");
const styles=read("order.css");
const build=read("scripts/build-cloudflare.mjs");

describe("Rainbow online-only secure checkout release",()=>{
  it("publishes both payment dependencies with the Cloudflare Pages build",()=>{
    expect(build).toContain('"payment-config.js","order-razorpay.mjs"');
    expect(build).toContain('"order.js"');
    expect(page).toMatch(/src="payment-config\.js\?v=[\w-]+"/);
    expect(script).toMatch(/order-razorpay\.mjs\?v=[\w-]+/);
  });
  it("offers Razorpay alone and retains the summary, optional receipt and verified invoice",()=>{
    const methods=[...page.matchAll(/<input\b[^>]*name="paymentMethod"[^>]*>/g)].map(match=>match[0]);
    expect(methods).toHaveLength(1);
    expect(methods[0]).toContain('id="payRazorpay"');
    expect(methods[0]).toContain('value="razorpay"');
    expect(methods[0]).toMatch(/\bchecked\b/);
    expect(methods[0]).toMatch(/\bdisabled\b/);
    expect(page).not.toContain('id="razorpayDetails"');
    expect(page).toContain('id="whatsappReceiptConsent"');
    expect(page).toContain('type="checkbox"');
    expect(script).toContain('Payment verified</h2>');
    expect(script).toContain('View / Print Invoice');
    expect(gateway).toContain('invoiceUrl:result.invoiceUrl||null');
    expect(page).toContain('id="summaryHeading"');
    expect(page).toContain('id="placeOrder"');
    expect(styles).toContain(".checkout-layout");
    expect(styles).toContain(".checkout-aside");
    expect(styles).toContain("@media(max-width:520px)");
  });
  it("removes the manual transfer controls, warning banner and direct manual-order submission",()=>{
    for(const id of ["payUpi","manualUpiChoice","manualPaymentDetails","checkoutQR","paymentReference","paymentReferenceGroup"]){
      expect(page).not.toContain('id="'+id+'"');
    }
    expect(page).not.toContain('class="checkout-test-notice"');
    expect(page).not.toContain("Manual UPI transfers real money");
    expect(script).not.toMatch(/\.rpc\(\s*["']create_online_order["']/);
    expect(script).not.toContain('manual.checked=true');
    expect(script).not.toContain("Choose manual UPI instead");
  });
  it("retains independent provider checks, mode matching and expired-checkout recovery",()=>{
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
});
