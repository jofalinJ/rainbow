import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=file=>readFileSync(new URL("../../"+file,import.meta.url),"utf8");
const html=read("admin/offline-drafts.html"),js=read("admin/offline-drafts.js");
const sw=read("admin/offline-sw.js"),nav=read("admin/app.js");
describe("device-only offline drafts are not sales",()=>{
 it("uses IndexedDB for local unsold SKU notes",()=>{
  expect(js).toContain("indexedDB.open");
  expect(js).toContain("DRAFT_NOT_SOLD");
  expect(js).toContain("crypto.randomUUID");
  expect(js).toContain('store=>store.put(');
 });
 it("never sends invoice/stock/payment requests",()=>{
  expect(js).not.toMatch(/\.rpc\(/);
  expect(html).toContain("NOT AN INVOICE OR A SALE");
  expect(html).toContain("No payments or completed sales offline");
 });
 it("caches only device draft UI, never API responses",()=>{
  expect(sw).toContain("STATIC");
  expect(sw).toContain('offline-drafts.html');
  expect(sw).toContain('offline-drafts.js');
  expect(sw).toContain('event.request.method!=="GET"');
  expect(sw).toMatch(/(?:u|url)\.origin!==self\.location\.origin/);
  expect(nav).toContain('href:"offline-drafts.html"');
 });
});
