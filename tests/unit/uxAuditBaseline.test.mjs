/* Phase 0 SOURCE-ONLY regression baseline.
 * These assertions deliberately expose existing defects. They MUST NOT contact
 * Supabase, Razorpay, a real QR recipient, or a production payment endpoint.
 * Browser/device scenarios and pending-checkout contract remain separate.
 */
import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const src=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const product=src("product.html"),order=src("order.html");
const shop=src("content.js"),productJs=src("product-page.js"),checkout=src("order.js");
const siteCss=src("content.css"),mobileCss=src("mobile-storefront.css"),productCss=src("product-page.css");
const catalogue=src("shop-catalogue.js");

describe("QA audit Phase 0 — failing source baselines, no network",()=>{
  it("UX-01 Buy now does not erase the bag on either product path",()=>{
    expect(productJs).not.toMatch(/const items\s*=\s*buy\s*\?\s*\[\]\s*:\s*cart\(\)/);
    expect(shop).not.toMatch(/if\s*\(replace\)\s*\{\s*saveCart\(\[/);
  });
  it("UX-03 Clear bag requires an actual confirmation control",()=>{
    expect(checkout).toContain('document.createElement("dialog")');
    expect(checkout).toContain("clearDialog.showModal()");
    expect(checkout).not.toMatch(/\$\("clearCart"\)\.onclick\s*=\s*\(\)\s*=>\s*\{\s*cart\s*=\s*\[\]/);
  });
  it("UX-04 Razorpay readiness cannot auto-select the TEST method",()=>{
    expect(checkout).not.toMatch(/status\.available\s*&&\s*!paymentChoiceTouched[\s\S]{0,130}gateway\.checked\s*=\s*true/);
  });
  it("UX-05 Field validation and button state share accessible inline errors",()=>{
    expect(checkout).toContain("aria-invalid");
    expect(checkout).toContain("aria-disabled");
    expect(checkout).toContain("aria-describedby");
  });
  it("UX-06 Discount uses a visible subtraction sign",()=>{
    expect(checkout).not.toMatch(/\$\("discount"\)\.textContent\s*=\s*money\(discount\)/);
  });
  it("UX-10 Checkout progress announces the current step",()=>{
    expect(order).toContain('aria-current="step"');
    expect(order).toMatch(/<ol\b[^>]*class="checkout-progress"/);
  });
  it("UX-11 Categories require visible stock or non-clickable coming-soon state",()=>{
    expect(shop).toContain("mobileCategoryStockCounts.get(normalizeCategory(bucket.label))>0");
    expect(shop).toContain('{count:"exact",head:true}');
  });
  it("UX-12 Mobile product header has a reachable back action",()=>{
    expect(mobileCss).not.toContain('body:has(.detail-page) .topbar .nav > a[href="index.html#products"]{display:none!important}');
    expect(product).toMatch(/aria-label="Back to jewellery"/);
  });
  it("UX-13 Mobile input text receives 16px or larger overrides",()=>{
    expect(mobileCss).toContain(".account-auth-form :is(input,select,textarea)");
    expect(mobileCss).toContain("select,textarea {font-size:16px!important}");
  });
  it("UX-15 Mobile carousel dots expose a 24px+ touch hitbox",()=>{
    expect(mobileCss).toMatch(/\.promotion-carousel-dots button[^}]*min-width:\s*24px/s);
  });
  it("UX-16 A catalogue request failure has its own retry control",()=>{
    expect(shop).toContain('id="catalogueRetry"');
    expect(shop).toContain('document.getElementById("productGrid")?.addEventListener("click",event=>');
  });
  it("UX-17 Product quick view has a semantic activation target",()=>{
    expect(shop).toMatch(/Quick view:/);
    expect(shop).not.toMatch(/card\.addEventListener\("click"/);
  });
  it("UX-18 Image counter cannot read 1 / 0",()=>{
    expect(shop).toContain("(images.length?'<span");
    expect(shop).toContain("gallery-count");
  });
  it("UX-19 A shared price formatter is used across pages",()=>{
    expect(shop).toContain("formatINR(");
    expect(productJs).toContain("formatINR(");
    expect(checkout).toContain("formatINR(");
  });
  it("UX-20 Product purchase labels consistently say Add to bag",()=>{
    expect(shop).not.toContain(">Add to Cart</button>");
    expect(order).not.toContain(">Cart <");
    expect(product).not.toContain(">My bag");
  });
  it("UX-21 Gateway status is contextual to the selected method",()=>{
    expect(checkout).toContain("providerPanel.hidden=!razorpayMethodAllowed()||!gatewaySelected");
    expect(order).toContain('id="razorpayInlineStatus"');
  });
  it("Baseline safety: frontend never embeds a server-only secret or payment key",()=>{
    expect(order).not.toContain("RAZORPAY_KEY_SECRET");
    expect(checkout).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(catalogue).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(siteCss).toContain(".product-modal");
    expect(productCss).toContain(".detail-grid");
  });
});