import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8");
const home=read("index.html"),checkout=read("order.html"),product=read("product.html");
const shopJs=read("content.js"),mobileJs=read("mobile-storefront.js");
const productJs=read("product-page.js"),checkoutJs=read("order.js");
const css=read("mobile-storefront.css");
const dist=read("scripts/build-cloudflare.mjs");
const ids=html=>[...html.matchAll(/\\bid="([^"]+)"/g)].map(match=>match[1]);

describe("Rainbow mobile storefront wiring",()=>{
  it("loads the isolated mobile stylesheet on customer pages, not staff or admin pages",()=>{
    for(const page of [home,checkout,product])expect(page).toContain('href="mobile-storefront.css?');
    expect(css).toContain("@media(max-width:767px)");
    expect(css).toContain(".mobile-category-section{display:none}");
    expect(css).toContain(".mobile-shop-nav,.mobile-shop-intro{display:none}");
  });
  it("keeps categories before the promotion and product section",()=>{
    expect(home.indexOf('id="mobileCategorySection"')).toBeGreaterThan(-1);
    expect(home.indexOf('id="mobileCategorySection"')).toBeLessThan(home.indexOf('id="featuredPromotion"'));
    expect(home.indexOf('id="mobileCategorySection"')).toBeLessThan(home.indexOf('id="products"'));
    expect(home).toContain('id="mobileCategoryTrack"');
    expect(home).toContain('id="mobileCategorySeeAll"');
  });
  it("has unique IDs on each customer screen",()=>{
    for(const html of [home,checkout,product]){
      const all=ids(html);
      expect(all.length).toBe(new Set(all).size);
    }
  });
  it("connects category selection and search to the existing catalogue",()=>{
    expect(shopJs).toContain("function renderMobileCategories()");
    expect(shopJs).toContain('mobileTrack?.addEventListener("click"');
    expect(shopJs).toContain("resetCatalogue();");
    expect(shopJs).toContain('document.getElementById("siteSearchForm")?.addEventListener("submit"');
    expect(shopJs).toContain('document.getElementById("mobileCategorySeeAll")?.addEventListener("click"');
    expect(shopJs).toContain('section.classList.toggle("is-expanded")');
  });
  it("connects wishlist, account and bag to the original customer actions",()=>{
    for(const id of ["wishlistToggle","accountOpen","cartCount","mobileBagCount","mobileShopToast"])
      expect(ids(home)).toContain(id);
    expect(home).toContain('href="order.html"');
    expect(mobileJs).toContain("wishlist?.click()");
    expect(mobileJs).toContain("account?.click()");
    expect(mobileJs).toContain('const syncBag=()=>');
    expect(shopJs).toContain('document.getElementById("accountOpen")?.addEventListener');
  });
  it("preserves real product routes and payment actions",()=>{
    expect(shopJs).toContain('href=\'product.html?sku=');
    expect(shopJs).toContain('data-add-cart');
    expect(productJs).toContain('document.createElement("button")');
    for(const id of ["placeOrder","payRazorpay","paymentReference","total","state"])
      expect(ids(checkout)).toContain(id);
    expect(checkoutJs).toContain('$("placeOrder").onclick=placeOrder');
    expect(checkoutJs).toContain('selectedPaymentMethod');
  });
  it("publishes the mobile assets in Cloudflare's explicit file allowlist",()=>{
    expect(dist).toContain('"mobile-storefront.css","mobile-storefront.js"');
    expect(home).toContain('src="mobile-storefront.js?');
  });
});
