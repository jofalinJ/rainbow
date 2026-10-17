import {escapeHTML as attendanceEscape,indiaToday,timeLabel as attendanceTimeLabel,durationLabel,faceRequest,biometricError,noticeHTML,noticeReady,captureLiveness} from "./biometric-ui.mjs";
let attendanceClient=null,activeStaff=[],dailyAttendance=[],historyAttendance=[],auditEvents=[],selectedAttendanceDate="",activeTab="daily",enrollmentStatus=null,enrollmentBusy=false,enrollmentOperation="",manualStaffId="",photoStaffId="";
const el=id=>document.getElementById(id);
const pad=value=>String(value).padStart(2,"0");
const dateKey=date=>date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate());
const recordIn=row=>row?.check_in_at||row?.check_in;
const recordOut=row=>row?.check_out_at||row?.check_out;
const relation=value=>Array.isArray(value)?value[0]||{}:value||{};
const getDailyRecord=id=>dailyAttendance.find(row=>String(row.staff_id)===String(id));
const profileName=profile=>profile?.full_name||profile?.username||"Staff member";
const methodLabel=row=>row?(row.verification_method||"legacy").replaceAll("_"," ")+" / "+(row.verification_result||"legacy"):"—";
function setAttendanceMessage(id,text,kind=""){el(id).textContent=text;el(id).className="attendance-message "+kind;}
function summaryCard(label,value){return "<div class='attendance-summary-card'><span>"+attendanceEscape(label)+"</span><strong>"+attendanceEscape(value)+"</strong></div>";}
function staffCell(profile,id){return "<div class='attendance-person'><span class='attendance-avatar' aria-hidden='true'>"+attendanceEscape(profileName(profile).trim().split(/\s+/).slice(0,2).map(part=>part[0]).join(""))+"</span><span><b>"+attendanceEscape(profileName(profile))+"</b><small class='employee-id'>"+attendanceEscape(id)+"</small></span></div>";}
function renderDaily(){
  const count=status=>activeStaff.filter(profile=>getDailyRecord(profile.user_id)?.status===status).length;
  el("dailySummary").innerHTML=summaryCard("Active employees",activeStaff.length)+summaryCard("Checked in",dailyAttendance.filter(recordIn).length)+summaryCard("Checked out",dailyAttendance.filter(recordOut).length)+summaryCard("Absent / leave",count("Absent")+count("On Leave"));
  const query=el("staffSearch").value.trim().toLowerCase();
  el("attendanceRows").innerHTML=activeStaff.filter(profile=>[profile.full_name,profile.username,profile.user_id].some(value=>String(value||"").toLowerCase().includes(query))).map(profile=>{
    const id=profile.user_id,row=getDailyRecord(id);
    return "<tr><td>"+staffCell(profile,id)+"</td><td>"+attendanceEscape(row?.status||"Not recorded")+"</td><td>"+attendanceEscape(attendanceTimeLabel(recordIn(row)))+"</td><td>"+attendanceEscape(attendanceTimeLabel(recordOut(row)))+"</td><td class='working-hours'>"+attendanceEscape(durationLabel(row))+"</td><td class='verification-cell'>"+attendanceEscape(methodLabel(row))+"</td><td><div class='row-actions'><button type='button' data-manual='"+attendanceEscape(id)+"'>Manual entry / correction</button><button type='button' data-enroll='"+attendanceEscape(id)+"'>Face enrollment</button>"+(row?.photo_path?"<button type='button' data-photo-review='"+attendanceEscape(id)+"'>Historic photo · "+attendanceEscape(row.photo_review_status||"Not reviewed")+"</button>":"")+"</div></td></tr>";
  }).join("")||"<tr><td colspan='7'>No active employees match this search.</td></tr>";
}
async function loadDaily(){
  setAttendanceMessage("dailyMessage","Loading attendance…");
  const [staffResult,recordsResult]=await Promise.all([
    attendanceClient.from("staff_profiles").select("user_id,full_name,username,role,active,photo_path").eq("active",true).neq("role","admin").order("full_name",{ascending:true}),
    attendanceClient.from("attendance").select("id,staff_id,date,check_in,check_out,check_in_at,check_out_at,working_seconds,status,verification_method,verification_result,notes,photo_path,photo_review_status,created_at,updated_at").eq("date",selectedAttendanceDate).order("created_at",{ascending:true})
  ]);
  if(staffResult.error)throw staffResult.error;if(recordsResult.error)throw recordsResult.error;
  activeStaff=staffResult.data||[];dailyAttendance=recordsResult.data||[];
  const selected=el("enrollmentStaff").value;
  el("enrollmentStaff").innerHTML="<option value=''>Select an employee</option>"+activeStaff.map(profile=>"<option value='"+attendanceEscape(profile.user_id)+"'>"+attendanceEscape(profileName(profile))+" · "+attendanceEscape(profile.username||profile.user_id)+"</option>").join("");
  el("enrollmentStaff").value=selected;
  renderDaily();setAttendanceMessage("dailyMessage","Attendance date: "+selectedAttendanceDate+" · Times shown in India Standard Time. Missing records are not counted as present.");
}
function isoWeekValue(date){const thursday=new Date(date.getFullYear(),date.getMonth(),date.getDate());thursday.setDate(thursday.getDate()+4-(thursday.getDay()||7));const year=thursday.getFullYear(),januaryFour=new Date(year,0,4),firstMonday=new Date(year,0,4-((januaryFour.getDay()+6)%7));return year+"-W"+pad(Math.floor((thursday-firstMonday)/(7*86400000))+1);}
function setHistoryDateInput(){const month=el("historyPeriod").value==="month",now=new Date(indiaToday()+"T12:00:00+05:30");el("historyDate").type=month?"month":"week";el("historyDate").value=month?indiaToday().slice(0,7):isoWeekValue(now);}
function historyRange(){
  const value=el("historyDate").value;
  if(el("historyPeriod").value==="month"){if(!/^\d{4}-\d{2}$/.test(value))throw new Error("Choose a month.");const [year,month]=value.split("-").map(Number);return {start:value+"-01",end:dateKey(new Date(year,month,0))};}
  const match=value.match(/^(\d{4})-W(\d{2})$/);if(!match)throw new Error("Choose a week.");const year=Number(match[1]),week=Number(match[2]),januaryFour=new Date(year,0,4),start=new Date(year,0,4-((januaryFour.getDay()+6)%7)+(week-1)*7),end=new Date(start);end.setDate(end.getDate()+6);return {start:dateKey(start),end:dateKey(end)};
}
function renderHistory(){
  const query=el("historySearch").value.trim().toLowerCase(),visible=historyAttendance.filter(row=>{const staff=relation(row.staff);return [staff.full_name,staff.username,row.staff_id].some(value=>String(value||"").toLowerCase().includes(query));});
  const seconds=visible.reduce((total,row)=>total+(Number(row.working_seconds)||0),0);
  el("historySummary").innerHTML=summaryCard("Records",visible.length)+summaryCard("Present",visible.filter(row=>row.status==="Present").length)+summaryCard("Face verified",visible.filter(row=>row.verification_method==="face_liveness").length)+summaryCard("Completed hours",Math.floor(seconds/3600)+"h "+Math.floor(seconds%3600/60)+"m");
  el("historyRows").innerHTML=visible.map(row=>"<tr><td>"+attendanceEscape(row.date)+"</td><td>"+staffCell(relation(row.staff),row.staff_id)+"</td><td>"+attendanceEscape(row.status)+"</td><td>"+attendanceEscape(attendanceTimeLabel(recordIn(row)))+"</td><td>"+attendanceEscape(attendanceTimeLabel(recordOut(row)))+"</td><td class='working-hours'>"+attendanceEscape(durationLabel(row))+"</td><td>"+attendanceEscape(methodLabel(row))+"</td></tr>").join("")||"<tr><td colspan='7'>No records for this report.</td></tr>";
}
async function loadHistory(){try{const range=historyRange();setAttendanceMessage("historyMessage","Loading report…");const {data,error}=await attendanceClient.from("attendance").select("id,staff_id,date,check_in,check_out,check_in_at,check_out_at,working_seconds,status,verification_method,verification_result,staff:staff_profiles!attendance_staff_id_fkey(full_name,username,role)").gte("date",range.start).lte("date",range.end).order("date",{ascending:false}).order("check_in_at",{ascending:true});if(error)throw error;historyAttendance=data||[];renderHistory();setAttendanceMessage("historyMessage",range.start+" through "+range.end+" · "+historyAttendance.length+" records.");}catch(error){setAttendanceMessage("historyMessage",error.message,"error");}}
function renderAudit(){const query=el("auditSearch").value.trim().toLowerCase();el("auditRows").innerHTML=auditEvents.filter(row=>[row.staff_id,row.actor_id,row.event].some(value=>String(value||"").toLowerCase().includes(query))).map(row=>"<tr><td>"+attendanceEscape(new Date(row.created_at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}))+"</td><td>"+attendanceEscape(row.event)+"</td><td class='audit-id'>"+attendanceEscape(row.staff_id||"—")+"</td><td class='audit-id'>"+attendanceEscape(row.actor_id||"Service")+"</td><td><div>"+attendanceEscape(row.reason||"—")+"</div><details><summary>Event details</summary><pre>"+attendanceEscape(JSON.stringify(row.details||{},null,2))+"</pre></details></td></tr>").join("")||"<tr><td colspan='5'>No matching audit events.</td></tr>";}
async function loadAudit(){try{setAttendanceMessage("auditMessage","Loading audit history…");const {data,error}=await attendanceClient.from("biometric_audit_events").select("id,actor_id,staff_id,attendance_id,event,reason,details,created_at").order("created_at",{ascending:false}).limit(200);if(error)throw error;auditEvents=data||[];renderAudit();setAttendanceMessage("auditMessage","Latest "+auditEvents.length+" audit events · includes enrollment, deletion and manual corrections.");}catch(error){setAttendanceMessage("auditMessage",error.message,"error");}}
function renderEnrollment(){
  const state=enrollmentStatus,id=el("enrollmentStaff").value,enrollment=state?.enrollment,samples=Number(enrollment?.sample_count||0),enrolled=Boolean(state?.enrolled),status=enrollment?.status;
  const pending=status==="pending",deleting=status==="deleting",interrupted=status==="indexing",expired=status==="active"&&!enrolled;
  const mismatch=Boolean(state?.provider_mismatch);
  const mustDelete=Boolean(enrollment&&(mismatch||!pending&&!enrolled));
  el("enrollmentStaffId").textContent=id?"Employee ID: "+id:"";
  el("enrollmentStaff").disabled=enrollmentBusy;
  el("enrollmentState").textContent=enrollmentBusy?(enrollmentOperation==="delete"?"DELETING ENROLLMENT…":"VERIFYING LIVE SAMPLE…"):!id?"Select an employee to check enrollment.":!state?"Loading enrollment…":mismatch?"Enrollment belongs to a different face service. Delete it before starting with this provider.":interrupted?"Enrollment interrupted. Delete enrollment and start again.":deleting?"Enrollment deletion is incomplete. Retry deletion before starting again.":expired?"Enrollment expired. Delete enrollment and start again.":mustDelete?"Enrollment is unavailable. Delete enrollment and start again.":enrolled?(state.enabled?"ENROLLED · Ready for face attendance":"ENROLLED · Face attendance service disabled"):!state.enabled?"Service configuration required. Secure face enrollment is unavailable.":pending?"ENROLLMENT IN PROGRESS · "+samples+" of 3 live samples accepted":"NOT ENROLLED · Three live samples required";
  ["sampleOne","sampleTwo","sampleThree"].forEach((name,index)=>{el(name).classList.toggle("complete",samples>index||enrolled);el(name).textContent=samples>index||enrolled?"✓":String(index+1);});
  el("beginEnrollment").textContent=enrolled?"Enrollment complete":mustDelete?"Delete enrollment before restarting":pending?"Capture live sample "+Math.min(samples+1,3)+" of 3":"Start live sample 1 of 3";
  el("beginEnrollment").disabled=!id||!state?.enabled||!noticeReady(state?.notice)||enrolled||mustDelete||enrollmentBusy||!el("enrollmentConsent").checked||!el("enrollmentWitness").checked;
  el("deleteEnrollment").textContent=deleting?"Retry deletion":"Delete enrollment";
  el("deleteEnrollment").disabled=!id||enrollmentBusy||!(enrolled||enrollment);
  el("enrollmentConsent").disabled=enrollmentBusy||enrolled||mustDelete;el("enrollmentWitness").disabled=enrollmentBusy||enrolled||mustDelete;
}
async function loadEnrollment(){
  const id=el("enrollmentStaff").value;enrollmentStatus=null;el("enrollmentConsent").checked=false;el("enrollmentWitness").checked=false;el("deleteEnrollmentForm").hidden=true;setAttendanceMessage("enrollmentMessage","");renderEnrollment();
  if(!id){el("adminPrivacyNotice").textContent="Select an employee to load the configured privacy notice.";return;}
  try{const result=await faceRequest(attendanceClient,"status",{staff_id:id});if(el("enrollmentStaff").value!==id)return;enrollmentStatus=result;el("adminPrivacyNotice").innerHTML=noticeHTML(result.notice);renderEnrollment();}catch(error){if(el("enrollmentStaff").value!==id)return;enrollmentStatus={enabled:false};el("adminPrivacyNotice").textContent="The privacy notice could not be loaded. Enrollment is unavailable.";setAttendanceMessage("enrollmentMessage",biometricError(error),"error");renderEnrollment();}
}
async function beginEnrollment(){
  if(el("beginEnrollment").disabled||enrollmentBusy)return;
  const staffId=el("enrollmentStaff").value;enrollmentBusy=true;enrollmentOperation="capture";renderEnrollment();setAttendanceMessage("enrollmentMessage","Starting live enrollment sample…");
  try{
    const pending=enrollmentStatus?.enrollment?.status==="pending";
    const start=await faceRequest(attendanceClient,pending?"next_enrollment_sample":"start_enrollment",{staff_id:staffId,...(!pending?{consent:true,consent_version:enrollmentStatus.notice.version}:{})});
    await captureLiveness({client:attendanceClient,start,dialog:el("livenessDialog"),container:el("livenessCamera"),message:el("captureMessage")});
    enrollmentStatus=await faceRequest(attendanceClient,"status",{staff_id:staffId});
    setAttendanceMessage("enrollmentMessage",enrollmentStatus.enrolled?"Enrollment complete. All three live samples were accepted. This employee can now sign in to their own account for face attendance.":"Live sample accepted. Continue until all three samples are complete.","success");
  }catch(error){setAttendanceMessage("enrollmentMessage",biometricError(error),"error");try{enrollmentStatus=await faceRequest(attendanceClient,"status",{staff_id:staffId});}catch{/* Keep the last known state on network failure. */}}
  finally{enrollmentBusy=false;enrollmentOperation="";renderEnrollment();}
}
async function deleteEnrollment(){
  if(enrollmentBusy||el("deleteEnrollment").disabled)return;const reason=el("deletionReason").value.trim();if(reason.length<5||reason.length>500){setAttendanceMessage("enrollmentMessage","Enter a deletion reason of 5–500 characters.","error");return;}
  const staffId=el("enrollmentStaff").value;
  // A lost deletion response may leave the server locked for deletion. Keep
  // captures blocked until a fresh status proves that enrollment is usable.
  if(enrollmentStatus?.enrollment)enrollmentStatus={...enrollmentStatus,enrolled:false,enrollment:{...enrollmentStatus.enrollment,status:"deleting"}};
  enrollmentBusy=true;enrollmentOperation="delete";renderEnrollment();el("confirmDeleteEnrollment").disabled=true;
  try{await faceRequest(attendanceClient,"delete_enrollment",{staff_id:staffId,reason});await loadEnrollment();el("deletionReason").value="";setAttendanceMessage("enrollmentMessage","Biometric enrollment deleted. New enrollment requires fresh employee consent. Attendance history is preserved.","success");}catch(error){setAttendanceMessage("enrollmentMessage",biometricError(error),"error");try{enrollmentStatus=await faceRequest(attendanceClient,"status",{staff_id:staffId});}catch{/* Preserve the deletion lock when status cannot be refreshed. */}}finally{enrollmentBusy=false;enrollmentOperation="";el("confirmDeleteEnrollment").disabled=false;renderEnrollment();}
}
function localInput(value){if(!value)return "";const date=new Date(value);if(Number.isNaN(date.getTime()))return "";const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);const part=key=>parts.find(item=>item.type===key)?.value;return part("year")+"-"+part("month")+"-"+part("day")+"T"+part("hour")+":"+part("minute");}
function openManual(id){manualStaffId=id;const profile=activeStaff.find(person=>person.user_id===id),row=getDailyRecord(id);el("manualAttendancePerson").textContent=profileName(profile)+" · "+id+" · "+selectedAttendanceDate;el("manualStatus").value=row?.status||"Present";el("manualCheckIn").value=localInput(row?.check_in_at);el("manualCheckOut").value=localInput(row?.check_out_at);el("manualReason").value="";el("manualAction").value=selectedAttendanceDate===indiaToday()?(!recordIn(row)?"check_in":!recordOut(row)?"check_out":"status"):"correct";el("manualAction").querySelectorAll("option").forEach(option=>option.disabled=["check_in","check_out"].includes(option.value)&&selectedAttendanceDate!==indiaToday());el("manualTimeFields").hidden=el("manualAction").value!=="correct";setAttendanceMessage("manualMessage","");el("manualAttendanceDialog").hidden=false;el("manualAction").focus();}
async function saveManual(event){
  event.preventDefault();const reason=el("manualReason").value.trim(),action=el("manualAction").value;if(reason.length<5){setAttendanceMessage("manualMessage","Enter a reason of at least 5 characters.","error");return;}
  const payload={p_staff_id:manualStaffId,p_date:selectedAttendanceDate,p_action:action,p_reason:reason,p_status:el("manualStatus").value};
  if(action==="correct"){payload.p_check_in_at=el("manualCheckIn").value?new Date(el("manualCheckIn").value+"+05:30").toISOString():null;payload.p_check_out_at=el("manualCheckOut").value?new Date(el("manualCheckOut").value+"+05:30").toISOString():null;}
  el("saveManualAttendance").disabled=true;setAttendanceMessage("manualMessage","Saving audited correction…");
  try{const {error}=await attendanceClient.rpc("admin_correct_attendance",payload);if(error)throw error;el("manualAttendanceDialog").hidden=true;await loadDaily();setAttendanceMessage("dailyMessage","Manual correction saved with your identity, server time and reason.","success");}catch(error){setAttendanceMessage("manualMessage",error.message,"error");}finally{el("saveManualAttendance").disabled=false;}
}
async function signedPhoto(path){if(!path)return "";const {data,error}=await attendanceClient.storage.from("staff-private").createSignedUrl(path,120);if(error)throw error;return data?.signedUrl||"";}
async function openPhoto(id){
  const profile=activeStaff.find(person=>person.user_id===id),row=getDailyRecord(id);if(!row?.photo_path)return;photoStaffId=id;el("photoReviewPerson").textContent=profileName(profile)+" · "+selectedAttendanceDate;el("photoReviewReason").value="";el("photoReviewDialog").hidden=false;setAttendanceMessage("photoReviewMessage","Loading private historic photos…");
  try{const [reference,capture]=await Promise.all([signedPhoto(profile?.photo_path),signedPhoto(row.photo_path)]);el("staffReferencePhoto").src=reference;el("staffReferencePhoto").hidden=!reference;el("staffAttendancePhoto").src=capture;el("staffAttendancePhoto").hidden=!capture;setAttendanceMessage("photoReviewMessage",reference?"Historic photo review: "+(row.photo_review_status||"Not reviewed"):"No staff reference photo is available.");}catch(error){setAttendanceMessage("photoReviewMessage",error.message,"error");}
}
async function savePhotoReview(decision){const reason=el("photoReviewReason").value.trim();if(reason.length<5){setAttendanceMessage("photoReviewMessage","Enter a review reason of at least 5 characters.","error");return;}const buttons=document.querySelectorAll("[data-photo-decision]");buttons.forEach(button=>button.disabled=true);try{const {error}=await attendanceClient.rpc("admin_correct_attendance",{p_staff_id:photoStaffId,p_date:selectedAttendanceDate,p_action:"review_photo",p_reason:reason,p_photo_review_status:decision});if(error)throw error;el("photoReviewDialog").hidden=true;await loadDaily();setAttendanceMessage("dailyMessage","Historic photo review saved in the audit history.","success");}catch(error){setAttendanceMessage("photoReviewMessage",error.message,"error");}finally{buttons.forEach(button=>button.disabled=false);}}
async function refreshActive(){try{if(activeTab==="daily")await loadDaily();if(activeTab==="history")await loadHistory();if(activeTab==="audit")await loadAudit();if(activeTab==="enrollment")await loadEnrollment();}catch(error){setAttendanceMessage("dailyMessage",error.message,"error");}}
function activateAttendanceTab(tab){if(enrollmentBusy)return;activeTab=tab;["daily","history","enrollment","audit"].forEach(name=>{el(name+"Tab").classList.toggle("is-active",tab===name);el(name+"Tab").setAttribute("aria-selected",String(tab===name));el(name+"Tab").tabIndex=tab===name?0:-1;el(name+"Panel").hidden=tab!==name;});if(tab==="history")loadHistory();if(tab==="audit")loadAudit();}
function bindAttendanceControls(){
  document.querySelectorAll("[data-tab]").forEach(button=>{button.addEventListener("click",()=>activateAttendanceTab(button.dataset.tab));button.addEventListener("keydown",event=>{const tabs=["daily","history","enrollment","audit"];if(["ArrowRight","ArrowLeft","Home","End"].includes(event.key)){event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?3:(tabs.indexOf(activeTab)+(event.key==="ArrowRight"?1:3))%4;activateAttendanceTab(tabs[next]);el(tabs[next]+"Tab").focus();}});});
  const chooseDate=()=>{selectedAttendanceDate=el("attendanceDate").value||indiaToday();refreshActive();};el("attendanceDate").addEventListener("change",chooseDate);["previousDay","nextDay"].forEach((name,index)=>el(name).addEventListener("click",()=>{const date=new Date(selectedAttendanceDate+"T12:00:00");date.setDate(date.getDate()+(index?1:-1));el("attendanceDate").value=dateKey(date);chooseDate();}));
  el("staffSearch").addEventListener("input",renderDaily);el("historySearch").addEventListener("input",renderHistory);el("auditSearch").addEventListener("input",renderAudit);el("historyPeriod").addEventListener("change",()=>{setHistoryDateInput();loadHistory();});el("historyDate").addEventListener("change",loadHistory);el("refreshHistory").addEventListener("click",loadHistory);el("attendanceRefresh").addEventListener("click",()=>{if(!enrollmentBusy)refreshActive();});
  el("attendanceRows").addEventListener("click",event=>{const manual=event.target.closest("[data-manual]"),enroll=event.target.closest("[data-enroll]"),photo=event.target.closest("[data-photo-review]");if(manual)openManual(manual.dataset.manual);if(photo)openPhoto(photo.dataset.photoReview);if(enroll){activateAttendanceTab("enrollment");el("enrollmentStaff").value=enroll.dataset.enroll;loadEnrollment();}});
  el("enrollmentStaff").addEventListener("change",loadEnrollment);["enrollmentConsent","enrollmentWitness"].forEach(id=>el(id).addEventListener("change",renderEnrollment));el("beginEnrollment").addEventListener("click",beginEnrollment);el("deleteEnrollment").addEventListener("click",()=>{el("deleteEnrollmentForm").hidden=false;el("deletionReason").focus();});el("confirmDeleteEnrollment").addEventListener("click",deleteEnrollment);el("cancelDeleteEnrollment").addEventListener("click",()=>el("deleteEnrollmentForm").hidden=true);
  el("manualAttendanceForm").addEventListener("submit",saveManual);el("manualAction").addEventListener("change",()=>el("manualTimeFields").hidden=el("manualAction").value!=="correct");el("closeManualAttendance").addEventListener("click",()=>el("manualAttendanceDialog").hidden=true);el("closePhotoReview").addEventListener("click",()=>el("photoReviewDialog").hidden=true);document.querySelectorAll("[data-photo-decision]").forEach(button=>button.addEventListener("click",()=>savePhotoReview(button.dataset.photoDecision)));document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!enrollmentBusy){el("manualAttendanceDialog").hidden=true;el("photoReviewDialog").hidden=true;}});
}
async function bootAttendance(){
  selectedAttendanceDate=indiaToday();el("attendanceDate").value=selectedAttendanceDate;setHistoryDateInput();bindAttendanceControls();
  try{attendanceClient=bootSupabase();await requireSession();const profile=await getMyProfile();if(!profile.active||profile.role!=="admin"){location.replace("my-attendance.html");return;}await loadDaily();}catch(error){setAttendanceMessage("dailyMessage",error.message||"Could not initialize attendance.","error");}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootAttendance,{once:true});else bootAttendance();
