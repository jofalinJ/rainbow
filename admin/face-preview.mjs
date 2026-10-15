// Optional staff face verification preview with one-time persistent consent.
// This is NOT an authoritative attendance or payroll verification flow.
const HUMAN_URL="https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js";
const HUMAN_MODELS="https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/";
const MIN_FACE_SCORE=0.60;
const MIN_LIVENESS=0.65;
const MIN_SIMILARITY=0.55;
const REQUIRED_FRAMES=3;

export function assessLiveFrame(faces){
  if(!Array.isArray(faces)||faces.length!==1)return {ready:false,reason:"Keep exactly one face visible in the camera."};
  const face=faces[0];
  if(!face?.embedding?.length)return {ready:false,reason:"Position your face clearly in the camera."};
  if(Number(face.faceScore??face.boxScore??0)<MIN_FACE_SCORE)return {ready:false,reason:"Move into brighter light and face the camera."};
  if(!Number.isFinite(face.real)||face.real<MIN_LIVENESS)return {ready:false,reason:"Anti-spoofing check has not passed."};
  if(!Number.isFinite(face.live)||face.live<MIN_LIVENESS)return {ready:false,reason:"Live-face check has not passed."};
  return {ready:true,reason:"Face checks passed for this frame."};
}

export function assessPilotSimilarity(score,validFrames){
  return Number.isFinite(score)&&score>=MIN_SIMILARITY&&validFrames>=REQUIRED_FRAMES;
}

function setupFacePilot(){
  const panel=document.getElementById("facePilot");
  if(!panel)return;
  const consent=document.getElementById("facePilotConsent");
  const start=document.getElementById("facePilotStart");
  const stop=document.getElementById("facePilotStop");
  const video=document.getElementById("facePilotVideo");
  const status=document.getElementById("facePilotStatus");
  let referencePath="",ready=false,running=false,consentBusy=false,stream=null,runToken=0;
  let human=null,referenceEmbedding=null;
  const updateStatus=(message,kind="")=>{
    status.textContent=message;
    status.className="face-pilot-status"+(kind?" "+kind:"");
  };
  const updateButtons=()=>{
    start.disabled=!ready||!consent.checked||consentBusy||running;
    stop.hidden=!running;
  };
  function stopCapture(){
    runToken++;
    running=false;
    if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
    video.pause();
    video.srcObject=null;
    video.hidden=true;
    referenceEmbedding=null;
    // Keep the already-loaded engine for a faster repeat test while this page remains open.
    updateButtons();
  }
  consent.addEventListener("change",async()=>{
    if(consentBusy)return;
    consentBusy=true;
    updateButtons();
    const chosen=consent.checked;
    if(!chosen&&running)stopCapture();
    try{
      const user=await window.getAuthUser();
      const client=window.bootSupabase();
      if(chosen){
        if(!ready)throw new Error("Ask an administrator to enroll your reference photo first.");
        const now=new Date().toISOString();
        const {error}=await client.from("staff_face_preview_consent").upsert({
          staff_id:user.id,consent_version:1,consented_at:now,
          withdrawn_at:null,updated_at:now
        },{onConflict:"staff_id"});
        if(error)throw error;
        updateStatus("Consent saved. You may start a face comparison preview without accepting again.");
      }else{
        const {error}=await client.from("staff_face_preview_consent").update({
          withdrawn_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("staff_id",user.id);
        if(error)throw error;
        updateStatus("Consent withdrawn. Face comparison is unavailable until you opt in again.");
      }
    }catch(error){
      consent.checked=!chosen;
      updateStatus("Consent could not be saved: "+(error.message||"Please try again."),"error");
    }finally{consentBusy=false;updateButtons();}
  });
  stop.addEventListener("click",()=>{stopCapture();updateStatus("Camera stopped. No face data was saved.");});
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden"&&running){stopCapture();updateStatus("Camera stopped because you left this page.");}
  });
  window.addEventListener("pagehide",stopCapture);

  async function checkEnrollment(){
    try{
      // Recheck staff identity; do not rely on any client-stored account or profile.
      const user=await window.getAuthUser();
      const {data,error}=await window.bootSupabase()
        .from("staff_profiles").select("active,photo_path")
        .eq("user_id",user.id).maybeSingle();
      if(error)throw new Error(error.message);
      const exactPath="profiles/"+user.id+"/reference";
      if(!data?.active||data.photo_path!==exactPath){
        updateStatus("No reference photo is enrolled. Ask an administrator to add your profile photo before trying this optional test.");
        ready=false;updateButtons();return;
      }
      referencePath=exactPath;
      const {data:record,error:consentError}=await window.bootSupabase()
        .from("staff_face_preview_consent").select("consent_version,withdrawn_at")
        .eq("staff_id",user.id).maybeSingle();
      if(consentError)throw new Error(consentError.message);
      ready=true;
      consent.checked=record?.consent_version===1&&!record.withdrawn_at;
      updateStatus(consent.checked
        ?"Reference photo and consent ready. Face comparison is optional."
        :"Reference photo enrolled. Review the privacy information and opt in once to enable this preview.");
      updateButtons();
    }catch(error){
      console.warn("Face pilot enrollment could not load",error);
      ready=false;updateButtons();
      updateStatus("Unable to verify your enrollment. Please use the existing attendance method.","error");
    }
  }

  async function getHuman(){
    if(!human){
      // Models load from a pinned third-party CDN; this code does not transmit captured images to that host.
      const module=await import(HUMAN_URL);
      human=new module.Human({
        backend:"webgl",modelBasePath:HUMAN_MODELS,
        cacheSensitivity:0,filter:{enabled:true,equalization:true},
        face:{enabled:true,detector:{rotation:true,maxDetected:2},
          description:{enabled:true},antispoof:{enabled:true},liveness:{enabled:true},
          iris:{enabled:false},emotion:{enabled:false}},
        body:{enabled:false},hand:{enabled:false},object:{enabled:false},gesture:{enabled:false}
      });
      await human.load();
      await human.warmup();
    }
    return human;
  }

  async function loadReference(engine,client){
    const {data,error}=await client.storage.from("staff-private").download(referencePath);
    if(error||!data)throw new Error("Reference photo is unavailable. Ask an administrator to re-enroll your photo.");
    const url=URL.createObjectURL(data);
    const image=new Image();
    try{
      image.src=url;
      await image.decode();
      const detected=await engine.detect(image);
      const faces=detected.face||[];
      if(faces.length!==1||!faces[0]?.embedding?.length)
        throw new Error("Reference photo must contain exactly one clear face. Ask an administrator to replace it.");
      return [...faces[0].embedding];
    }finally{
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
    }
  }

  start.addEventListener("click",async()=>{
    if(!ready||!consent.checked||consentBusy||running)return;
    running=true;const token=++runToken;updateButtons();
    let message="Test finished. No face data was saved.",kind="";
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext)throw new Error("A secure browser connection with camera support is required.");
      // Camera permission is requested only after the staff member explicitly opts in.
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:"user",width:{ideal:640},height:{ideal:480}}});
      if(token!==runToken){stream.getTracks().forEach(track=>track.stop());stream=null;return;}
      video.srcObject=stream;video.hidden=false;
      await video.play();
      updateStatus("Loading the free face models. The first test may take a minute…");
      const engine=await getHuman();
      if(token!==runToken)return;
      updateStatus("Loading your private reference photo for an on-device comparison…");
      const client=window.bootSupabase();
      referenceEmbedding=await loadReference(engine,client);
      if(token!==runToken)return;
      let samples=0,score=0,lastReason="Face checks have not passed yet.";
      updateStatus("Look toward the camera. Please stay still while the test checks your face…");
      for(let i=0;i<18&&token===runToken;i++){
        const result=await engine.detect(video);
        if(token!==runToken)return;
        const verdict=assessLiveFrame(result.face);
        if(verdict.ready){
          const match=engine.match.find(result.face[0].embedding,[referenceEmbedding],{
            order:2,multiplier:25,min:0.2,max:0.8
          });
          if(Number.isFinite(match.similarity)){score=Math.max(score,match.similarity);samples++;}
        }else lastReason=verdict.reason;
        if(assessPilotSimilarity(score,samples))break;
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      if(token!==runToken)return;
      if(assessPilotSimilarity(score,samples)){
        message="Face preview matched your reference. Check in or Check out using the normal attendance button; this preview is not official identity verification.";
        kind="success";
      }else{
        message="Face preview could not confirm a match. "+lastReason+" You may still use your normal attendance button.";
        kind="error";
      }
    }catch(error){
      console.warn("Local face verification test failed",error);
      message="Face test unavailable: "+(error.message||"Camera or model error")+". The existing attendance method still works.";
      kind="error";
    }finally{
      if(token===runToken){stopCapture();updateStatus(message,kind);}
    }
  });

  checkEnrollment();
}

if(typeof document!=="undefined"){
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setupFacePilot,{once:true});
  else setupFacePilot();
}
