import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const script=readFileSync(new URL("../../admin/app.js",import.meta.url),"utf8");
const start=script.indexOf("async function loadDashboard(){");
const end=script.indexOf("\nlet dashboardLiveChannel=",start);
if(start<0||end<0)throw new Error("Dashboard function boundaries changed");

describe("admin sales dashboard",()=>{
  it("counts only captured paid orders and excludes failed, pending, refunded and cancelled orders",async()=>{
    const now=new Date().toISOString();
    const orders=[
      {id:"paid1111",created_at:now,status:"confirmed",payment_status:"paid",total_amount:1200},
      {id:"pending1",created_at:now,status:"pending",payment_status:"pending",total_amount:99999},
      {id:"failed11",created_at:now,status:"pending",payment_status:"failed",total_amount:9000},
      {id:"cancel11",created_at:now,status:"cancelled",payment_status:"paid",total_amount:6000},
      {id:"refund11",created_at:now,status:"refunded",payment_status:"refunded",total_amount:6000},
      {id:"paid2222",created_at:now,status:"processing",payment_status:"paid",total_amount:300}
    ];
    const dom=new Map();
    const elements={querySelector(selector){
      if(!dom.has(selector))dom.set(selector,{textContent:"",innerHTML:""});
      return dom.get(selector);
    }};
    const sb=vi.fn(async route=>route.startsWith("orders?")?orders:[]);
    const scope={sb,document:elements,Date,console:{error:vi.fn()}};
    runInNewContext(script.slice(start,end)+"\nthis.loadDashboard=loadDashboard;",scope);
    await scope.loadDashboard();
    expect(sb.mock.calls[1][0]).toContain("payment_status");
    expect(dom.get("#sales").textContent).toBe("₹1,500");
    expect(dom.get("#salesMeta").textContent).toBe("2 paid orders today");
    expect(scope.console.error).not.toHaveBeenCalled();
  });
});
