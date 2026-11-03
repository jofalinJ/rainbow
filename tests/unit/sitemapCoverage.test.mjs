import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const sitemap=readFileSync(new URL("../../sitemap.xml",import.meta.url),"utf8");
describe("public sitemap hygiene",()=>{
  it("includes stable customer help and policy URLs",()=>{
    for(const path of [
      "/","/privacy-policy.html","/shipping-policy.html",
      "/returns-and-refunds.html","/terms-and-conditions.html","/sitemap.html"
    ]){
      expect(sitemap).toContain("<loc>https://rainbowgoldcovering.com"+path+"</loc>");
    }
  });
  it("does not publish staff, invoice, checkout or account recovery URLs",()=>{
    for(const path of ["/admin/","/staff/","/invoice.html","/order.html","/reset-password.html"])
      expect(sitemap).not.toContain("<loc>https://rainbowgoldcovering.com"+path);
  });
  it("uses a valid XML URL set with unique absolute URL entries",()=>{
    expect(sitemap).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    const paths=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
    expect(paths.length).toBe(new Set(paths).size);
    expect(paths.every(url=>new URL(url).origin==="https://rainbowgoldcovering.com")).toBe(true);
  });
});
