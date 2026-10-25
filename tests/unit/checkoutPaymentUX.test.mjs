import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const page=read("order.html");
const checkout=read("order.js");
const gateway=read("order-razorpay.mjs");
const build=read("scripts/build-cloudflare.mjs");
const css=read("mobile-storefront.css");

describe("Razorpay LIVE reconciliation on the isolated audit branch",()=>{
  it("retains both gateway dependencies and mode-gated module import",()=>{
    expect(build).toContain('"payment-config.js","order-razorpay.mjs"');
    expect(build).toContain('"order.js"');
    expect(checkout).toContain("import {razorpayAvailability,beginRazorpayPayment}");
    expect(checkout).toContain("order-razorpay.mjs?v=20261025-live-gated-audit");
    expect(page).toContain('id="payRazorpay"');
    expect(page).toContain('id="payUpi"');
  });
  it("never exposes TEST unrequested in production or LIVE on a preview host",()=>{
    expect(checkout).toContain('get("test")==="1"');
    expect(checkout).toContain('const razorpayLiveAllowed=!testHost');
    expect(checkout).toContain('razorpayMode==="live"?razorpayLiveAllowed:razorpayTestAllowed');
    expect(checkout).toContain('gatewayOption.hidden=!razorpayTestAllowed');
    expect(checkout).toContain("razorpayReady=Boolean(status.available&&permitted)");
    expect(checkout).not.toContain("gateway.checked=true");
    expect(checkout).not.toContain("manual.checked=true");
    expect(page).toContain('id="payUpi" type="radio" name="paymentMethod" value="upi" checked');
  });
  it("rechecks server mode and exact integer-paise amount before opening payment",()=>{
    expect(gateway).toContain("export async function razorpayAvailability()");
    expect(gateway).toContain('result.provider==="connected"');
    expect(gateway).toContain('data.mode==="test" || data.mode==="live"');
    expect(gateway).toContain("if(mode!==expectedMode)");
    expect(gateway).toContain("Math.round(displayTotal*100)!==gateway.amount");
    expect(gateway).toContain('data.code==="CHECKOUT_EXPIRED"');
    expect(gateway).toContain('error.code!=="CHECKOUT_EXPIRED"');
    expect(checkout).toContain('expectedMode:selectedRazorpayMode');
    expect(checkout).toContain('onPaymentFailed:reason=>msg(');
  });
  it("keeps payment pending distinct from independently verified paid",()=>{
    expect(gateway).toContain("if(result.paid===true)");
    expect(gateway).toContain('resolve({status:"pending",mode,orderNumber:result.orderNumber})');
    expect(checkout).toContain('if(result.status==="paid")');
    expect(checkout).toContain('if(result.status==="pending")');
    expect(checkout).toContain('result.mode==="live"?"<h2>Payment verified');
    expect(checkout).toContain("No real money was deducted.");
    expect(css).toContain('html.checkout-razorpay-live #razorpayChoice .payment-choice-note');
    expect(checkout).toContain("Razorpay charges real money.");
  });
  it("requires safe pending UPI order and never enables the old anonymous RPC fallback",()=>{
    expect(checkout).toContain('pendingApi("/api/upi/prepare"');
    expect(checkout).toContain('pendingApi("/api/upi/submit"');
    expect(checkout).not.toContain('sb.rpc("create_online_order"');
    expect(page).toContain('id="checkoutQR"');
    expect(page).toContain('id="paymentReferenceGroup"');
    expect(page).toContain("Manual UPI transfers real money and requires shop verification.");
    expect(checkout).toContain("is pending shop verification. It is not confirmed yet.");
  });
});