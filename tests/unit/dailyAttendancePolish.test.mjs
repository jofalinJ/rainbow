import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../../admin/my-attendance.js",import.meta.url),"utf8");
function screen(record){
  const fields=new Map();
  const get=id=>{if(!fields.has(id))fields.set(id,{textContent:"",disabled:true,addEventListener(){}});return fields.get(id);};
  const rpc=vi.fn();
  const context=vm.createContext({Intl,Date,console,document:{getElementById:get,readyState:"loading",addEventListener(){}}});
  vm.runInContext(source,context);
  context.record=record;context.rpc=rpc;
  vm.runInContext("attendanceReady=true;myAttendanceClient={rpc};myAttendanceRecord=record;renderMyAttendance();",context);
  return {get,rpc,context,run:code=>vm.runInContext(code,context),act:action=>vm.runInContext(`recordAttendanceAction(${JSON.stringify(action)})`,context)};
}
describe("daily attendance screen",()=>{
  it("offers check-in for a loaded new day and waits to offer checkout",()=>{
    const ui=screen(null);expect(ui.get("checkInButton").disabled).toBe(false);expect(ui.get("checkInButton").textContent).toBe("Check in");expect(ui.get("checkOutButton").disabled).toBe(true);
  });
  it("labels the saved daily check-in and does not send another request",async()=>{
    const ui=screen({check_in:"09:00:00"});expect(ui.get("checkInButton").textContent).toBe("Checked in today");expect(ui.get("checkInButton").disabled).toBe(true);expect(ui.get("checkOutButton").disabled).toBe(false);await ui.act("check_in");expect(ui.rpc).not.toHaveBeenCalled();
  });
  it("keeps check-in locked after checkout and labels the completed day",async()=>{
    const ui=screen({check_in:"09:00:00",check_out:"17:00:00"});expect(ui.get("checkInButton").textContent).toBe("Checked in today");expect(ui.get("checkOutButton").textContent).toBe("Checked out");expect(ui.get("checkInButton").disabled).toBe(true);expect(ui.get("checkOutButton").disabled).toBe(true);await ui.act("check_in");await ui.act("check_out");expect(ui.rpc).not.toHaveBeenCalled();
  });
  it("refreshes an old loaded day before offering the new day's check-in",async()=>{
    const ui=screen({check_in:"09:00:00",check_out:"17:00:00"});
    const maybeSingle=vi.fn().mockResolvedValue({data:null,error:null});
    const query={select(){return this;},eq(){return this;},maybeSingle};
    ui.context.query=query;
    ui.run('myAttendanceUserId="employee";myAttendanceClient={from:()=>query};loadedAttendanceDay="2026-10-17";indiaToday=()=>"2026-10-18";');
    await ui.run("refreshAttendanceDay()");
    expect(maybeSingle).toHaveBeenCalledOnce();expect(ui.get("checkInButton").disabled).toBe(false);expect(ui.get("checkInButton").textContent).toBe("Check in");expect(ui.get("checkOutButton").disabled).toBe(true);
  });
});
