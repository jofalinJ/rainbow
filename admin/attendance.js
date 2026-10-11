const ATTENDANCE_STATUSES=["Present","Absent","Half Day","On Leave"];
let attendanceClient=null;
let activeStaff=[];
let dailyAttendance=[];
let historyAttendance=[];
let selectedAttendanceDate="";
let pendingAttendanceUpdates=new Set();

function attendanceEscape(value){
  return String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[character]));
}
function attendancePad(value){return String(value).padStart(2,"0");}
function attendanceDateKey(date){
  return date.getFullYear()+"-"+attendancePad(date.getMonth()+1)+"-"+attendancePad(date.getDate());
}
function attendanceToday(){return attendanceDateKey(new Date());}
function parseAttendanceDate(value){
  const parts=String(value||"").split("-").map(Number);
  if(parts.length!==3||parts.some(Number.isNaN))return new Date();
  return new Date(parts[0],parts[1]-1,parts[2]);
}
function formatAttendanceDate(value){
  if(!value)return "Date unavailable";
  const date=parseAttendanceDate(value);
  return date.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
}
function attendanceTimeNow(){
  const now=new Date();
  return attendancePad(now.getHours())+":"+attendancePad(now.getMinutes())+":"+attendancePad(now.getSeconds());
}
function attendanceTimeLabel(value){
  if(!value)return "—";
  const parts=String(value).split(":");
  if(parts.length<2)return value;
  const date=new Date();
  date.setHours(Number(parts[0]),Number(parts[1]),Number(parts[2]||0),0);
  return date.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"});
}
function attendanceDuration(checkIn,checkOut){
  if(!checkIn)return "—";
  if(!checkOut)return "In progress";
  const toMinutes=value=>{
    const parts=String(value).split(":").map(Number);
    return parts[0]*60+parts[1];
  };
  const start=toMinutes(checkIn);
  let end=toMinutes(checkOut);
  if(!Number.isFinite(start)||!Number.isFinite(end))return "—";
  if(end<start)end+=24*60;
  const minutes=end-start;
  return Math.floor(minutes/60)+"h "+(minutes%60)+"m";
}
function attendanceInitials(profile){
  const name=String(profile.full_name||profile.username||"Staff").trim();
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0].toUpperCase()).join("")||"S";
}
function attendanceRole(role){
  return String(role||"Staff").split("_").map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(" ");
}
function attendanceRelation(value){return Array.isArray(value)?(value[0]||{}):(value||{});}
function setAttendanceMessage(id,message,kind){
  const element=document.getElementById(id);
  if(!element)return;
  element.textContent=message||"";
  element.className="attendance-message"+(kind?" "+kind:"");
}
async function attendanceSignedUrl(path){
  if(!path)return "";
  const {data,error}=await attendanceClient.storage.from("staff-private").createSignedUrl(path,600);
  if(error){console.warn("Could not create staff photo link:",error);return "";}
  return data?.signedUrl||"";
}
function getDailyRecord(staffId){
  return dailyAttendance.find(record=>String(record.staff_id)===String(staffId))||null;
}
function attendanceSummaryCard(label,value){
  return "<div class='attendance-summary-card'><span>"+attendanceEscape(label)+"</span><strong>"+attendanceEscape(value)+"</strong></div>";
}
function renderDailySummary(){
  const summary=document.getElementById("dailySummary");
  if(!summary)return;
  const statusFor=profile=>getDailyRecord(profile.user_id)?.status||"Present";
  const present=activeStaff.filter(profile=>statusFor(profile)==="Present").length;
  const checkedIn=activeStaff.filter(profile=>Boolean(getDailyRecord(profile.user_id)?.check_in)).length;
  const absent=activeStaff.filter(profile=>statusFor(profile)==="Absent").length;
  const onLeave=activeStaff.filter(profile=>statusFor(profile)==="On Leave").length;
  summary.innerHTML=attendanceSummaryCard("Active staff",activeStaff.length)+
    attendanceSummaryCard("Present",present)+attendanceSummaryCard("Checked in",checkedIn)+
    attendanceSummaryCard("Absent / on leave",absent+onLeave);
}
function renderDailyRows(){
  const rows=document.getElementById("attendanceRows");
  if(!rows)return;
  const query=String(document.getElementById("staffSearch")?.value||"").trim().toLowerCase();
  const canRecord=selectedAttendanceDate===attendanceToday();
  const profiles=activeStaff.filter(profile=>[profile.full_name,profile.username,attendanceRole(profile.role)].some(value=>String(value||"").toLowerCase().includes(query)));
  rows.innerHTML=profiles.map(profile=>{
    const id=String(profile.user_id);
    const record=getDailyRecord(id);
    const name=profile.full_name||profile.username||"Staff member";
    const busy=pendingAttendanceUpdates.has(id);
    const status=record?.status||"Present";
    const statusOptions=ATTENDANCE_STATUSES.map(option=>"<option value='"+option+"' "+(status===option?"selected":"")+">"+option+"</option>").join("");
    const checkInDisabled=busy||!canRecord||Boolean(record?.check_in);
    const checkOutDisabled=busy||!canRecord||!record?.check_in||Boolean(record?.check_out);
    const timeHint=canRecord?"":"Check-in and check-out are available for today.";
    const avatar=profile.referencePhotoUrl
      ?"<img class='attendance-avatar photo' src='"+attendanceEscape(profile.referencePhotoUrl)+"' alt='' width='36' height='36' loading='lazy'>"
      :"<span class='attendance-avatar' aria-hidden='true'>"+attendanceEscape(attendanceInitials(profile))+"</span>";
    const reviewStatus=record?.photo_review_status||"Not submitted";
    const photoReview=record?.photo_path
      ?"<button type='button' data-photo-review='"+attendanceEscape(id)+"'>"+(reviewStatus==="Pending"?"Review photo":"View photos")+"</button><small>"+attendanceEscape(reviewStatus)+"</small>"
      :"<small>No check-in photo</small>";
    return "<tr><td><div class='attendance-person'>"+avatar+"<span><b>"+attendanceEscape(name)+"</b><small>"+attendanceEscape(attendanceRole(profile.role))+"</small></span></div></td>"+
      "<td><select data-attendance-status data-staff-id='"+attendanceEscape(id)+"' aria-label='Attendance status for "+attendanceEscape(name)+"' "+(busy?"disabled":"")+">"+statusOptions+"</select></td>"+
      "<td><div class='time-action'><span>"+attendanceEscape(attendanceTimeLabel(record?.check_in))+"</span><button type='button' data-attendance-action='check_in' data-staff-id='"+attendanceEscape(id)+"' title='"+attendanceEscape(timeHint)+"' "+(checkInDisabled?"disabled":"")+">Check in</button></div></td>"+
      "<td><div class='time-action'><span>"+attendanceEscape(attendanceTimeLabel(record?.check_out))+"</span><button type='button' data-attendance-action='check_out' data-staff-id='"+attendanceEscape(id)+"' title='"+attendanceEscape(timeHint)+"' "+(checkOutDisabled?"disabled":"")+">Check out</button></div></td>"+
      "<td class='working-hours'>"+attendanceEscape(attendanceDuration(record?.check_in,record?.check_out))+"</td>"+
      "<td><div class='photo-review-cell'>"+photoReview+"</div></td></tr>";
  }).join("")||"<tr><td colspan='6'>"+(activeStaff.length?"No staff match this search.":"No active staff profiles found.")+"</td></tr>";
}
function renderDaily(){
  renderDailySummary();
  renderDailyRows();
}
async function loadDaily(){
  setAttendanceMessage("dailyMessage","Loading attendance…","");
  const [staffResult,recordsResult]=await Promise.all([
    attendanceClient.from("staff_profiles").select("user_id,full_name,username,role,active,photo_path").eq("active",true).order("full_name",{ascending:true}),
    attendanceClient.from("attendance").select("id,staff_id,date,check_in,check_out,status,notes,photo_path,photo_review_status,photo_reviewed_by,photo_reviewed_at").eq("date",selectedAttendanceDate).order("created_at",{ascending:true})
  ]);
  if(staffResult.error)throw new Error("Could not load active staff: "+staffResult.error.message);
  if(recordsResult.error)throw new Error("Could not load attendance: "+recordsResult.error.message);
  activeStaff=Array.isArray(staffResult.data)?staffResult.data:[];
  dailyAttendance=Array.isArray(recordsResult.data)?recordsResult.data:[];
  const photoPaths=[...new Set(activeStaff.map(profile=>profile.photo_path).concat(dailyAttendance.map(record=>record.photo_path)).filter(Boolean))];
  const photoUrls=await Promise.all(photoPaths.map(async path=>[path,await attendanceSignedUrl(path)]));
  const photoUrlByPath=new Map(photoUrls);
  activeStaff=activeStaff.map(profile=>({...profile,referencePhotoUrl:photoUrlByPath.get(profile.photo_path)||""}));
  dailyAttendance=dailyAttendance.map(record=>({...record,attendancePhotoUrl:photoUrlByPath.get(record.photo_path)||""}));
  renderDaily();
  setAttendanceMessage("dailyMessage",selectedAttendanceDate===attendanceToday()?"Attendance is up to date.":"Viewing attendance for "+formatAttendanceDate(selectedAttendanceDate)+".","");
}
async function saveAttendance(profile,changes){
  const existing=getDailyRecord(profile.user_id);
  const payload={
    id:existing?.id,
    staff_id:profile.user_id,
    date:selectedAttendanceDate,
    status:existing?.status||"Present",
    photo_path:existing?.photo_path||null,
    photo_review_status:existing?.photo_review_status||"Not submitted",
    photo_reviewed_by:existing?.photo_reviewed_by||null,
    photo_reviewed_at:existing?.photo_reviewed_at||null,
    ...changes
  };
  const {error}=await attendanceClient.from("attendance").upsert(payload,{onConflict:"staff_id,date"});
  if(error)throw new Error(error.message);
  await loadDaily();
}
function bindDailyActions(){
  const rows=document.getElementById("attendanceRows");
  rows?.addEventListener("click",async event=>{
    const review=event.target.closest("button[data-photo-review]");
    if(review){openAttendancePhotoReview(review.dataset.photoReview);return;}
    const button=event.target.closest("button[data-attendance-action]");
    if(!button)return;
    const profile=activeStaff.find(person=>String(person.user_id)===String(button.dataset.staffId));
    if(!profile)return;
    const id=String(profile.user_id);
    const action=button.dataset.attendanceAction;
    if(action==="check_out"&&!getDailyRecord(id)?.check_in)return;
    pendingAttendanceUpdates.add(id);
    renderDailyRows();
    try{
      const changes=action==="check_in"
        ?{check_in:attendanceTimeNow()}
        :{check_out:attendanceTimeNow()};
      await saveAttendance(profile,changes);
      setAttendanceMessage("dailyMessage",action==="check_in"?"Check-in recorded.":"Check-out recorded.","success");
    }catch(error){
      console.error("Attendance update failed:",error);
      setAttendanceMessage("dailyMessage","Could not update attendance: "+(error.message||"Unknown error"),"error");
      renderDailyRows();
    }finally{
      pendingAttendanceUpdates.delete(id);
      renderDailyRows();
    }
  });
  rows?.addEventListener("change",async event=>{
    const select=event.target.closest("select[data-attendance-status]");
    if(!select)return;
    const profile=activeStaff.find(person=>String(person.user_id)===String(select.dataset.staffId));
    if(!profile)return;
    const id=String(profile.user_id);
    pendingAttendanceUpdates.add(id);
    renderDailyRows();
    try{
      await saveAttendance(profile,{status:select.value});
      setAttendanceMessage("dailyMessage","Attendance status updated.","success");
    }catch(error){
      console.error("Attendance status update failed:",error);
      setAttendanceMessage("dailyMessage","Could not update status: "+(error.message||"Unknown error"),"error");
      renderDailyRows();
    }finally{
      pendingAttendanceUpdates.delete(id);
      renderDailyRows();
    }
  });
}
function isoWeekValue(date){
  const thursday=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  thursday.setDate(thursday.getDate()+4-(thursday.getDay()||7));
  const year=thursday.getFullYear();
  const januaryFour=new Date(year,0,4);
  const firstMonday=new Date(year,0,4-((januaryFour.getDay()+6)%7));
  const week=Math.floor((thursday-firstMonday)/(7*86400000))+1;
  return year+"-W"+attendancePad(week);
}
function setHistoryDateInput(){
  const period=document.getElementById("historyPeriod")?.value||"week";
  const input=document.getElementById("historyDate");
  if(!input)return;
  input.type=period==="month"?"month":"week";
  const now=new Date();
  input.value=period==="month"?now.getFullYear()+"-"+attendancePad(now.getMonth()+1):isoWeekValue(now);
}
function historyRange(){
  const period=document.getElementById("historyPeriod")?.value||"week";
  const value=document.getElementById("historyDate")?.value||"";
  if(period==="month"){
    const match=value.match(/^(\d{4})-(\d{2})$/);
    if(!match)throw new Error("Choose a month to view history.");
    const year=Number(match[1]),month=Number(match[2]);
    return {start:year+"-"+attendancePad(month)+"-01",end:attendanceDateKey(new Date(year,month,0))};
  }
  const match=value.match(/^(\d{4})-W(\d{2})$/);
  if(!match)throw new Error("Choose a week to view history.");
  const year=Number(match[1]),week=Number(match[2]);
  const januaryFour=new Date(year,0,4);
  const start=new Date(year,0,4-((januaryFour.getDay()+6)%7)+(week-1)*7);
  const end=new Date(start);end.setDate(end.getDate()+6);
  return {start:attendanceDateKey(start),end:attendanceDateKey(end)};
}
function renderHistorySummary(){
  const summary=document.getElementById("historySummary");
  if(!summary)return;
  const count=status=>historyAttendance.filter(row=>(row.status||"Present")===status).length;
  summary.innerHTML=attendanceSummaryCard("Records",historyAttendance.length)+
    attendanceSummaryCard("Present",count("Present"))+attendanceSummaryCard("Absent",count("Absent"))+
    attendanceSummaryCard("Half day / leave",count("Half Day")+count("On Leave"));
}
function renderHistory(){
  const rows=document.getElementById("historyRows");
  if(!rows)return;
  renderHistorySummary();
  const query=String(document.getElementById("historySearch")?.value||"").trim().toLowerCase();
  const visible=historyAttendance.filter(row=>{
    const staff=attendanceRelation(row.staff);
    return [staff.full_name,staff.username,attendanceRole(staff.role)].some(value=>String(value||"").toLowerCase().includes(query));
  });
  rows.innerHTML=visible.map(row=>{
    const staff=attendanceRelation(row.staff);
    const name=staff.full_name||staff.username||"Staff member";
    return "<tr><td>"+attendanceEscape(formatAttendanceDate(row.date))+"</td>"+
      "<td><div class='attendance-person'><span class='attendance-avatar' aria-hidden='true'>"+attendanceEscape(attendanceInitials({full_name:name}))+"</span><span><b>"+attendanceEscape(name)+"</b><small>"+attendanceEscape(attendanceRole(staff.role))+"</small></span></div></td>"+
      "<td>"+attendanceEscape(row.status||"Present")+"</td><td>"+attendanceEscape(attendanceTimeLabel(row.check_in))+"</td>"+
      "<td>"+attendanceEscape(attendanceTimeLabel(row.check_out))+"</td><td class='working-hours'>"+
      attendanceEscape(attendanceDuration(row.check_in,row.check_out))+"</td></tr>";
  }).join("")||"<tr><td colspan='6'>"+(historyAttendance.length?"No staff match this search.":"No attendance history found for this range.")+"</td></tr>";
}
let attendancePhotoReviewId="";
function closeAttendancePhotoReview(){
  const modal=document.getElementById("photoReviewDialog");
  if(modal)modal.hidden=true;
  attendancePhotoReviewId="";
}
function openAttendancePhotoReview(staffId){
  const profile=activeStaff.find(person=>String(person.user_id)===String(staffId));
  const record=getDailyRecord(staffId);
  if(!profile||!record?.photo_path)return;
  attendancePhotoReviewId=String(record.id);
  const modal=document.getElementById("photoReviewDialog");
  const reference=document.getElementById("staffReferencePhoto");
  const capture=document.getElementById("staffAttendancePhoto");
  const person=document.getElementById("photoReviewPerson");
  const message=document.getElementById("photoReviewMessage");
  if(reference){reference.src=profile.referencePhotoUrl||"";reference.hidden=!profile.referencePhotoUrl;}
  if(capture){capture.src=record.attendancePhotoUrl||"";capture.hidden=!record.attendancePhotoUrl;}
  if(person)person.textContent=(profile.full_name||profile.username||"Staff member")+" · "+formatAttendanceDate(record.date)+" · "+(record.photo_review_status||"Pending");
  if(message){message.textContent=profile.referencePhotoUrl?"Compare the reference and check-in photos manually.":"No staff profile photo is available for comparison.";message.className="attendance-message";}
  if(modal)modal.hidden=false;
}
async function saveAttendancePhotoReview(decision){
  if(!attendancePhotoReviewId||!["Approved","Rejected"].includes(decision))return;
  const buttons=document.querySelectorAll("[data-photo-decision]");
  buttons.forEach(button=>button.disabled=true);
  setAttendanceMessage("photoReviewMessage","Saving review…","");
  try{
    const {data,error:userError}=await attendanceClient.auth.getUser();
    if(userError||!data.user)throw new Error("Sign in again to review attendance photos.");
    const {error}=await attendanceClient.from("attendance").update({
      photo_review_status:decision,
      photo_reviewed_by:data.user.id,
      photo_reviewed_at:new Date().toISOString()
    }).eq("id",attendancePhotoReviewId);
    if(error)throw new Error(error.message);
    closeAttendancePhotoReview();
    await loadDaily();
    setAttendanceMessage("dailyMessage",decision==="Approved"?"Attendance photo approved after manual review.":"Attendance photo marked for follow-up.","success");
  }catch(error){
    console.error("Attendance photo review failed:",error);
    setAttendanceMessage("photoReviewMessage","Could not save review: "+(error.message||"Unknown error"),"error");
  }finally{
    buttons.forEach(button=>button.disabled=false);
  }
}
async function loadHistory(){
  try{
    const range=historyRange();
    setAttendanceMessage("historyMessage","Loading attendance history…","");
    const {data,error}=await attendanceClient.from("attendance")
      .select("id,staff_id,date,check_in,check_out,status,notes,staff:staff_profiles!attendance_staff_id_fkey(full_name,username,role)")
      .gte("date",range.start).lte("date",range.end)
      .order("date",{ascending:false}).order("check_in",{ascending:true});
    if(error)throw new Error(error.message);
    historyAttendance=Array.isArray(data)?data:[];
    renderHistory();
    setAttendanceMessage("historyMessage",historyAttendance.length
      ?historyAttendance.length+" attendance record"+(historyAttendance.length===1?"":"s")+" in this range."
      :"No attendance history found for this range.","");
  }catch(error){
    console.error("Attendance history failed:",error);
    historyAttendance=[];
    renderHistory();
    setAttendanceMessage("historyMessage",error.message||"Could not load attendance history.","error");
  }
}
function activateAttendanceTab(tab){
  const history=tab==="history";
  document.getElementById("dailyTab").classList.toggle("is-active",!history);
  document.getElementById("dailyTab").setAttribute("aria-selected",String(!history));
  document.getElementById("historyTab").classList.toggle("is-active",history);
  document.getElementById("historyTab").setAttribute("aria-selected",String(history));
  document.getElementById("dailyPanel").hidden=history;
  document.getElementById("historyPanel").hidden=!history;
  if(history)loadHistory();
}
function changeAttendanceDay(offset){
  const date=parseAttendanceDate(selectedAttendanceDate);
  date.setDate(date.getDate()+offset);
  selectedAttendanceDate=attendanceDateKey(date);
  document.getElementById("attendanceDate").value=selectedAttendanceDate;
  loadDaily().catch(error=>{
    console.error("Attendance loading failed:",error);
    setAttendanceMessage("dailyMessage",error.message||"Could not load attendance.","error");
  });
}
function bindAttendanceControls(){
  document.getElementById("dailyTab")?.addEventListener("click",()=>activateAttendanceTab("daily"));
  document.getElementById("historyTab")?.addEventListener("click",()=>activateAttendanceTab("history"));
  document.getElementById("previousDay")?.addEventListener("click",()=>changeAttendanceDay(-1));
  document.getElementById("nextDay")?.addEventListener("click",()=>changeAttendanceDay(1));
  document.getElementById("attendanceDate")?.addEventListener("change",event=>{
    selectedAttendanceDate=event.target.value||attendanceToday();
    loadDaily().catch(error=>{
      console.error("Attendance loading failed:",error);
      setAttendanceMessage("dailyMessage",error.message||"Could not load attendance.","error");
    });
  });
  document.getElementById("staffSearch")?.addEventListener("input",renderDailyRows);
  document.getElementById("historySearch")?.addEventListener("input",renderHistory);
  document.getElementById("historyPeriod")?.addEventListener("change",()=>{
    setHistoryDateInput();
    loadHistory();
  });
  document.getElementById("historyDate")?.addEventListener("change",loadHistory);
  document.getElementById("refreshHistory")?.addEventListener("click",loadHistory);
  document.getElementById("closePhotoReview")?.addEventListener("click",closeAttendancePhotoReview);
  document.getElementById("photoReviewDialog")?.addEventListener("click",event=>{
    if(event.target.id==="photoReviewDialog")closeAttendancePhotoReview();
  });
  document.querySelectorAll("[data-photo-decision]").forEach(button=>{
    button.addEventListener("click",()=>saveAttendancePhotoReview(button.dataset.photoDecision));
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape")closeAttendancePhotoReview();
  });
  document.getElementById("attendanceRefresh")?.addEventListener("click",()=>{
    if(document.getElementById("historyPanel").hidden){
      loadDaily().catch(error=>{
        console.error("Attendance loading failed:",error);
        setAttendanceMessage("dailyMessage",error.message||"Could not load attendance.","error");
      });
    }else loadHistory();
  });
}
async function bootAttendance(){
  bindAttendanceControls();
  selectedAttendanceDate=attendanceToday();
  document.getElementById("attendanceDate").value=selectedAttendanceDate;
  setHistoryDateInput();
  try{
    attendanceClient=bootSupabase();
    const profile=await getMyProfile();
    if(!profile.active||profile.role!=="admin"){
      location.href=profile.role==="inventory_staff"?"products.html":"billing.html";
      throw new Error("Admin access required for attendance.");
    }
    await loadDaily();
  }catch(error){
    console.error("Attendance page failed to initialize:",error);
    setAttendanceMessage("dailyMessage",error.message||"Could not initialize attendance.","error");
    const rows=document.getElementById("attendanceRows");
    if(rows)rows.innerHTML="<tr><td colspan='6'>Attendance could not be loaded.</td></tr>";
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootAttendance,{once:true});
else bootAttendance();