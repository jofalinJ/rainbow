// Shared UI boundary. A browser callback never establishes biometric success:
// only the authenticated complete endpoint may commit attendance.
export function escapeHTML(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
export function indiaToday(now=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  return ["year","month","day"].map(key=>parts.find(part=>part.type===key)?.value).join("-");
}
export function timeLabel(value){
  if(!value)return "—";
  const date=new Date(String(value).includes("T")?value:"2000-01-01T"+value+"+05:30");
  return Number.isNaN(date.getTime())?"—":date.toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata",hour:"numeric",minute:"2-digit"});
}
export function durationLabel(record){
  if(!record?.check_in_at&&!record?.check_in)return "—";
  if(!record?.check_out_at&&!record?.check_out)return "In progress";
  let seconds=Number(record?.working_seconds);
  if(record?.working_seconds==null){
    const start=record.check_in_at?Date.parse(record.check_in_at):Date.parse("2000-01-01T"+record.check_in+"+05:30");
    let end=record.check_out_at?Date.parse(record.check_out_at):Date.parse("2000-01-01T"+record.check_out+"+05:30");
    if(!record.check_out_at&&end<start)end+=86400000;
    seconds=(end-start)/1000;
  }
  if(!Number.isFinite(seconds)||seconds<0)return "—";
  const minutes=Math.floor(seconds/60);
  return Math.floor(minutes/60)+"h "+minutes%60+"m";
}
const ERRORS={
  camera_access_denied:"Camera permission was denied. Allow camera access in Chrome site settings, then try again.",
  notallowederror:"Camera permission was denied. Allow camera access in Chrome site settings, then try again.",
  permission_denied:"Camera permission was denied. Allow camera access in Chrome site settings, then try again.",
  notfounderror:"No camera is available. Connect or enable the tablet's front camera and try again.",
  camera_unavailable:"The camera is unavailable or in use. Close other camera apps and try again.",
  notreadableerror:"The camera is unavailable or in use. Close other camera apps and try again.",
  no_face:"No face was detected. Face the camera in even lighting and try again.",
  multiple_faces:"More than one face was detected. Only the employee being verified should be in view.",
  poor_quality:"The face capture was unclear. Improve the lighting, remove glare and keep your face inside the guide.",
  poor_lighting:"The face capture was unclear. Improve the lighting, remove glare and keep your face inside the guide.",
  face_mismatch:"The face did not match this staff account. Attendance was not recorded. Contact an administrator if you need help.",
  match_failed:"The face did not match this staff account. Attendance was not recorded. Contact an administrator if you need help.",
  liveness_failed:"Liveness verification did not pass. Attendance was not recorded. Follow the camera instructions and try again.",
  not_enrolled:"Face enrollment is missing. Ask an administrator to enroll you, or request a manual attendance entry.",
  enrollment_required:"Face enrollment is missing. Ask an administrator to enroll you, or request a manual attendance entry.",
  already_checked_in:"You have already checked in today. Refresh to see your attendance.",
  already_checked_out:"You have already checked out today. Refresh to see your attendance.",
  session_expired:"Your verification session expired. Start a new face check.",
  unauthorized:"Your sign-in has expired. Sign in again before starting a new face check.",
  configuration_required:"Face attendance is not configured. Ask an administrator to complete the secure service setup. Manual attendance is available through an administrator.",
  feature_disabled:"Face attendance is not enabled. Ask an administrator about manual attendance.",
  service_disabled:"Face attendance is not enabled. Ask an administrator about manual attendance.",
  network_error:"The service could not be reached. Check your connection and refresh attendance before retrying.",
  cancelled:"Camera check cancelled. Attendance was not recorded."
};
export function biometricError(error){
  const code=String(error?.code||error?.state||error?.name||"").toLowerCase();
  const cameraName=String(error?.name||error?.error?.name||"").toLowerCase();
  if(/camera_access/.test(code)&&ERRORS[cameraName])return ERRORS[cameraName];
  if(/multiple_faces/.test(code))return ERRORS.multiple_faces;
  if(/face_distance|face_movement|face_fit|face_not_detected|face_detection/.test(code))return ERRORS.poor_quality;
  if(/mobile_landscape/.test(code))return "Rotate your tablet to portrait orientation, then start a new camera check.";
  if(/connection_timeout|freshness_timeout|timeout/.test(code))return "The live capture timed out. Check your connection, follow the instructions and start again.";
  if(/pending|session_in_progress/.test(code))return "A face session is still pending. Cancel it or wait up to three minutes before retrying. Refresh attendance before you start again.";
  if(ERRORS[code])return ERRORS[code];
  if(/camera.*access|permission|notallowed/.test(code))return ERRORS.camera_access_denied;
  if(/camera.*(not|unavailable)|notreadable|notfound/.test(code))return ERRORS.camera_unavailable;
  if(/auth_expired/.test(code))return ERRORS.unauthorized;
  if(/fetch|network|connection/i.test(error?.message||""))return ERRORS.network_error;
  if(/jwt|unauth|sign.in|token.*expired/i.test(error?.message||""))return ERRORS.unauthorized;
  return error?.message||"Verification could not be completed. Attendance was not recorded. Please try again or contact an administrator.";
}
export async function faceRequest(client,operation,body={}){
  const {data,error}=await client.functions.invoke("face-attendance",{body:{operation,...body}});
  if(error){
    let payload;
    try{payload=await error.context?.json();}catch{/* Network errors have no JSON response. */}
    const failure=new Error(payload?.error||payload?.message||error.message||"Face service request failed.");
    failure.code=payload?.code||error.code;
    throw failure;
  }
  if(data?.error){const failure=new Error(data.error);failure.code=data.code;throw failure;}
  return data||{};
}
export function noticeHTML(notice){
  const complete=notice?.version&&notice?.retention_days!=null&&notice?.storage_region&&notice?.privacy_contact;
  if(!complete)return "<p class='notice-unavailable'>The privacy notice is not configured. Enrollment is unavailable until an administrator completes the service setup.</p>";
  const local=notice.provider==="self_hosted";
  const processing=local?"The shop's self-hosted service processes six camera frames using OpenCV face matching and pretrained passive anti-spoofing models.":"Amazon Rekognition processes live camera captures for liveness and compares your face with your enrolled biometric template.";
  const storage=local?"configured shop server location":"configured AWS service region";
  return "<p>Rainbow uses face verification to confirm your identity when recording work attendance. "+processing+" Three live enrollment samples are required.</p><p>Templates are encrypted at rest in the "+storage+": <strong>"+escapeHTML(notice.storage_region)+"</strong>. Authorized administrators manage enrollment; the secured attendance service performs matching. Raw capture photos are not retained by this application by default.</p><p>Active enrollment expires after <strong>"+escapeHTML(notice.retention_days)+" days</strong>; incomplete enrollment expires after <strong>24 hours</strong>. Expired enrollment cannot be used for attendance. Scheduled deletion runs daily, so expired templates may remain for up to 24 hours after expiry before cleanup. Failed deletions are retried and may take longer. You can decline or request deletion and ask for a manual attendance alternative recorded by an administrator. Contact <strong>"+escapeHTML(notice.privacy_contact)+"</strong>. Attendance and audit records are retained separately under the employer's policy.</p><p class='notice-version'>Notice version "+escapeHTML(notice.version)+" · Ask your administrator about access, correction or deletion.</p>";
}
export function noticeReady(notice){return Boolean(notice?.version&&notice?.retention_days!=null&&notice?.storage_region&&notice?.privacy_contact);}
export function captureLiveness({client,start,dialog,container,message,provider=()=>globalThis.RainbowLiveness}){
  return new Promise((resolve,reject)=>{
    let cleanup=()=>{},settled=false,completing=false;
    const cancelButton=dialog.querySelector("[data-capture-cancel]");
    function release(){try{cleanup();}catch{/* Cleanup must never bypass a failed verification. */}container.replaceChildren();dialog.hidden=true;cancelButton?.removeEventListener("click",cancel);globalThis.removeEventListener?.("pagehide",cancel);dialog.removeEventListener?.("keydown",escape);}
    function finish(error,result,cancelSession=false){if(settled)return;settled=true;release();if(cancelSession&&start?.session_id){void faceRequest(client,"cancel",{session_id:start.session_id}).catch(()=>{});}if(error)reject(error);else resolve(result);}
    function cancel(){if(completing)return;const error=new Error("Camera check cancelled.");error.code="cancelled";finish(error,null,true);}
    function escape(event){if(event.key==="Escape")cancel();}
    cancelButton?.addEventListener("click",cancel);
    globalThis.addEventListener?.("pagehide",cancel,{once:true});
    dialog.addEventListener?.("keydown",escape);
    dialog.hidden=false;
    if(cancelButton)cancelButton.disabled=false;
    message.textContent="Face the front camera. Stay alone in view, use even lighting and follow the on-screen instructions.";
    Promise.resolve().then(async()=>{
      if(settled)return;
      if(!globalThis.isSecureContext&&globalThis.location?.hostname!=="localhost")throw Object.assign(new Error("Camera verification requires a secure HTTPS connection."),{code:"https_required"});
      if(!globalThis.navigator?.mediaDevices?.getUserMedia)throw Object.assign(new Error("A camera is unavailable in this browser. Use Android Chrome over HTTPS."),{code:"camera_unavailable"});
      if(!start?.session_id||!start?.liveness_session_id||!start?.credentials)throw new Error("The secure camera session could not start. Please try again.");
      const widget=provider();
      if(!widget?.mount)throw new Error("The secure camera component is unavailable. Refresh this page or contact an administrator.");
      cleanup=widget.mount(container,{
        kind:start.provider,sessionId:start.liveness_session_id,region:start.region,credentials:start.credentials,capture:start.capture,
        onComplete:async()=>{
          if(settled||completing)return;
          completing=true;
          if(cancelButton)cancelButton.disabled=true;
          message.textContent="Capture received. The secure service is checking liveness and identity…";
          try{const result=await faceRequest(client,"complete",{session_id:start.session_id});finish(null,result);}catch(error){finish(error);}finally{if(cancelButton)cancelButton.disabled=false;}
        },
        onError:error=>{if(settled||completing)return;finish(Object.assign(new Error(error?.message||error?.error?.message||"Camera verification failed."),{code:error?.code||error?.state||error?.name,name:error?.name||error?.error?.name||"Error"}),null,true);},
        onCancel:cancel
      })||(()=>{});
      if(settled)cleanup();else cancelButton?.focus();
    }).catch(error=>finish(error,null,true));
  });
}
