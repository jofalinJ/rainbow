import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {deliveryFeeForState} from "../../order-pricing.mjs";

const read=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8");
const checkout=read("order.js"),html=read("order.html"),worker=read("proposed-backend/manual-upi-routes.js");
const root={};
vm.runInNewContext(read("shop-catalogue.js"),{window:root});
const formatINR=root.RainbowCatalogue.formatINR;
const roundMoney=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;

function renderPreview(state){
  const marker=checkout.match(/function totals\(\)\{([\s\S]*?)\n  \}/);
  if(!marker)throw new Error("Checkout amount renderer not found");
  const values=new Map();
  const $=id=>{
    if(!values.has(id))values.set(id,{value:id==="state"?state:"",textContent:""});
    return values.get(id);
  };
  const cart=[{variant_id:"test",quantity:1,product:{selling_price:1000}}];
  const calc=new Function("cart","roundMoney","deliveryFeeForState","$","formatINR","lockedAmounts","pending",
    "return function totals(){"+marker[1]+"\n}");
  const result=calc(cart,roundMoney,deliveryFeeForState,$,formatINR,()=>null,null)();
  return {result,values};
}

describe("UX-06 pricing display: no formula changes",()=>{
  it.each([
    ["Tamil Nadu",50,1049.10],["Kerala",100,1099.10]
  ])("%s is accurate for ₹1,000", (state,shipping,total)=>{
    const view=renderPreview(state);
    expect(view.result.subtotal).toBe(1000);
    expect(view.result.discount).toBe(30);
    expect(view.result.cgst).toBe(14.55);
    expect(view.result.sgst).toBe(14.55);
    expect(view.result.shipping).toBe(shipping);
    expect(view.result.total).toBe(total);
    expect(view.values.get("discount").textContent).toBe("−₹30");
    expect(view.values.get("total").textContent).toBe(formatINR(total));
  });
});
describe("UX-07 matching compact and sidebar breakdown",()=>{
  it("renders matching values from one model without shifting the summary",()=>{
    const view=renderPreview("Tamil Nadu");
    for(const [full,inline] of [
      ["subtotal","paymentMiniSubtotal"],["discount","paymentMiniDiscount"],
      ["cgst","paymentMiniCgst"],["sgst","paymentMiniSgst"],
      ["delivery","paymentMiniDelivery"],["total","paymentMiniTotal"]
    ])expect(view.values.get(full).textContent).toBe(view.values.get(inline).textContent);
    expect(html.indexOf('id="paymentPriceBreakdown"')).toBeLessThan(html.indexOf('class="payment-methods"'));
    expect(html.indexOf('id="summaryHeading"')).toBeGreaterThan(html.indexOf('id="checkoutQR"'));
    expect(view.values.get("paymentPriceHeadline").textContent).toMatch(/^Estimated /);
  });
});
describe("UX-08 merchant identity fail-safe",()=>{
  it("never manufactures UPI address or app deep link without verified merchant configuration",()=>{
    expect(checkout).not.toContain("upi://pay?");
    expect(html).not.toContain('href="upi://pay');
    expect(read("proposed-backend/ux-02-manual-upi-A2-contract.md"))
      .toContain("does not add a");
  });
});
describe("UX-09 recoverable pending order, no client-paid claim",()=>{
  it("preserves a minimal 24h receipt and never starts a second order on status/correction",()=>{
    expect(checkout).toContain('const PENDING_KEY="rainbow_pending_upi_v1"');
    expect(checkout).toContain("const PENDING_TTL=24*60*60*1000");
    expect(checkout).toContain("phone_last4:");
    expect(checkout).toContain('pendingApi("/api/upi/status"');
    expect(checkout).toContain('pendingApi("/api/upi/correct"');
    expect(checkout).toContain("if(pendingRecord){renderPendingBanner();return;}");
    expect(checkout).toContain('data.state==="verified"&&data.payment_status==="paid"');
    expect(checkout).toContain('["declined","cancelled"].includes(data.state)');
    expect(checkout).not.toContain('sb.rpc("create_online_order"');
    expect(worker).toContain('get_manual_upi_checkout_status');
    expect(worker).toContain('correct_manual_upi_reference');
    expect(html).toContain('id="pendingCheckoutBanner"');
  });
});
describe("UX-10 truthful semantic progress",()=>{
  it("announces current and completed stages from shared checkout state",()=>{
    expect(html).toContain('<ol class="checkout-progress">');
    expect(html).toContain('id="bagStep"');
    expect(html).toContain('id="addressStep"');
    expect(html).toContain('id="paymentStep"');
    expect(html).toContain('aria-current="step"');
    expect(checkout).toContain("function updateCheckoutProgress()");
    expect(checkout).toContain('marker.textContent=complete?"✓":String(i+1)');
    expect(checkout).toContain("updateCheckoutProgress();");
  });
});
