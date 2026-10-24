import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8");
const catalogue=read("shop-catalogue.js");
const shop=read("content.js");
const detail=read("product-page.js");
const checkout=read("order.js");
const storefront=read("index.html");
const product=read("product.html");
const order=read("order.html");
const css=read("content.css");
const mobile=read("mobile-storefront.css");
const root={};
vm.runInNewContext(catalogue,{window:root});
const {formatINR,formatPaise,photoUnavailableMarkup}=root.RainbowCatalogue;

describe("UX-18 no-photo treatment and photo count",()=>{
  it("shares an accessible placeholder on every product surface",()=>{
    const markup=photoUnavailableMarkup();
    expect(markup).toContain('role="img" aria-label="Photo unavailable"');
    expect(markup).toContain("Photo unavailable");
    expect(shop).toContain("catalogue.photoUnavailableMarkup()");
    expect(detail).toContain("window.RainbowCatalogue.photoUnavailableMarkup()");
    expect(css).toContain(".photo-unavailable{");
  });
  it("never creates a photo counter on an empty gallery",()=>{
    expect(shop).toContain("(images.length?'<span");
    expect(shop).toContain('data-gallery-count');
    expect(shop).toContain("+'</span>':'')+'</div>'+");
    expect(detail).toContain("img.hidden=true;");
  });
});
describe("UX-19 INR formatting from integer paise",()=>{
  it.each([
    [1200,"₹1,200"],[1200.5,"₹1,200.50"],[1049.1,"₹1,049.10"],
    [100000,"₹1,00,000"],[0,"₹0"],[-30,"−₹30"]
  ])("%s formats as %s",(input,want)=>{
    expect(formatINR(input)).toBe(want);
  });
  it("uses paise-safe fractions and one shared formatter on all customer surfaces",()=>{
    expect(formatPaise(104910)).toBe("₹1,049.10");
    expect(formatPaise(120050)).toBe("₹1,200.50");
    expect(shop).toContain("const formatINR=window.RainbowCatalogue.formatINR;");
    expect(detail).toContain("const formatINR=window.RainbowCatalogue.formatINR;");
    expect(checkout).toContain("const formatINR=window.RainbowCatalogue.formatINR;");
    expect(shop).toContain("formatINR(order.total_amount)");
    expect(checkout).toContain("formatINR(locked?.total_amount??total)");
    expect(shop).not.toContain('const money=value=>');
    expect(detail).not.toContain('const money=n=>');
    expect(checkout).not.toContain('const money=x=>');
  });
});
describe("UX-20 consistent customer-facing Bag copy",()=>{
  it("uses Bag consistently without renaming code, storage keys or payment CTA",()=>{
    expect(shop).toContain("data-add-cart>Add to bag</button>");
    expect(product).toContain('>Bag <span id="detailCartCount"');
    expect(order).toContain('<h2 id="bagHeading">Bag</h2>');
    expect(storefront).toContain('aria-label="Bag" title="Bag"');
    expect(checkout).toContain("Bag is empty.");
    expect(shop).not.toContain("Add to Cart</button>");
    expect(product).not.toContain(">My bag");
    expect(checkout).toContain('const CART_KEY="rainbow_cart_v1"');
    expect(shop).toContain('const CART_KEY="rainbow_cart_v1"');
    expect(checkout).toContain("Submit UPI reference");
    expect(checkout).toContain("Pay securely · TEST");
  });
});
describe("UX-21 contextual gateway status; manual UPI unaffected",()=>{
  it("hides full gateway panel by method while rendering its status inside Razorpay",()=>{
    expect(order).toContain('id="razorpayInlineStatus" role="status" aria-live="polite"');
    expect(order).toContain('id="gatewayConnection" class="gateway-connection" role="status" aria-live="polite" hidden');
    expect(checkout).toContain('providerPanel.hidden=!razorpayTestAllowed||!gatewaySelected');
    expect(checkout).toContain('inline.textContent=status.available?"Available · TEST only":"Unavailable right now"');
    expect(checkout).toContain("const status=await razorpayTestAvailability()");
    expect(checkout).not.toContain("gateway.checked=true");
    expect(mobile).toContain(".gateway-connection[hidden]{display:none!important}");
    expect(mobile).not.toContain(".gateway-connection.is-online{display:none!important}");
  });
});
