import {describe,it,expect} from "vitest";
import {readFileSync,readdirSync,existsSync,statSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=(file)=>readFileSync(path.join(root,file),"utf8");

describe("public brand assets are real and referenced",()=>{
  it("keeps only real, referenced brand image files",()=>{
    const assets=readdirSync(path.join(root,"assets/brand")).sort();
    expect(assets).toEqual(["length.png","logo2.png","rainbow-logo.png"]);
    for(const file of assets)expect(statSync(path.join(root,"assets/brand",file)).size).toBeGreaterThan(100);
  });

  it("retains the jewellery length guide and both live logo images",()=>{
    expect(read("content.js")).toContain("assets/brand/length.png");
    expect(read("index.html")).toContain("assets/brand/logo2.png");
    expect(read("index.html")).toContain("assets/brand/rainbow-logo.png");
  });

  it("does not retain retired QR/payment images or one-byte placeholder files",()=>{
    for(const file of ["pay.png","logo2","README.md"])
      expect(existsSync(path.join(root,"assets/brand",file))).toBe(false);
    expect(read("scripts/verify-static.mjs")).toContain("Unreferenced brand asset should not be deployed");
  });

  it("documents the actual Worker-based Razorpay checkout rather than a disabled fake payment page",()=>{
    const guide=read("docs/RAZORPAY_SETUP.md");
    expect(guide).toContain("Cloudflare Worker");
    expect(guide).toContain("Razorpay Standard Checkout only");
    expect(guide).toContain("not");
    expect(guide).not.toContain("shows payment types as disabled previews");
  });
});
