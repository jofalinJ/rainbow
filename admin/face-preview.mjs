// Optional staff face verification preview with one-time persistent consent.
// This is NOT an authoritative attendance or payroll verification flow.
const HUMAN_URL="https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js";
const HUMAN_MODELS="https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/";
const MIN_FACE_SCORE=0.60;
const MIN_LIVENESS=0.65;
const MIN_SIMILARITY=0.55;
const REQUIRED_FRAMES=3;
const CAPTURE_MS=30_000;
const REQUIRED_MODELS=["blazeface","facemesh","faceres","antispoof","liveness"];
const previewError=(code,message)=>Object.assign(new Error(message),{code});

// Human 3.3.6 can return a GraphModel after a failed download. Its loaded()
// helper only checks object presence; check actual weight loading and execution.
export function assertPreviewModels(engine){
  const stats=engine.models?.stats?.().modelStats;
  const missing=REQUIRED_MODELS.filter(name=>{
    const entry=Array.isArray(stats)?stats.find(model=>model.name===name):null;
    const model=engine.models?.models?.[name];
    return entry?.loaded!==true||!Number.isFinite(entry.sizeLoadedWeights)||entry.sizeLoadedWeights<=0||!model?.executor||typeof model.execute!=="function";
  });
  if(missing.length)throw previewError("MODELS_UNAVAILABLE","The face-check models did not finish loading. Check your connection and press Verify face (preview) to retry.");
}

export function createPreviewEngineLoader(loadModule=()=>import(HUMAN_URL)){
  let human=null,pending=null,reloadWithoutCache=false;
  return async()=>{
    if(human)return human;
    if(!pending)pending=(async()=>{
      let candidate;
      try{
        const module=await loadModule();
        candidate=new module.Human({
          backend:"webgl",modelBasePath:HUMAN_MODELS,cacheModels:!reloadWithoutCache,
          cacheSensitivity:0,filter:{enabled:true,equalization:true},
          face:{enabled:true,detector:{rotation:true,maxDetected:2},
            description:{enabled:true},antispoof:{enabled:true},liveness:{enabled:true},
            iris:{enabled:false},emotion:{enabled:false}},
          body:{enabled:false},hand:{enabled:false},object:{enabled:false},gesture:{enabled:false}
        });
        await candidate.load();
        assertPreviewModels(candidate);
        await candidate.warmup();
        assertPreviewModels(candidate);
        human=candidate;
        return human;
      }catch{
        reloadWithoutCache=true;
        // GraphModel.dispose and Human.reset are provided by the pinned version.
        // reset also makes a later Human load replace failed module-level models.
        for(const model of new Set(Object.values(candidate?.models?.models||{}))){
          try{model?.dispose?.();}catch{/* An incomplete model may have no weights. */}
        }
        try{candidate?.models?.reset?.();candidate?.reset?.();}catch{/* Retry still starts with a new instance. */}
        throw previewError("MODELS_UNAVAILABLE","The face-check models could not initialize. Check your connection and press Verify face (preview) to retry. If it still fails, update Chrome or try another device.");
      }
    })();
    const loading=pending;
    try{return await loading;}finally{if(pending===loading)pending=null;}
  };
}

export function previewFailureMessage(error){
  const code=typeof error?.code==="string"?error.code:error?.name;
  if(["NotAllowedError","PermissionDeniedError"].includes(code))return "Camera access is blocked. In Chrome, open the controls beside the address, then Site settings → Camera → Allow. Also allow Camera for Chrome in your device settings, reload this page and retry. Open the page directly in Chrome if you are using an in-app browser.";
  if(["SecurityError","CAMERA_POLICY_BLOCKED"].includes(code))return "This browser or embedded page is blocking the camera. Open the attendance address directly in Chrome and allow Camera in the site and device settings. A managed device may need its administrator to allow access.";
  if(code==="HTTPS_REQUIRED")return "Camera access requires a secure HTTPS address. Open the shop's HTTPS attendance page directly in Chrome.";
  if(["NotFoundError","DevicesNotFoundError"].includes(code))return "No usable camera was found. Connect or enable a camera and retry.";
  if(["NotReadableError","TrackStartError"].includes(code))return "The camera could not start. Close other camera apps or tabs, check the device's camera privacy setting and retry.";
  if(code==="OverconstrainedError")return "This camera cannot provide the requested video. Try a different camera or device.";
  if(code==="CAMERA_UNAVAILABLE")return "Camera access is unavailable in this browser. Open the HTTPS attendance page directly in an up-to-date Chrome browser.";
  if(code==="CAMERA_NO_IMAGE")return "The camera opened but no video image arrived. Close other camera apps, reload this page and retry.";
  return error?.message||"The camera or face models could not complete this preview. Please retry.";
}

function waitForVideo(video,signal){
  return new Promise((resolve,reject)=>{
    let timer;
    const finish=error=>{clearTimeout(timer);video.removeEventListener("loadeddata",loaded);video.removeEventListener("canplay",loaded);video.removeEventListener("error",failed);signal.removeEventListener("abort",cancelled);error?reject(error):resolve();};
    const loaded=()=>{if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0)finish();};
    const failed=()=>finish(previewError("CAMERA_NO_IMAGE","The camera did not provide a video image."));
    const cancelled=()=>finish(previewError("CANCELLED","Camera stopped."));
    if(signal.aborted){cancelled();return;}
    video.addEventListener("loadeddata",loaded);video.addEventListener("canplay",loaded);video.addEventListener("error",failed);signal.addEventListener("abort",cancelled,{once:true});
    timer=setTimeout(failed,10_000);loaded();
  });
}

export function assessLiveFrame(faces){
  if(!Array.isArray(faces)||faces.length!==1)return {ready:false,reason:"Keep exactly one face visible in the camera."};
  const face=faces[0];
  if(!face?.embedding?.length)return {ready:false,reason:"Position your face clearly in the camera."};
  if(!Number.isFinite(face.faceScore??face.boxScore)||(face.faceScore??face.boxScore)<MIN_FACE_SCORE)return {ready:false,reason:"Move into brighter light and face the camera."};
  if(!Number.isFinite(face.real)||face.real<MIN_LIVENESS)return {ready:false,reason:"Anti-spoofing check has not passed. Use even front lighting, remove glare and face the camera directly."};
  if(!Number.isFinite(face.live)||face.live<MIN_LIVENESS)return {ready:false,reason:"Live-face check has not passed. Keep your whole face visible in even lighting and try again."};
  return {ready:true,reason:"Face checks passed for this frame."};
}

export function assessPilotSimilarity(score,validFrames){
  return Number.isFinite(score)&&score>=MIN_SIMILARITY&&validFrames>=REQUIRED_FRAMES;
}

export function setupFacePilot({document=globalThis.document,window=globalThis.window,navigator=globalThis.navigator,getEngine=createPreviewEngineLoader(),Image=globalThis.Image,URL=globalThis.URL}={}){
  const panel=document.getElementById("facePilot");
  if(!panel)return;
  const consent=document.getElementById("facePilotConsent");
  const start=document.getElementById("facePilotStart");
  const stop=document.getElementById("facePilotStop");
  const video=document.getElementById("facePilotVideo");
  const status=document.getElementById("facePilotStatus");
  let referencePath="",ready=false,running=false,consentBusy=false,stream=null,runToken=0;
  let processing=false,controller=null;
  const updateStatus=(message,kind="")=>{
    status.textContent=message;
    status.className="face-pilot-status"+(kind?" "+kind:"");
  };
  const updateButtons=()=>{
    start.disabled=!ready||!consent.checked||consentBusy||running||processing;
    stop.hidden=!running;
  };
  function stopTracks(value){for(const track of value?.getTracks?.()||[]){try{track.stop();}catch{/* Release the other tracks too. */}}}
  function stopCapture(){
    runToken++;
    running=false;
    controller?.abort();controller=null;
    stopTracks(stream);stream=null;
    video.pause();
    video.srcObject=null;
    video.hidden=true;
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
  const stoppedMessage=message=>message+(processing?" If Verify face stays unavailable, reload this page before retrying.":"");
  stop.addEventListener("click",()=>{stopCapture();updateStatus(stoppedMessage("Camera stopped. No face data was saved."));});
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden"&&running){stopCapture();updateStatus(stoppedMessage("Camera stopped because you left this page."));}
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
      ready=false;updateButtons();
      updateStatus("Unable to verify your enrollment. Please use the existing attendance method.","error");
    }
  }

  async function loadReference(engine,client,signal){
    const {data,error}=await client.storage.from("staff-private").download(referencePath);
    if(signal.aborted)throw previewError("CANCELLED","Camera stopped.");
    if(error||!data)throw new Error("Reference photo is unavailable. Ask an administrator to re-enroll your photo.");
    const url=URL.createObjectURL(data);
    const image=new Image();
    try{
      image.src=url;
      await image.decode();
      if(signal.aborted)throw previewError("CANCELLED","Camera stopped.");
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
    if(!ready||!consent.checked||consentBusy||running||processing)return;
    running=true;const token=++runToken;controller=new AbortController();const signal=controller.signal;updateButtons();
    let message="Test finished. No face data was saved.",kind="",referenceEmbedding=null,captureTimer,startupTimer,ownsProcessing=false;
    updateStatus("Opening the camera… Choose Allow if your browser asks for camera permission.");
    try{
      if(!window.isSecureContext)throw previewError("HTTPS_REQUIRED","Secure HTTPS is required.");
      if(!navigator.mediaDevices?.getUserMedia)throw previewError("CAMERA_UNAVAILABLE","A camera is unavailable in this browser.");
      const policy=document.permissionsPolicy||document.featurePolicy;
      if(policy?.allowsFeature?.("camera")===false)throw previewError("CAMERA_POLICY_BLOCKED","The document policy blocks camera access.");
      // Keep this request in the employee's click handler, before any asynchronous model work.
      const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:"user",width:{ideal:640},height:{ideal:480}}});
      if(token!==runToken){stopTracks(acquired);return;}
      stream=acquired;processing=true;ownsProcessing=true;updateButtons();
      startupTimer=setTimeout(()=>{if(token===runToken){stopCapture();updateStatus("The face models did not respond. Camera stopped. Reload this page before retrying.","error");}},90_000);
      signal.addEventListener("abort",()=>clearTimeout(startupTimer),{once:true});
      video.srcObject=stream;video.hidden=false;
      await Promise.all([video.play(),waitForVideo(video,signal)]);
      if(token!==runToken)return;
      updateStatus("Loading the free face models. The first test may take a minute…");
      const engine=await getEngine();
      if(token!==runToken)return;
      updateStatus("Loading your private reference photo for an on-device comparison…");
      const client=window.bootSupabase();
      referenceEmbedding=await loadReference(engine,client,signal);
      if(token!==runToken)return;
      clearTimeout(startupTimer);
      let consecutiveMatches=0,lastReason="Face checks have not passed yet.";
      const deadline=Date.now()+CAPTURE_MS;
      const notMatched=()=>"Face preview could not confirm a match. "+lastReason+" You may still use your normal attendance button.";
      captureTimer=setTimeout(()=>{if(token===runToken){stopCapture();updateStatus(stoppedMessage(notMatched()),"error");}},CAPTURE_MS);
      updateStatus("Look toward the camera. You have up to 30 seconds; follow the guidance below.");
      while(token===runToken&&Date.now()<deadline){
        const result=await engine.detect(video);
        if(token!==runToken)return;
        if(Date.now()>=deadline)break;
        const verdict=assessLiveFrame(result.face);
        if(verdict.ready){
          const match=engine.match.find(result.face[0].embedding,[referenceEmbedding],{
            order:2,multiplier:25,min:0.2,max:0.8
          });
          const similar=Number.isFinite(match?.similarity)&&match.similarity>=MIN_SIMILARITY;
          consecutiveMatches=similar?consecutiveMatches+1:0;
          if(!similar)lastReason="Your face did not match consistently. Look straight at the camera, move a little closer and use even front lighting.";
        }else{
          consecutiveMatches=0;lastReason=verdict.reason;
        }
        if(consecutiveMatches>=REQUIRED_FRAMES)break;
        updateStatus(consecutiveMatches>0?"Face checks passed. Keep still for the remaining consistent frames…":lastReason);
        await new Promise(resolve=>setTimeout(resolve,Math.min(150,Math.max(0,deadline-Date.now()))));
      }
      if(token!==runToken)return;
      if(consecutiveMatches>=REQUIRED_FRAMES){
        message="Face preview matched your reference. Check in or Check out using the normal attendance button; this preview is not official identity verification.";
        kind="success";
      }else{
        message="Face preview could not confirm a match. "+lastReason+" You may still use your normal attendance button.";
        kind="error";
      }
    }catch(error){
      message="Face test unavailable: "+previewFailureMessage(error)+" The existing attendance method still works.";
      kind="error";
    }finally{
      clearTimeout(captureTimer);clearTimeout(startupTimer);
      referenceEmbedding?.fill(0);referenceEmbedding=null;
      // A stopped older permission request must never change a newer run's state.
      if(ownsProcessing)processing=false;
      if(token===runToken){stopCapture();updateStatus(message,kind);}
      else if(ownsProcessing)updateButtons();
    }
  });

  checkEnrollment();
}

if(typeof document!=="undefined"){
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setupFacePilot,{once:true});
  else setupFacePilot();
}
