import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

function render(orders){
 const nodes=new Map();
 const node=id=>{
   if(!nodes.has(id))nodes.set(id,{textContent:"",innerHTML:""});
   return nodes.get(id);
 };
 const document={
   getElementById:id=>node(id),
   querySelector:selector=>selector==="#reportRows"?node("reportRows"):null
 };
 const context={
   bootSupabase:()=>({}),
   requireSession:()=>({then:()=>({catch:()=>{}})}),
   document,console,Date,Intl,Number,AbortController,setTimeout,clearTimeout
 };
 runInNewContext(read("admin/reports.js"),context);
 context.renderReports(orders,[{id:"product-1"}]);
 return {get:id=>node(id).textContent,rows:node("reportRows").innerHTML};
}

describe("accounting-safe admin reports",()=>{
 it("counts only paid, non-cancelled orders in sales and today's paid orders",()=>{
  const now=new Date().toISOString();
  const r=render([
   {status:"confirmed",payment_status:"paid",total_amount:100,created_at:now},
   {status:"pending",payment_status:"pending",total_amount:2000,created_at:now},
   {status:"confirmed",payment_status:"failed",total_amount:3000,created_at:now},
   {status:"cancelled",payment_status:"paid",total_amount:4000,created_at:now},
   {status:"refunded",payment_status:"paid",total_amount:5000,created_at:now}
  ]);
  expect(r.get("reportSales")).toBe("₹100");
  expect(r.get("reportTodayOrders")).toBe("1");
  expect(r.get("reportOrders")).toBe("5");
  expect(r.get("reportProducts")).toBe("1");
 });
 it("returns zero sales when all orders are unpaid, but retains them in the order table",()=>{
  const r=render([{order_number:"R-UNPAID",payment_status:"pending",status:"pending",total_amount:899}]);
  expect(r.get("reportSales")).toBe("₹0");
  expect(r.get("reportTodayOrders")).toBe("0");
  expect(r.rows).toContain("R-UNPAID");
 });
 it("loads the versioned paid-sales script in the report page",()=>{
  const html=read("admin/reports.html");
  expect(html).toContain("reports.js?v=20261121-paid-sales");
  expect(html).toContain("Today's paid orders");
 });
});