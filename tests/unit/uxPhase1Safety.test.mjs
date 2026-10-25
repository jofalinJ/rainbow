import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8");
const shop=source("content.js");
const checkout=source("order.js");
const orderHtml=source("order.html");
const product=source("product-page.js");
const catalogueSource=source("shop-catalogue.js");
const backend=source("proposed-backend/ux-02-manual-upi-A2-contract.md");

describe("Phase 1 source safety: no real money or production side effects",()=>{
  it("UX-05 uses one validator for QR readiness and the submit handler",()=>{
    expect(checkout).toContain("function deliveryErrors()");
    expect(checkout).toContain("paintDeliveryErrors(errors)");
    expect(checkout).toContain("focusDeliveryError(errors)");
    expect(checkout).toContain('button.setAttribute("aria-disabled",String(!actionReady))');
    expect(checkout).toContain("aria-describedby");
    expect(orderHtml).toContain('id="phone" type="tel"');
    expect(orderHtml).toContain('id="email" type="email"');
    expect(orderHtml).toContain('id="pin" type="text" inputmode="numeric"');
  });
  it("UX-02 never places a real-money QR in initial HTML or uses legacy order creation",()=>{
    expect(orderHtml).not.toContain('<img src="assets/brand/pay.png"');
    expect(orderHtml).toContain('id="checkoutQR"');
    expect(checkout).toContain('pendingApi("/api/upi/prepare"');
    expect(checkout).toContain('pendingApi("/api/upi/submit"');
    expect(checkout).toContain('data.state!=="awaiting_payment"');
    expect(checkout).toContain('paise(data.total_amount)!==paise(totals().total)');
    expect(checkout).not.toContain('sb.rpc("create_online_order"');
    expect(backend).toContain("Do **not** fall back to the old RPC.");
  });
  it("UX-04 never changes the selected payment method on readiness",()=>{
    expect(orderHtml).toContain('id="payUpi" type="radio" name="paymentMethod" value="upi" checked');
    expect(checkout).not.toContain("gateway.checked=true");
    expect(checkout).not.toContain("manual.checked=true");
    expect(checkout).toContain('get("test")==="1"');
    expect(checkout).toContain('gatewayOption.style.display=razorpayTestAllowed?"":"none"');
    expect(checkout).toContain('razorpayMode==="live"?razorpayLiveAllowed:razorpayTestAllowed');
    expect(checkout).toContain('expectedMode:selectedRazorpayMode');
    expect(checkout).toContain('selectedRazorpayMode===razorpayMode');
  });
  it("UX-01 both product purchase paths use one isolated Buy now API",()=>{
    expect(product).toContain("RainbowCatalogue?.startBuyNow(line)");
    expect(shop).toContain("RainbowCatalogue?.startBuyNow(makeCartItem(");
    expect(checkout).toContain("readBuyNow()");
    expect(checkout).toContain('link.textContent="← Back to bag"');
    expect(checkout).toContain("if(buyNowActive)");
    expect(product).not.toContain("const items=buy?[]:cart()");
    expect(shop).not.toContain("if(replace){saveCart([");
  });
  it("UX-03 deletion is impossible until dialog confirmation",()=>{
    expect(checkout).toContain('document.createElement("dialog")');
    expect(checkout).toContain('clearDialog.showModal()');
    expect(checkout).toContain('keepBag.focus()');
    expect(checkout).toContain('clearDialog.addEventListener("close"');
    expect(checkout).toContain('confirmClear.addEventListener("click"');
    expect(checkout).not.toContain('$("clearCart").onclick=()=>{cart=[]');
  });
});

describe("Phase 1 Buy now helper: session isolation",()=>{
  function setup(){
    const session=new Map(),writes=[];
    const fakeSession={
      getItem:key=>session.has(key)?session.get(key):null,
      setItem:(key,value)=>session.set(key,String(value)),
      removeItem:key=>session.delete(key)
    };
    const window={};
    vm.runInNewContext(catalogueSource,{window,sessionStorage:fakeSession});
    return {api:window.RainbowCatalogue,session,writes};
  }
  const sample={variant_id:"test-variant",quantity:1,product:{id:"test-product",product_name:"Test item",selling_price:1000}};
  it("persists only the buy-now selection in sessionStorage",()=>{
    const {api,session}=setup();
    expect(api.startBuyNow(sample)).toBe(true);
    expect(session.size).toBe(1);
    expect(session.has("rainbow_buy_now_v1")).toBe(true);
    expect(api.readBuyNow().variant_id).toBe("test-variant");
    api.clearBuyNow();
    expect(api.readBuyNow()).toBeNull();
  });
  it("rejects an invalid or unavailable selection",()=>{
    const {api}=setup();
    expect(api.startBuyNow({variant_id:"test",quantity:0,product:{}})).toBe(false);
    expect(api.startBuyNow(null)).toBe(false);
    expect(api.readBuyNow()).toBeNull();
  });
});