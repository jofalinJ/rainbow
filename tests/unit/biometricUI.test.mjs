import {describe,it,expect,vi,afterEach} from "vitest";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {escapeHTML,indiaToday,timeLabel,durationLabel,biometricError,faceRequest,noticeHTML,noticeReady,captureLiveness} from "../../admin/biometric-ui.mjs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
class Element extends EventTarget{
  constructor(){super();this.hidden=true;this.disabled=false;this.value="";this.textContent="";this.innerHTML="";this.checked=false;this.options=[];this.classes=new Set();this.classList={contains:key=>this.classes.has(key),toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};}
  set className(value){this.classes=new Set(value.split(/\s+/));}get className(){return [...this.classes].join(" ");}
  focus(){}replaceChildren(){}querySelector(){return this.cancel;}querySelectorAll(){return this.options;}addEventListener(...args){super.addEventListener(...args);}
}
function elements(){const values=new Map();return id=>{if(!values.has(id))values.set(id,new Element());return values.get(id);};}
function captureHarness(){const dialog=new Element(),button=new Element();dialog.cancel=button;return {dialog,button,container:new Element(),message:new Element()};}
const session={session_id:"app-session",liveness_session_id:"provider-session",region:"ap-south-1",credentials:{accessKeyId:"temporary-key",secretAccessKey:"temporary-secret",sessionToken:"temporary-token",expiration:"2030-01-01"}};
function scriptContext(file,extra={}){
  const get=elements();const context=vm.createContext({console,Intl,Date,Promise,setInterval:()=>1,clearInterval:()=>{},window:{addEventListener(){}},document:{getElementById:get,readyState:"loading",addEventListener(){},querySelectorAll:()=>[]},location:{replace:vi.fn()},indiaToday,timeLabel,attendanceTimeLabel:timeLabel,durationLabel,escapeHTML,attendanceEscape:escapeHTML,faceRequest,biometricError,noticeHTML,noticeReady,captureLiveness,...extra});
  vm.runInContext(read(file).replace(/^import .*\n/,""),context);return {context,get,run:source=>vm.runInContext(source,context)};
}
afterEach(()=>vi.unstubAllGlobals());
describe("secure liveness UI boundary",()=>{
  it("passes short-lived credentials only to the capture widget and completes on the server",async()=>{
    vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{mediaDevices:{getUserMedia(){}}});
    const ui=captureHarness(),cleanup=vi.fn(),invoke=vi.fn().mockResolvedValue({data:{attendance:{id:"record"}},error:null});let options;
    const result=captureLiveness({client:{functions:{invoke}},start:session,...ui,provider:()=>({mount:(_container,value)=>{options=value;return cleanup;}})});
    await Promise.resolve();expect(options.sessionId).toBe("provider-session");expect(options.credentials).toBe(session.credentials);expect(invoke).not.toHaveBeenCalled();
    await options.onComplete();expect(await result).toEqual({attendance:{id:"record"}});expect(invoke).toHaveBeenCalledExactlyOnceWith("face-attendance",{body:{operation:"complete",session_id:"app-session"}});expect(cleanup).toHaveBeenCalledOnce();expect(ui.dialog.hidden).toBe(true);
  });
  it.each(["NoFace","MultipleFaces","LivenessFailed","NotAllowedError","NotFoundError"])("does not complete or write attendance after provider failure %s",async code=>{
    vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{mediaDevices:{getUserMedia(){}}});const ui=captureHarness(),invoke=vi.fn().mockResolvedValue({data:{}});let options;
    const result=captureLiveness({client:{functions:{invoke}},start:session,...ui,provider:()=>({mount:(_container,value)=>{options=value;return ()=>{};}})});const rejection=expect(result).rejects.toMatchObject({code});await Promise.resolve();options.onError({code,message:"Capture rejected"});await rejection;expect(invoke).toHaveBeenCalledExactlyOnceWith("face-attendance",{body:{operation:"cancel",session_id:"app-session"}});expect(ui.dialog.hidden).toBe(true);
  });
  it("rejects a server face mismatch even after the camera reports capture completion",async()=>{
    vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{mediaDevices:{getUserMedia(){}}});const ui=captureHarness();let options;
    const invoke=vi.fn().mockResolvedValue({data:{code:"FACE_MISMATCH",error:"Face mismatch"}}),result=captureLiveness({client:{functions:{invoke}},start:session,...ui,provider:()=>({mount:(_container,value)=>{options=value;return ()=>{};}})});
    const rejection=expect(result).rejects.toMatchObject({code:"FACE_MISMATCH"});await Promise.resolve();await options.onComplete();await rejection;expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("waits for the server result once completion starts and ignores later widget callbacks",async()=>{
    vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{mediaDevices:{getUserMedia(){}}});const ui=captureHarness();let options,complete;
    const invoke=vi.fn().mockImplementation(()=>new Promise(resolve=>{complete=resolve;})),result=captureLiveness({client:{functions:{invoke}},start:session,...ui,provider:()=>({mount:(_container,value)=>{options=value;return ()=>{};}})});await Promise.resolve();const completing=options.onComplete();options.onError({code:"NotReadableError"});options.onCancel();await options.onComplete();expect(ui.button.disabled).toBe(true);expect(ui.dialog.hidden).toBe(false);expect(invoke).toHaveBeenCalledTimes(1);complete({data:{attendance:{id:"verified"}},error:null});await completing;expect(await result).toEqual({attendance:{id:"verified"}});expect(ui.dialog.hidden).toBe(true);expect(ui.button.disabled).toBe(false);
  });
  it("cancels capture and closes the camera without a completion request",async()=>{
    vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{mediaDevices:{getUserMedia(){}}});const ui=captureHarness(),invoke=vi.fn().mockResolvedValue({data:{}}),cleanup=vi.fn();const result=captureLiveness({client:{functions:{invoke}},start:session,...ui,provider:()=>({mount:()=>cleanup})});const rejected=expect(result).rejects.toMatchObject({code:"cancelled"});await Promise.resolve();ui.button.dispatchEvent(new Event("click"));await rejected;expect(cleanup).toHaveBeenCalledOnce();expect(invoke).toHaveBeenCalledExactlyOnceWith("face-attendance",{body:{operation:"cancel",session_id:"app-session"}});
  });
  it("does not mount the camera when cancellation arrives before the widget starts",async()=>{
    vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{mediaDevices:{getUserMedia(){}}});const ui=captureHarness(),invoke=vi.fn().mockResolvedValue({data:{}}),mount=vi.fn();
    const result=captureLiveness({client:{functions:{invoke}},start:session,...ui,provider:()=>({mount})});const rejected=expect(result).rejects.toMatchObject({code:"cancelled"});ui.button.dispatchEvent(new Event("click"));await rejected;await Promise.resolve();expect(mount).not.toHaveBeenCalled();expect(ui.dialog.hidden).toBe(true);expect(invoke).toHaveBeenCalledExactlyOnceWith("face-attendance",{body:{operation:"cancel",session_id:"app-session"}});
  });
  it("blocks camera capture in an unsupported browser or insecure context",async()=>{
    vi.stubGlobal("isSecureContext",false);vi.stubGlobal("location",{hostname:"example.com"});const mount=vi.fn();await expect(captureLiveness({client:{},start:session,...captureHarness(),provider:()=>({mount})})).rejects.toMatchObject({code:"https_required"});expect(mount).not.toHaveBeenCalled();
    vi.stubGlobal("isSecureContext",true);vi.stubGlobal("navigator",{});await expect(captureLiveness({client:{},start:session,...captureHarness(),provider:()=>({mount})})).rejects.toMatchObject({code:"camera_unavailable"});
  });
  it("unwraps authenticated endpoint errors and provides useful camera/network guidance",async()=>{
    const client={functions:{invoke:vi.fn().mockResolvedValue({error:{context:{json:async()=>({code:"AUTH_EXPIRED",error:"Sign in again."})}}})}};await expect(faceRequest(client,"status")).rejects.toMatchObject({code:"AUTH_EXPIRED"});expect(biometricError({name:"NotAllowedError"})).toContain("permission");expect(biometricError({name:"NotFoundError"})).toContain("camera");expect(biometricError({code:"AUTH_EXPIRED"})).toContain("sign-in has expired");expect(biometricError({message:"Failed to fetch"})).toContain("connection");
  });
  it("distinguishes a missing or busy camera from denied permission in provider errors",()=>{
    expect(biometricError({code:"CAMERA_ACCESS_ERROR",name:"NotFoundError"})).toContain("No camera is available");expect(biometricError({code:"CAMERA_ACCESS_ERROR",name:"NotReadableError"})).toContain("in use");expect(biometricError({code:"CAMERA_ACCESS_ERROR",name:"NotAllowedError"})).toContain("permission was denied");
  });
});
describe("staff attendance isolation and failure behavior",()=>{
  it("uses only the signed-in account and records no direct attendance writes",()=>{
    const source=read("admin/my-attendance.js"),html=read("admin/my-attendance.html");expect(source).toContain('myAttendanceUserId=session.user.id');expect(source).toContain('.eq("staff_id",myAttendanceUserId)');expect(source).not.toMatch(/\.rpc\(|\.insert\(|\.upsert\(|\.update\(/);expect(html).toContain('<output id="signedInStaffId">');expect(html).not.toContain('face-preview.mjs');expect(html).not.toContain('facePilot');
  });
  it("prevents duplicate or out-of-order starts using loaded attendance state",async()=>{
    const request=vi.fn(),{run}=scriptContext("admin/my-attendance.js",{faceRequest:request});run('attendanceReady=true;biometricStatus={enabled:true,enrolled:true};myAttendanceRecord={check_in_at:"2026-10-15T03:00:00Z"};');await run('recordAttendanceAction("check_in")');run('myAttendanceRecord=null;');await run('recordAttendanceAction("check_out")');expect(request).not.toHaveBeenCalled();
  });
  it("shows verification failed and never claims success after mismatch",async()=>{
    const request=vi.fn().mockResolvedValue(session),capture=vi.fn().mockRejectedValue(Object.assign(new Error("Face mismatch"),{code:"FACE_MISMATCH"}));const {run,get}=scriptContext("admin/my-attendance.js",{faceRequest:request,captureLiveness:capture});run('attendanceReady=true;biometricStatus={enabled:true,enrolled:true};myAttendanceRecord=null;myAttendanceClient={};');await run('recordAttendanceAction("check_in")');expect(request).toHaveBeenCalledWith({},"start_verification",{action:"check_in"});expect(get("todayAttendanceStatus").textContent).toBe("VERIFICATION FAILED");expect(get("selfAttendanceMessage").textContent).toContain("Attendance was not recorded");
  });
});
describe("enrollment consent and audited manual alternative",()=>{
  it("requires configured notice, employee consent and admin identity witness before enrollment",()=>{
    const {run,get}=scriptContext("admin/attendance.js");get("enrollmentStaff").value="employee-id";run('enrollmentStatus={enabled:true,enrolled:false,notice:{version:"v1",retention_days:365,storage_region:"ap-south-1",privacy_contact:"owner@example.com"}};renderEnrollment();');expect(get("beginEnrollment").disabled).toBe(true);get("enrollmentConsent").checked=true;run("renderEnrollment()");expect(get("beginEnrollment").disabled).toBe(true);get("enrollmentWitness").checked=true;run("renderEnrollment()");expect(get("beginEnrollment").disabled).toBe(false);run('enrollmentStatus.enrolled=true;renderEnrollment()');expect(get("beginEnrollment").disabled).toBe(true);expect(get("beginEnrollment").textContent).toBe("Enrollment complete");
  });
  it("shows the next of three samples and blocks enrollment without a complete privacy notice",()=>{
    const {run,get}=scriptContext("admin/attendance.js");get("enrollmentStaff").value="employee-id";get("enrollmentConsent").checked=true;get("enrollmentWitness").checked=true;run('enrollmentStatus={enabled:true,enrolled:false,enrollment:{status:"pending",sample_count:2},notice:{}};renderEnrollment()');expect(get("beginEnrollment").textContent).toBe("Capture live sample 3 of 3");expect(get("beginEnrollment").disabled).toBe(true);expect(get("sampleTwo").textContent).toBe("✓");expect(get("sampleThree").textContent).toBe("3");
  });
  it("resumes a pending enrollment with zero accepted samples after a failed first capture",async()=>{
    const state={enabled:true,enrolled:false,enrollment:{status:"pending",sample_count:0},notice:{version:"v1",retention_days:90,storage_region:"ap-south-1",privacy_contact:"owner@example.com"}};
    const request=vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(state),capture=vi.fn().mockRejectedValue(Object.assign(new Error("Camera check cancelled."),{code:"cancelled"}));const {run,get}=scriptContext("admin/attendance.js",{faceRequest:request,captureLiveness:capture,state});get("enrollmentStaff").value="employee-id";get("enrollmentConsent").checked=true;get("enrollmentWitness").checked=true;run("attendanceClient={};enrollmentStatus=state;renderEnrollment()");expect(get("beginEnrollment").disabled).toBe(false);await run("beginEnrollment()");expect(request).toHaveBeenNthCalledWith(1,{},"next_enrollment_sample",{staff_id:"employee-id"});expect(request).toHaveBeenNthCalledWith(2,{},"status",{staff_id:"employee-id"});expect(get("beginEnrollment").textContent).toBe("Capture live sample 1 of 3");expect(get("beginEnrollment").disabled).toBe(false);
  });
  it.each(["indexing","deleting","active"])("blocks captures but permits deletion for %s enrollment while the service is disabled",status=>{
    const {run,get}=scriptContext("admin/attendance.js",{status});get("enrollmentStaff").value="employee-id";get("enrollmentConsent").checked=true;get("enrollmentWitness").checked=true;run('enrollmentStatus={enabled:false,enrolled:false,enrollment:{status,sample_count:2},notice:{version:"v1",retention_days:90,storage_region:"ap-south-1",privacy_contact:"owner@example.com"}};renderEnrollment()');expect(get("beginEnrollment").disabled).toBe(true);expect(get("deleteEnrollment").disabled).toBe(false);expect(get("enrollmentConsent").disabled).toBe(true);expect(get("enrollmentState").textContent).toContain(status==="indexing"?"Enrollment interrupted. Delete enrollment and start again.":status==="deleting"?"Retry deletion":"Enrollment expired.");if(status==="deleting")expect(get("deleteEnrollment").textContent).toBe("Retry deletion");
  });
  it("allows an administrator to complete deletion with the face service disabled",async()=>{
    const request=vi.fn().mockResolvedValueOnce({deleted:true}).mockResolvedValueOnce({enabled:false,enrolled:false,enrollment:null});const {run,get}=scriptContext("admin/attendance.js",{faceRequest:request});get("enrollmentStaff").value="employee-id";get("deletionReason").value="Employee requested deletion";run('attendanceClient={};enrollmentStatus={enabled:false,enrolled:false,enrollment:{status:"deleting",sample_count:2}};renderEnrollment()');await run("deleteEnrollment()");expect(request).toHaveBeenNthCalledWith(1,{},"delete_enrollment",{staff_id:"employee-id",reason:"Employee requested deletion"});expect(get("enrollmentMessage").textContent).toContain("Biometric enrollment deleted.");expect(get("deleteEnrollment").disabled).toBe(true);
  });
  it("keeps capture blocked and deletion retryable when the deletion response and refresh are lost",async()=>{
    const request=vi.fn().mockRejectedValue(new Error("Failed to fetch"));const {run,get}=scriptContext("admin/attendance.js",{faceRequest:request});get("enrollmentStaff").value="employee-id";get("deletionReason").value="Employee requested deletion";get("enrollmentConsent").checked=true;get("enrollmentWitness").checked=true;run('attendanceClient={};enrollmentStatus={enabled:true,enrolled:false,enrollment:{status:"pending",sample_count:1},notice:{version:"v1",retention_days:90,storage_region:"ap-south-1",privacy_contact:"owner@example.com"}};renderEnrollment()');expect(get("beginEnrollment").disabled).toBe(false);await run("deleteEnrollment()");expect(get("beginEnrollment").disabled).toBe(true);expect(get("deleteEnrollment").disabled).toBe(false);expect(get("deleteEnrollment").textContent).toBe("Retry deletion");expect(get("enrollmentState").textContent).toContain("deletion is incomplete");
  });
  it("rejects manual changes without a reason and sends valid corrections only to the authorized RPC",async()=>{
    const rpc=vi.fn().mockResolvedValue({error:{message:"Admin access required"}}),{run,get}=scriptContext("admin/attendance.js",{client:{rpc}});run('attendanceClient=client;manualStaffId="staff-1";selectedAttendanceDate="2026-10-15";');get("manualAction").value="correct";get("manualStatus").value="Present";get("manualCheckIn").value="2026-10-15T09:00";get("manualReason").value="";await run('saveManual({preventDefault(){}})');expect(rpc).not.toHaveBeenCalled();get("manualReason").value="Employee declined face verification";await run('saveManual({preventDefault(){}})');expect(rpc).toHaveBeenCalledWith("admin_correct_attendance",expect.objectContaining({p_staff_id:"staff-1",p_date:"2026-10-15",p_action:"correct",p_reason:"Employee declined face verification",p_check_in_at:"2026-10-15T03:30:00.000Z",p_check_out_at:null}));expect(get("manualMessage").textContent).toBe("Admin access required");
  });
  it("has no direct attendance mutations and exposes reports, audit and tablet controls",()=>{
    const source=read("admin/attendance.js"),html=read("admin/attendance.html"),css=read("admin/my-attendance.css");expect(source).not.toMatch(/\.upsert\(|\.insert\(|\.update\(/);expect(source).toContain('from("biometric_audit_events")');expect(html).toContain('id="auditPanel"');expect(html).toContain('id="enrollmentWitness"');expect(html).toContain('value="month"');expect(css).toContain("@media(min-width:768px) and (max-width:1180px)");expect(css).toContain("min-height:82px");
  });
});
describe("IST attendance calculations and privacy",()=>{
  it("uses the business day and time independently of the browser timezone",()=>{expect(indiaToday(new Date("2026-10-14T20:00:00Z"))).toBe("2026-10-15");expect(timeLabel("2026-10-15T03:30:00Z")).toMatch(/9:00/);});
  it("computes persisted and historic durations, including midnight",()=>{expect(durationLabel({check_in_at:"2026-10-15T03:30:00Z",check_out_at:"2026-10-15T12:00:00Z",working_seconds:30600})).toBe("8h 30m");expect(durationLabel({check_in:"23:00:00",check_out:"01:15:00"})).toBe("2h 15m");expect(durationLabel({check_in_at:"2026-10-15T03:30:00Z"})).toBe("In progress");expect(durationLabel(null)).toBe("—");});
  it("requires actual retention/region/contact and safely displays the server notice",()=>{expect(noticeReady({version:"v1"})).toBe(false);const notice={version:"v1",retention_days:365,storage_region:"ap-south-1",privacy_contact:'<img src=x onerror=alert(1)>'};expect(noticeReady(notice)).toBe(true);expect(noticeHTML(notice)).toContain("365");expect(noticeHTML(notice)).toContain("ap-south-1");expect(noticeHTML(notice)).not.toContain("<img");expect(noticeHTML(notice)).toContain("manual attendance alternative");expect(read("admin/biometric-ui.mjs")).not.toContain("localStorage");});
  it("discloses incomplete enrollment expiry and the daily deletion delay",()=>{const notice=noticeHTML({version:"v1",retention_days:90,storage_region:"ap-south-1",privacy_contact:"owner@example.com"});expect(notice).toContain("90 days");expect(notice).toContain("incomplete enrollment expires after <strong>24 hours</strong>");expect(notice).toContain("up to 24 hours after expiry");expect(notice).toContain("Failed deletions are retried");});
});
