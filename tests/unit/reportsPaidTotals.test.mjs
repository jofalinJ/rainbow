import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");

function render(orders){
 const nodes=new Map();
 const node=id=>{
   if(!nodes.has(id))nodes.set(id,{textContent:"",innerHTML:"",value:"",addEventListener:()=>{}});
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
 return {get:id=>node(id).textContent,rows:node("reportRows").innerHTML,context,node};
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
 it("retrieves more than 1,000 orders instead of silently underreporting",async()=>{
  const rows=Array.from({length:1002},(_,i)=>({id:String(i),total_amount:1,payment_status:"paid"}));
  let calls=0;
  const client={from:()=>({
   select(){return this;},
   order(){return this;},
   range(start,end){this.start=start;this.end=end;return this;},
   async abortSignal(){
    calls++;
    return {data:rows.slice(this.start,this.end+1),error:null};
   }
  })};
  const context={
   bootSupabase:()=>client,
   requireSession:()=>({then:()=>({catch:()=>{}})}),
   document:{getElementById:()=>null,querySelector:()=>null},
   console,Date,Intl,Number,AbortController,setTimeout,clearTimeout
  };
  runInNewContext(read("admin/reports.js"),context);
  const all=await context.fetchAllReportOrders(new AbortController());
  expect(all.length).toBe(1002);
  expect(calls).toBe(2);
 });
 it("summarizes confirmed paid payment methods without counting refunds or failures",()=>{
  const r=render([]);
  const totals=r.context.sumPaidMethods([
   {status:"paid",method:"cash",amount:100,orders:{status:"confirmed",payment_status:"paid"}},
   {status:"paid",method:"razorpay",amount:50.99,orders:{status:"confirmed",payment_status:"paid"}},
   {status:"paid",method:"cash",amount:9999,orders:{status:"refunded",payment_status:"paid"}},
   {status:"failed",method:"upi",amount:1000,orders:{status:"cancelled",payment_status:"failed"}},
   {status:"paid",method:"card",amount:25,orders:{status:"confirmed",payment_status:"paid"}}
  ]);
  expect(totals.cash).toBe(100);
  expect(totals.razorpay).toBe(50.99);
  expect(totals.upi).toBe(0);
  expect(totals.card).toBe(25);
 });
 it("uses the India calendar boundary for daily closing",()=>{
  const r=render([]);
  const [start,end]=r.context.shopDayWindow(new Date("2026-11-20T18:40:00Z"));
  expect(start).toBe("2026-11-20T18:30:00.000Z");
  expect(end).toBe("2026-11-21T18:30:00.000Z");
 });
 it("flags cash shortage or overage without saving a drawer total",()=>{
  const r=render([]);
  r.node("closingCashCount").value="95";
  runInNewContext("expectedClosingCash=100",r.context);
  r.context.updateCashDifference();
  expect(r.get("closingCashDifference")).toContain("Cash short by");
  expect(r.get("closingCashDifference")).toContain("₹5");
  expect(read("admin/reports.html")).toContain('id="closingCashCount"');
 });
 it("loads the versioned paid-sales script in the report page",()=>{
  const html=read("admin/reports.html");
  expect(html).toContain("reports.js?v=20261121-paid-sales");
  expect(html).toContain("Today's paid orders");
 });
});