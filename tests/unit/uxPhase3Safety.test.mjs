import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const file=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8");
const home=file("index.html"),shop=file("content.js"),product=file("product.html");
const detail=file("product-page.js"),mobile=file("mobile-storefront.css"),css=file("content.css");
const priceCSS=file("order.css");

describe("UX-11 — server-counted stocked category rail",()=>{
  it("does not decide category visibility from the first catalogue page",()=>{
    expect(shop).toContain('select("id,products!inner(category_id,active)",{count:"exact",head:true})');
    expect(shop).toContain('.gt("stock_quantity",0)');
    expect(shop).toContain('mobileCategoryCountsReady=true');
    expect(shop).toContain('mobileCategoryStockCounts.get(normalizeCategory(bucket.label))>0');
    expect(shop).toContain('await withCatalogueTimeout(loadCategoryStockCounts())');
    expect(home).toContain('class="mobile-category-loading"');
  });
});
describe("UX-12 — visible mobile product back action",()=>{
  it("preserves native navigation fallback and returns to storefront history when possible",()=>{
    expect(product).toContain('class="btn btn-light detail-back-link"');
    expect(product).toContain('aria-label="Back to jewellery"');
    expect(detail).toContain('history.back()');
    expect(mobile).not.toContain('body:has(.detail-page) .topbar .nav > a[href="index.html#products"]{display:none!important}');
    expect(mobile).toContain('width:44px;min-width:44px;height:44px');
  });
});
describe("UX-13 — minimum mobile text input sizes",()=>{
  it("keeps form inputs and product pickers at 16px without blocking zoom",()=>{
    expect(mobile).toContain('select,textarea {font-size:16px!important}');
    expect(mobile).toContain('.account-auth-form :is(input,select,textarea)');
    expect(mobile).toContain('.detail-picker');
    expect(home).not.toContain("user-scalable=no");
    expect(product).not.toContain("maximum-scale=1");
  });
});
function luminance(hex){
  const v=hex.replace("#","").match(/.{2}/g).map(n=>parseInt(n,16)/255)
    .map(x=>x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4));
  return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;
}
function contrast(a,b){
  const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
  return (hi+0.05)/(lo+0.05);
}
describe("UX-14 — four mobile low-contrast token pairs",()=>{
  const pairs=[
    ["Payment note","#93837a","#625249","#fff9f7","payment-choice-note"],
    ["Account note","#8a8178","#625953","#ffffff","account-auth-note"],
    ["Checkout step","#9a9189","#615852","#ffffff","checkout-step"],
    ["Product type","#847b75","#63554d","#fffdfa","product-type"]
  ];
  it.each(pairs)("%s passes the normal text contrast floor",(label,before,after,bg,selector)=>{
    expect(contrast(before,bg)).toBeLessThan(4.5);
    expect(contrast(after,bg)).toBeGreaterThanOrEqual(4.5);
    expect(mobile).toContain("color:"+after+"!important");
    expect(selector.length).toBeGreaterThan(0);
  });
});
describe("UX-15 — expanded hitboxes without enlarging artwork",()=>{
  it("has 44px nominal click area or 24px carousel dot pitch",()=>{
    expect(mobile).toContain('.checkout-layout .order-qty button::after');
    expect(mobile).toContain('inset:-3px;z-index:1');
    expect(mobile).toContain('.promotion-carousel-arrow::after');
    expect(mobile).toContain('inset:-5px;z-index:1');
    expect(mobile).toContain('width:24px!important;min-width:24px!important;height:24px!important');
    expect(mobile).toContain('width:11px;height:11px;border-radius:50%');
    expect(priceCSS).toContain('.checkout-layout .order-qty button');
  });
});
describe("UX-16 — loading, true empty, failed, and retry",()=>{
  it("distinguishes error and empty states and avoids listeners on the injected button",()=>{
    expect(shop).toContain('if(!products.length&&paging.error)');
    expect(shop).toContain('if(!products.length&&paging.loading)');
    expect(shop).toContain('No jewellery listed yet.');
    expect(shop).toContain('id="catalogueRetry"');
    expect(shop).toContain('role="alert"');
    expect(shop).toContain('withCatalogueTimeout');
    expect(shop).toContain('Catalogue request timed out');
    expect(shop).toContain('document.getElementById("productGrid")?.addEventListener("click",event=>');
    expect(css).toContain('.catalogue-error button');
    expect(css).toContain('min-height:44px');
  });
});
describe("UX-17 — semantic product Quick view interaction",()=>{
  it("keeps wishlist and Details independent of the full-card button",()=>{
    expect(shop).toContain('class=\'product-card-quick-view\' data-product-open aria-label=\'Quick view: ');
    expect(shop).toContain('card.querySelector("[data-product-open]")?.addEventListener("click",open)');
    expect(shop).not.toContain('card.addEventListener("click"');
    expect(css).toContain('.product-card-quick-view:focus-visible');
    expect(css).toContain('.product-card .product-wishlist-button');
    expect(css).toContain('.product-card .product-card-actions a{position:relative;z-index:2}');
    expect(home).toContain('role="dialog" aria-modal="true" aria-labelledby="modalProductName"');
    expect(shop).toContain('trapDialogFocus(e,modal)');
    expect(shop).toContain('if(e.key==="Escape")');
    expect(shop).toContain('if(restore?.isConnected)restore.focus({preventScroll:true})');
  });
});
