let myAttendanceClient=null;
let myAttendanceUserId="";
let myAttendanceProfile=null;
let myAttendanceRecord=null;
let selectedCheckInPhoto=null;
let previewUrl="";

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
  if(checkInButton)checkInButton.disabled=Boolean(record?.check_in);
  if(checkOutButton)checkOutButton.disabled=!record?.check_in||Boolean(record?.check_out);
  const consent=document.getElementById("photoConsent");
  if(consent)consent.disabled=Boolean(record?.check_in);
  const photoInput=document.getElementById("checkInPhoto");
  if(photoInput)photoInput.disabled=Boolean(record?.check_in);
}
async function loadMyAttendance(){
  const today=indiaToday();
  const {data,error}=await myAttendanceClient.from("attendance")
    .select("id,staff_id,date,check_in,check_out,status,photo_path,photo_review_status")
    .eq("staff_id",myAttendanceUserId).eq("date",today).maybeSingle();
  if(error)throw new Error(error.message);
  myAttendanceRecord=data||null;
  renderMyAttendance();
  setSelfAttendanceMessage(myAttendanceRecord?"Attendance loaded for today.":"Take your photo when you are ready to check in.","");
}
function updatePhotoPreview(file){
  selectedCheckInPhoto=file||null;
  const wrap=document.getElementById("photoPreviewWrap");
  const image=document.getElementById("photoPreview");
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl="";
  if(selectedCheckInPhoto){
    previewUrl=URL.createObjectURL(selectedCheckInPhoto);
    if(image)image.src=previewUrl;
    if(wrap)wrap.hidden=false;
  }else{
    if(image)image.removeAttribute("src");
    if(wrap)wrap.hidden=true;
  }
}
async function recordAttendanceAction(action){
  const button=document.getElementById(action==="check_in"?"checkInButton":"checkOutButton");
  if(button)button.disabled=true;
  try{
    let photoPath=null;
    if(action==="check_in"){
      if(!selectedCheckInPhoto)throw new Error("Take or choose a photo to check in.");
      if(!document.getElementById("photoConsent")?.checked)throw new Error("Please confirm that you agree to submit the photo for attendance review.");
      if(!["image/jpeg","image/png","image/webp"].includes(selectedCheckInPhoto.type))throw new Error("Use a JPEG, PNG or WebP image.");
      if(selectedCheckInPhoto.size>5*1024*1024)throw new Error("Choose an image smaller than 5 MB.");
      const extension=selectedCheckInPhoto.type==="image/png"?"png":selectedCheckInPhoto.type==="image/webp"?"webp":"jpg";
      photoPath="attendance/"+myAttendanceUserId+"/"+indiaToday()+"/"+crypto.randomUUID()+"."+extension;
      setSelfAttendanceMessage("Uploading your photo securely…","");
      const {error:uploadError}=await myAttendanceClient.storage.from("staff-private").upload(photoPath,selectedCheckInPhoto,{
        cacheControl:"3600",contentType:selectedCheckInPhoto.type,upsert:false
      });
      if(uploadError)throw new Error(uploadError.message);
    }
    setSelfAttendanceMessage(action==="check_in"?"Recording your check-in…":"Recording your check-out…","");
    const {error}=await myAttendanceClient.rpc("staff_attendance_action",{p_action:action,p_photo_path:photoPath});
    if(error)throw new Error(error.message);
    updatePhotoPreview(null);
    document.getElementById("photoConsent").checked=false;
    await loadMyAttendance();
    setSelfAttendanceMessage(action==="check_in"?"Check-in recorded. Your photo is pending admin review.":"Check-out recorded.","success");
  }catch(error){
    console.error("Staff attendance action failed:",error);
    setSelfAttendanceMessage("Could not record attendance: "+(error.message||"Unknown error"),"error");
    renderMyAttendance();
  }finally{
    if(button&&!myAttendanceRecord?.check_in)button.disabled=false;
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
    myAttendanceProfile=profile;
    myAttendanceUserId=session.user.id;
    const greeting=document.getElementById("staffGreeting");
    if(greeting)greeting.textContent="Welcome, "+(profile.full_name||profile.username||"staff member")+". Record your attendance for today.";
    await loadMyAttendance();
  }catch(error){
    console.error("My attendance could not load:",error);
    setSelfAttendanceMessage(error.message||"Could not load your attendance.","error");
  }
  document.getElementById("checkInPhoto")?.addEventListener("change",event=>{
    const file=event.target.files?.[0]||null;
    updatePhotoPreview(file);
  });
  document.getElementById("removePhoto")?.addEventListener("click",()=>{
    updatePhotoPreview(null);
    const input=document.getElementById("checkInPhoto");if(input)input.value="";
  });
  document.getElementById("checkInButton")?.addEventListener("click",()=>recordAttendanceAction("check_in"));
  document.getElementById("checkOutButton")?.addEventListener("click",()=>recordAttendanceAction("check_out"));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootMyAttendance,{once:true});
else bootMyAttendance();