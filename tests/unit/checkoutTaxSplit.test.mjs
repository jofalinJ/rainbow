import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {gstComponentsForState} from "../../order-pricing.mjs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("destination-aware GST for Tamil Nadu merchant",()=>{
  it("shows separate CGST and SGST for Tamil Nadu",()=>{
    expect(gstComponentsForState(100,"Tamil Nadu")).toEqual({
      cgst:1.5,sgst:1.5,igst:0,mode:"intra"
    });
  });
  it("shows IGST, not CGST/SGST, for interstate delivery",()=>{
    for(const state of ["Kerala","Karnataka","Delhi","Puducherry"]){
      expect(gstComponentsForState(100,state)).toEqual({
        cgst:0,sgst:0,igst:3,mode:"inter"
      });
    }
  });
  it("does not invent a tax split for missing or invalid delivery state",()=>{
    for(const state of ["","Unknown State",null])expect(gstComponentsForState(100,state)).toBeNull();
    expect(gstComponentsForState(-1,"Tamil Nadu")).toBeNull();
    expect(gstComponentsForState(Number.NaN,"Kerala")).toBeNull();
  });
  it("renders tax rows according to selected state without changing server verification",()=>{
    const html=read("order.html"),js=read("order.js");
    for(const id of ["cgstLine","sgstLine","igstLine","igst"]){
      expect(html).toContain('id="'+id+'"');
    }
    expect(js).toContain("gstComponentsForState(taxable");
    expect(js).toContain('$("igstLine").hidden=gst?.mode!=="inter"');
    expect(js).toContain("taxable+cgst+sgst+igst+shipping");
    expect(js).toContain("displayTotal:totals().total");
  });
});

describe("invoice presentation mirrors persisted tax kind",()=>{
  const render=data=>{
    const context={window:{},location:{pathname:"/invoice.html"}};
    runInNewContext(read("invoice-template.js"),context);
    const target={innerHTML:""};
    context.window.RainbowInvoice.render({
      invoice_number:"INV-TEST",
      order_number:"RG-TEST",
      issued_at:"2026-11-03T00:00:00Z",
      subtotal:100,discount_amount:0,delivery_fee:100,total_amount:203,
      items:[],...data
    },target);
    return target.innerHTML;
  };
  it("shows only IGST for interstate invoice",()=>{
    const html=render({igst_amount:3,cgst_amount:0,sgst_amount:0});
    expect(html).toContain("IGST");
    expect(html).not.toContain("<span>CGST</span>");
    expect(html).not.toContain("<span>SGST</span>");
  });
  it("shows CGST and SGST for Tamil Nadu invoice",()=>{
    const html=render({igst_amount:0,cgst_amount:1.5,sgst_amount:1.5});
    expect(html).toContain("<span>CGST</span>");
    expect(html).toContain("<span>SGST</span>");
    expect(html).not.toContain("<span>IGST</span>");
  });
});
