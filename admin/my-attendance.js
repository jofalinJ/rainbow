import {indiaToday,timeLabel,durationLabel,escapeHTML,faceRequest,biometricError,noticeHTML,captureLiveness} from "./biometric-ui.mjs";
let myAttendanceClient=null;
let myAttendanceUserId="";
let myAttendanceProfile=null;
let myAttendanceRecord=null;
let biometricStatus=null;
let loadedAttendanceDay="";
let attendanceReady=false;
let attendanceSaving=false;
const el=id=>document.getElementById(id);
function setSelfAttendanceMessage(text,kind=""){el("selfAttendanceMessage").textContent=text;el("selfAttendanceMessage").className="self-attendance-message "+kind;}
function renderMyAttendance(){
  const record=myAttendanceRecord,inAt=record?.check_in_at||record?.check_in,outAt=record?.check_out_at||record?.check_out;
  el("todayAttendanceStatus").textContent=attendanceSaving?"VERIFYING":inAt?(outAt?"CHECKED OUT":"CHECKED IN"):"NOT CHECKED IN";
  el("checkInTime").textContent=timeLabel(inAt);el("checkOutTime").textContent=timeLabel(outAt);el("workingHours").textContent=durationLabel(record);
  const ready=attendanceReady&&biometricStatus?.enabled&&biometricStatus?.enrolled&&!attendanceSaving;
  el("checkInButton").disabled=!ready||Boolean(inAt);el("checkOutButton").disabled=!ready||!inAt||Boolean(outAt);
  el("refreshAttendance").disabled=attendanceSaving;
  el("shiftDateLabel").textContent=record?.date&&record.date!==indiaToday()?"Shift started on "+record.date+" · complete checkout for this shift before checking in again.":"";
  el("verificationMethod").textContent="Verification: "+(record?String(record.verification_method||"legacy").replaceAll("_"," ")+" / "+(record.verification_result||"legacy"):"—");
  el("photoReviewStatus").textContent=record?.photo_review_status==="Rejected"?"Your historic check-in photo needs follow-up. Contact an administrator.":"";
  if(biometricStatus){el("enrollmentBanner").className="enrollment-banner "+(biometricStatus.enabled&&biometricStatus.enrolled?"ready":"");el("enrollmentBanner").textContent=!biometricStatus.enabled?"Face attendance requires secure service configuration. Ask an administrator to record your attendance.":!biometricStatus.enrolled?"Face enrollment is required. Ask an administrator to enroll you, or use the manual attendance alternative.":"Face enrollment ready · live verification required for every attendance action.";}
}
async function loadMyAttendance(preferredRecord=null){
  const fields="id,staff_id,date,check_in,check_out,check_in_at,check_out_at,working_seconds,status,verification_method,verification_result,photo_review_status";
  const today=indiaToday();
  const {data,error}=await myAttendanceClient.from("attendance").select(fields).eq("staff_id",myAttendanceUserId).eq("date",today).maybeSingle();
  if(error)throw error;
  let record=data||null;
  // A shift may cross midnight. Only this account's still-open shift in the last
  // 24 hours is eligible; the database repeats this check while holding its lock.
  if(!recordInProgress(record)){
    const open=await myAttendanceClient.from("attendance").select(fields).eq("staff_id",myAttendanceUserId).not("check_in_at","is",null).is("check_out_at",null).gte("check_in_at",new Date(Date.now()-86400000).toISOString()).order("check_in_at",{ascending:false}).limit(1).maybeSingle();
    if(open.error)throw open.error;
    if(open.data)record=open.data;
  }
  if(preferredRecord?.staff_id===myAttendanceUserId)record=preferredRecord;
  myAttendanceRecord=record;loadedAttendanceDay=today;attendanceReady=true;renderMyAttendance();
}
function recordInProgress(record){return Boolean((record?.check_in_at||record?.check_in)&&!(record?.check_out_at||record?.check_out));}
async function loadBiometricStatus(){biometricStatus=await faceRequest(myAttendanceClient,"status");el("employeePrivacyNotice").innerHTML=noticeHTML(biometricStatus.notice);renderMyAttendance();}
async function loadPersonalHistory(){
  const month=el("personalHistoryMonth").value;if(!/^\d{4}-\d{2}$/.test(month))return;
  const [year,number]=month.split("-").map(Number),last=new Date(year,number,0).getDate();
  el("personalHistoryMessage").textContent="Loading your attendance history…";
  try{
    const {data,error}=await myAttendanceClient.from("attendance").select("date,status,check_in,check_out,check_in_at,check_out_at,working_seconds,verification_method,verification_result").eq("staff_id",myAttendanceUserId).gte("date",month+"-01").lte("date",month+"-"+last).order("date",{ascending:false});
    if(error)throw error;
    el("personalHistoryRows").innerHTML=(data||[]).map(row=>"<tr><td>"+escapeHTML(row.date)+"</td><td>"+escapeHTML(row.status)+"</td><td>"+escapeHTML(timeLabel(row.check_in_at||row.check_in))+"</td><td>"+escapeHTML(timeLabel(row.check_out_at||row.check_out))+"</td><td>"+escapeHTML(durationLabel(row))+"</td><td>"+escapeHTML((row.verification_method||"legacy").replaceAll("_"," ")+" / "+(row.verification_result||"legacy"))+"</td></tr>").join("")||"<tr><td colspan='6'>No attendance records for this month.</td></tr>";
    el("personalHistoryMessage").textContent=(data||[]).length+" records · times shown in IST";
  }catch(error){el("personalHistoryMessage").textContent="Could not load history: "+error.message;}
}
async function recordAttendanceAction(action){
  if(!attendanceReady||attendanceSaving||!biometricStatus?.enabled||!biometricStatus?.enrolled)return;
  const inAt=myAttendanceRecord?.check_in_at||myAttendanceRecord?.check_in,outAt=myAttendanceRecord?.check_out_at||myAttendanceRecord?.check_out;
  const dayChanged=Boolean(loadedAttendanceDay&&loadedAttendanceDay!==indiaToday());
  if(!dayChanged&&(action==="check_in"&&inAt||action==="check_out"&&(!inAt||outAt)))return;
  attendanceSaving=true;renderMyAttendance();setSelfAttendanceMessage("Starting secure face verification…");
  try{
    if(dayChanged){await loadMyAttendance();if(action==="check_in"&&(myAttendanceRecord?.check_in_at||myAttendanceRecord?.check_in)||action==="check_out"&&!recordInProgress(myAttendanceRecord))throw new Error("The attendance day changed. Review your refreshed shift status before starting again.");}
    const start=await faceRequest(myAttendanceClient,"start_verification",{action});
    const result=await captureLiveness({client:myAttendanceClient,start,dialog:el("livenessDialog"),container:el("livenessCamera"),message:el("captureMessage")});
    // Reload the server's persisted row; never infer an attendance record from the camera callback.
    await loadMyAttendance(result.attendance);await loadPersonalHistory();
    const recorded=action==="check_in"?(myAttendanceRecord?.check_in_at||myAttendanceRecord?.check_in):(myAttendanceRecord?.check_out_at||myAttendanceRecord?.check_out);
    if(!recorded)throw new Error("No confirmed attendance entry was returned. Refresh or contact an administrator before trying again.");
    setSelfAttendanceMessage((myAttendanceProfile.full_name||myAttendanceProfile.username)+" · ID "+myAttendanceUserId+" · "+(action==="check_in"?"Checked in":"Checked out")+" at "+timeLabel(recorded)+" IST · "+myAttendanceRecord.status,"success");
  }catch(error){setSelfAttendanceMessage(biometricError(error),"error");el("todayAttendanceStatus").textContent="VERIFICATION FAILED";}
  finally{attendanceSaving=false;renderMyAttendance();if(el("selfAttendanceMessage").classList.contains("error"))el("todayAttendanceStatus").textContent="VERIFICATION FAILED";}
}
function updateClock(){const now=new Date();el("indiaDateLabel").textContent=now.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",weekday:"long",day:"numeric",month:"long",year:"numeric"});el("indiaClock").textContent=now.toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata",hour:"numeric",minute:"2-digit",second:"2-digit"})+" IST";}
async function bootMyAttendance(){
  updateClock();const clockTimer=setInterval(updateClock,1000);window.addEventListener("pagehide",()=>clearInterval(clockTimer),{once:true});
  try{
    myAttendanceClient=bootSupabase();const session=await requireSession();const profile=await getMyProfile();
    if(!profile.active)throw new Error("This staff account is inactive.");
    if(profile.role==="admin"){location.replace("attendance.html");return;}
    myAttendanceUserId=session.user.id;myAttendanceProfile=profile;el("staffGreeting").textContent=profile.full_name||profile.username||"Staff member";el("signedInStaffId").textContent=myAttendanceUserId;el("personalHistoryMonth").value=indiaToday().slice(0,7);
    await loadMyAttendance();await loadPersonalHistory();
    try{await loadBiometricStatus();setSelfAttendanceMessage(biometricStatus.enabled&&biometricStatus.enrolled?"Ready. Your camera opens only when you start a face check.":"Face attendance is unavailable for this account. Ask an administrator about enrollment or the manual attendance alternative.");}catch(error){biometricStatus={enabled:false};renderMyAttendance();setSelfAttendanceMessage(biometricError(error),"error");}
  }catch(error){setSelfAttendanceMessage(error.message||"Could not load attendance.","error");}
  el("checkInButton").addEventListener("click",()=>recordAttendanceAction("check_in"));el("checkOutButton").addEventListener("click",()=>recordAttendanceAction("check_out"));el("personalHistoryMonth").addEventListener("change",loadPersonalHistory);el("refreshAttendance").addEventListener("click",async()=>{try{await loadMyAttendance();await loadBiometricStatus();await loadPersonalHistory();setSelfAttendanceMessage("Attendance refreshed.");}catch(error){setSelfAttendanceMessage(biometricError(error),"error");}});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootMyAttendance,{once:true});else bootMyAttendance();
