import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("zero-stock storefront remains useful to shoppers",()=>{
  const home=read("index.html"),script=read("content.js");
  it("directs customers to the existing shop contact section when no catalogue exists",()=>{
    expect(home).toContain('id="contact"');
    expect(script).toContain("Our online collections are being prepared.");
    expect(script).toContain("Our online catalogue is being prepared.");
    expect(script).toContain("<a href='#contact'>Contact the store</a>");
    expect(script).toContain("<a href='#contact'>Contact our store</a>");
    expect(script).not.toContain("No jewellery is available right now.");
  });
  it("preserves search and wishlist empty messages and connectivity error recovery",()=>{
    expect(script).toContain("Nothing saved yet. Tap a heart to save a design.");
    expect(script).toContain("No matches. Try another search or category.");
    expect(script).toContain("The catalogue could not be loaded.");
    expect(script).toContain("Retry loading below");
  });
  it("serves the new script rather than cached old empty-state content",()=>{
    expect(home).toContain("content.js?v=20261103-empty-catalogue");
  });
});
