import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../../supabase/migrations/20261121203000_verified_customer_order_tracking.sql",import.meta.url),"utf8");
const fixture=readFileSync(new URL("../../tests/sql/verified-customer-tracking-behavior.sql",import.meta.url),"utf8");
describe("customer-account order and shipment privacy",()=>{
 it("checks the current verified email stored in private auth.users",()=>{
  expect(sql).toContain("FROM auth.users current_user_record");
  expect(sql).toContain("current_user_record.email_confirmed_at IS NOT NULL");
  expect(sql).toContain("current_user_record.id=(select auth.uid())");
  expect(sql).toContain("lower(trim(c.email))=lower(trim(current_user_record.email))");
  expect(sql).not.toMatch(/auth\.jwt\s*\(/i);
 });
 it("keeps both stable customer RPC signatures and existing business filters",()=>{
  expect(sql).toContain("public.track_my_online_orders()");
  expect(sql).toContain("public.track_my_order_shipments()");
  expect(sql).toContain("o.status::text not in ('delivered', 'cancelled', 'refunded')");
  expect(sql).toContain("o.source::text='online'");
  expect(sql).toContain("o.source::text = 'online'");
 });
 it("allows signed-in customers only, never anonymous tracking",()=>{
  expect(sql).toContain("FROM PUBLIC, anon");
  expect(sql).toContain("TO authenticated");
  expect(fixture).toContain("unverified");
  expect(fixture).toContain("Stale JWT email claim");
  expect(fixture).toContain("Old email claim");
 });
});
