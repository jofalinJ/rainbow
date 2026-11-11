import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("Online Products first-paint loading transition",()=>{
 it("covers the entire viewport instead of placing a loading sentence beside the sidebar",()=>{
  const html=read("admin/owner.html");
  const css=read("admin/owner.css");
  expect(html.indexOf('id="startup"')).toBeLessThan(html.indexOf('id="ownerApp"'));
  expect(html).toContain('class="startup-spinner"');
  expect(html).toContain('Opening your shop catalogue');
  expect(css).toContain("#startup{");
  expect(css).toContain("position:fixed;inset:0;z-index:500");
  expect(css).toContain("min-height:100dvh");
  expect(css).toContain("#startup[hidden]{display:none!important}");
  expect(css).toContain("@media(prefers-reduced-motion:reduce)");
 });
 it("only reveals owner content after both catalogue and role-filtered sidebar complete",()=>{
  const owner=read("admin/owner.js");
  const sidebar=read("admin/app.js");
  const refresh=owner.indexOf("await refresh();",owner.indexOf("async function init(){"));
  const wait=owner.indexOf("const sidebarReady=window.rainbowSidebarReady;",refresh);
  const verified=owner.indexOf("const sidebarProfile=await sidebarReady;",wait);
  const show=owner.indexOf('show(["categories","products","editor","dashboard"].includes(requested)?requested:"categories");',verified);
  const reveal=owner.indexOf('$("ownerApp").hidden=false;',show);
  const finish=owner.indexOf('$("startup").hidden=true;',reveal);
  expect(refresh).toBeGreaterThan(0);
  expect(wait).toBeGreaterThan(refresh);
  expect(verified).toBeGreaterThan(wait);
  expect(show).toBeGreaterThan(verified);
  expect(reveal).toBeGreaterThan(show);
  expect(finish).toBeGreaterThan(reveal);
  expect(owner).toContain('document.documentElement.classList.add("owner-ready")');
  expect(sidebar).toContain("window.rainbowSidebarReady=bootAdminPage()");
  expect(sidebar).toContain("return profile;");
 });
 it("only changes page presentation, not publishing, billing or privilege boundaries",()=>{
  const owner=read("admin/owner.js");
  expect(owner).toContain('const canPublish=()=>state.role==="admin"');
  expect(owner).toContain('await verifyOwner("publish")');
  expect(owner).toContain('async function confirmOnlineVisibility()');
  expect(owner).toContain('erp_online_listings');
  expect(owner).toContain('erp_dispatch_transfer');
  const markup=read("admin/owner.css");
  expect(markup).toContain("owner-ready-appear");
 });
});
