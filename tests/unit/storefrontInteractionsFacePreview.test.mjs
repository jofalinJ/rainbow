import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {assessLiveFrame,assessPilotSimilarity} from "../../admin/face-preview.mjs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

describe("storefront shopping/navigation refinements",()=>{
 it("places cart beside account and removes redundant courier header icon",()=>{
   const html=read("index.html");
   expect(html).not.toContain('id="orderTrackOpen"');
   expect(html.indexOf('id="accountOpen"')).toBeLessThan(html.indexOf('class="icon-button icon-button-count cart-icon-link"'));
   expect(html.indexOf('class="icon-button icon-button-count cart-icon-link"')).toBeLessThan(html.indexOf('id="wishlistToggle"'));
   expect(html).toContain('id="drawerTrackAction"');
 });
 it("uses genuine category product photos and consistent drawer fonts",()=>{
   const js=read("content.js"),css=read("content.css");
   expect(js).toContain("bucket.products.find(p=>getImage(p))");
   expect(js).toContain("drawer-type-thumb");
   expect(css).toContain(".drawer-type-thumb");
   expect(css).toContain("font-family:inherit!important");
   expect(css).toContain(".storefront-header-row .menu-toggle{width:50px");
 });
 it("cycles only chosen backend promotional product IDs, not generic images",()=>{
   const js=read("content.js");
   expect(js).toContain('from("storefront_promotion_items")');
   expect(js).toContain("promotionProductIds.map");
   expect(js).toContain("schedulePromotionRotation()");
   expect(js).toContain("},5000)");
 });
 it("supports photo swipe and 10-second advance without navigating to different products",()=>{
   const js=read("content.js");
   expect(js).toContain("gallery.addEventListener(\"touchstart\"");
   expect(js).toContain("gallery.addEventListener(\"touchend\"");
   expect(js).toContain("event.stopPropagation()");
   expect(js).toContain("},10000)");
   expect(js).toContain("stopGalleryRotation()");
   expect(js).toContain('data-gallery-index');
 });
 it("routes product help to the official shop WhatsApp and shows help after details",()=>{
   const js=read("content.js");
   expect(js).toContain("https://wa.me/919952436899?text=");
   expect(js).toContain("encodeURIComponent(text)");
   expect(js).toContain("detailsPanel+lengthGuide+");
   const helpIndex=js.indexOf("Contact Rainbow on WhatsApp");
   const detailsIndex=js.indexOf("detailsPanel+lengthGuide+",helpIndex-200);
   expect(detailsIndex).toBeLessThan(helpIndex);
   expect(detailsIndex).toBeGreaterThan(0);
 });
 it("aligns checkout navigation using responsive layout",()=>{
   const css=read("order.css");
   expect(css).toContain("grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)");
   expect(css).toContain("@media(max-width:680px)");
 });
});
describe("optional biometric preview safeguards",()=>{
 it("rejects no face, multiple faces, low confidence or failed liveness",()=>{
   expect(assessLiveFrame([]).ready).toBe(false);
   expect(assessLiveFrame([{},{}]).ready).toBe(false);
   expect(assessLiveFrame([{embedding:[1],faceScore:0.2,real:0.9,live:0.9}]).ready).toBe(false);
   expect(assessLiveFrame([{embedding:[1],faceScore:0.8,real:0.2,live:0.9}]).ready).toBe(false);
   expect(assessLiveFrame([{embedding:[1],faceScore:0.8,real:0.9,live:0.9}]).ready).toBe(true);
 });
 it("requires multiple acceptable similarity frames",()=>{
   expect(assessPilotSimilarity(.7,3)).toBe(true);
   expect(assessPilotSimilarity(.54,3)).toBe(false);
   expect(assessPilotSimilarity(.8,1)).toBe(false);
 });
 it("stores revocable one-time consent and limits private photo reads",()=>{
   const sql=read("supabase/migrations/20261015195500_optional_staff_face_preview_consent.sql");
   expect(sql).toContain("staff_face_preview_consent");
   expect(sql).toContain("withdrawn_at is null");
   expect(sql).toContain("bucket_id='staff-private'");
   expect(sql).toContain("sp.active=true and sp.role in ('cashier','inventory_staff')");
   const html=read("admin/my-attendance.html");
   expect(html).toContain('id="facePilot"');
   expect(html).toContain('id="facePilotConsent"');
   expect(html).toContain('id="facePilotStart"');
   expect(html).toContain("does <strong>not</strong> replace your attendance buttons");
   const js=read("admin/face-preview.mjs");
   expect(js).toContain("staff_face_preview_consent");
   expect(js).toContain('withdrawn_at:new Date().toISOString()');
   expect(js).toContain("does NOT record attendance");
   expect(js).not.toContain('rpc("staff_attendance_action"');
 });
});
