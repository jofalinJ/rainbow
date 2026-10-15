let myAttendanceClient=null;
let myAttendanceUserId="";
let myAttendanceRecord=null;
let attendanceReady=false;
let attendanceSaving=false;

function indiaToday(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part=name=>parts.find(value=>value.type===name)?.value||"00";
  return part("year")+"-"+part("month")+"-"+part("day");
}
function indiaDateLabel(value){
  const date=new Date(String(value)+"T12:00:00+05:30");
  return Number.isNaN(date.getTime())?value:date.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata",weekday:"long",day:"numeric",month:"long",year:"numeric"});
}
function attendanceTimeLabel(value){
  if(!value)return "—";
  const parts=String(value).split(":");
  if(parts.length<2)return value;
  let hour=Number(parts[0]),minute=Number(parts[1]);
  if(!Number.isFinite(hour)||!Number.isFinite(minute))return "—";
  const suffix=hour>=12?"pm":"am";
  hour=hour%12||12;
  return hour+":"+String(minute).padStart(2,"0")+" "+suffix;
}
function hoursLabel(checkIn,checkOut){
  if(!checkIn)return "—";
  if(!checkOut)return "In progress";
  const start=String(checkIn).split(":").map(Number);
  const end=String(checkOut).split(":").map(Number);
  if(!Number.isFinite(start[0])||!Number.isFinite(end[0]))return "—";
  let startMinutes=start[0]*60+(start[1]||0),endMinutes=end[0]*60+(end[1]||0);
  if(endMinutes<startMinutes)endMinutes+=1440;
  const duration=endMinutes-startMinutes;
  return Math.floor(duration/60)+"h "+(duration%60)+"m";
}
function setSelfAttendanceMessage(text,kind){
  const el=document.getElementById("selfAttendanceMessage");
  if(el){el.textContent=text||"";el.className="self-attendance-message"+(kind?" "+kind:"");}
}
function renderMyAttendance(){
  const record=myAttendanceRecord;
  const status=document.getElementById("todayAttendanceStatus");
  if(status)status.textContent=record?.check_in?(record.check_out?"Checked out":"Checked in"):"Not checked in";
  const checkIn=document.getElementById("checkInTime");
  const checkOut=document.getElementById("checkOutTime");
  const hours=document.getElementById("workingHours");
  if(checkIn)checkIn.textContent=attendanceTimeLabel(record?.check_in);
  if(checkOut)checkOut.textContent=attendanceTimeLabel(record?.check_out);
  if(hours)hours.textContent=hoursLabel(record?.check_in,record?.check_out);
  const review=document.getElementById("photoReviewStatus");
  if(review){
    const value=record?.photo_review_status||"";
    review.textContent=value==="Pending"?"Your photo is waiting for admin review.":value==="Approved"?"Your check-in photo was reviewed.":value==="Rejected"?"Your photo needs follow-up. Please contact an administrator.":"";
  }
  const checkInButton=document.getElementById("checkInButton");
  const checkOutButton=document.getElementById("checkOutButton");
  if(checkInButton)checkInButton.disabled=!attendanceReady||attendanceSaving||Boolean(record?.check_in);
  if(checkOutButton)checkOutButton.disabled=!attendanceReady||attendanceSaving||!record?.check_in||Boolean(record?.check_out);

}
async function loadMyAttendance(){
  const today=indiaToday();
  const {data,error}=await myAttendanceClient.from("attendance")
    .select("id,staff_id,date,check_in,check_out,status,photo_path,photo_review_status")
    .eq("staff_id",myAttendanceUserId).eq("date",today).maybeSingle();
  if(error)throw new Error(error.message);
  myAttendanceRecord=data||null;
  attendanceReady=true;
  renderMyAttendance();
  setSelfAttendanceMessage(myAttendanceRecord?"Attendance loaded for today.":"Tap Check in when your shift starts.","");
}
async function recordAttendanceAction(action){
  if(!attendanceReady||attendanceSaving)return;
  const record=myAttendanceRecord;
  if(action==="check_in"&&record?.check_in)return;
  if(action==="check_out"&&(!record?.check_in||record.check_out))return;
  attendanceSaving=true;
  renderMyAttendance();
  setSelfAttendanceMessage(action==="check_in"?"Recording your check-in…":"Recording your check-out…","");
  try{
    // The authenticated RPC validates the active staff account and records IST server time.
    const {error}=await myAttendanceClient.rpc("staff_attendance_action",{p_action:action});
    if(error)throw new Error(error.message);
    await loadMyAttendance();
    setSelfAttendanceMessage(action==="check_in"?"Check-in recorded.":"Check-out recorded.","success");
  }catch(error){
    console.error("Staff attendance action failed:",error);
    setSelfAttendanceMessage("Could not record attendance: "+(error.message||"Unknown error"),"error");
  }finally{
    attendanceSaving=false;
    renderMyAttendance();
  }
}
async function bootMyAttendance(){
  document.getElementById("indiaDateLabel").textContent=indiaDateLabel(indiaToday());
  try{
    myAttendanceClient=bootSupabase();
    const session=await requireSession();
    const profile=await getMyProfile();
    if(!profile.active)throw new Error("This staff account is inactive.");
    if(profile.role==="admin"){location.replace("index.html");return;}
    myAttendanceUserId=session.user.id;
    const greeting=document.getElementById("staffGreeting");
    if(greeting)greeting.textContent="Welcome, "+(profile.full_name||profile.username||"staff member")+". Record your attendance for today.";
    await loadMyAttendance();
  }catch(error){
    console.error("My attendance could not load:",error);
    setSelfAttendanceMessage(error.message||"Could not load your attendance.","error");
  }
  document.getElementById("checkInButton")?.addEventListener("click",()=>recordAttendanceAction("check_in"));
  document.getElementById("checkOutButton")?.addEventListener("click",()=>recordAttendanceAction("check_out"));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootMyAttendance,{once:true});
else bootMyAttendance();