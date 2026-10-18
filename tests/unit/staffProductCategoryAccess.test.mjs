import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");

const products=read("admin/products.js");
const bulk=read("admin/bulk-products.js");
const html=read("admin/products.html");

describe("unified staff product category and import access",()=>{
 it("allows all active staff in products and bulk imports",()=>{
   const roleCheck='["admin","cashier","inventory_staff"].includes(profile.role)';
   expect(products).toContain(roleCheck);
   expect(bulk).toContain(roleCheck);
   expect(products).toContain("!profile.active");
   expect(bulk).toContain("!profile.active");
   expect(products).not.toContain('!["admin","inventory_staff"].includes(profile.role)');
   expect(bulk).not.toContain('!["admin","inventory_staff"].includes(profile.role)');
 });
 it("initializes categories only after the permitted profile is checked",()=>{
   const profilePos=products.indexOf("const profile=await getMyProfile();");
   const categoryPos=products.indexOf('cats=await sb("categories?select=');
   const setupPos=products.indexOf('updateFields();setupVariantBox();');
   expect(profilePos).toBeGreaterThan(0);
   expect(categoryPos).toBeGreaterThan(profilePos);
   expect(setupPos).toBeGreaterThan(categoryPos);
   expect(products).toContain('$("category").onchange=updateFields;');
 });
 it("loads fresh corrected scripts on the Products page",()=>{
   expect(html).toContain('products.js?v=20261018-staff-role-fix');
   expect(html).toContain('bulk-products.js?v=20261018-staff-role-fix');
 });
});
