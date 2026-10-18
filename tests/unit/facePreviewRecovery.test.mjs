import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {assertPreviewModels,assessLiveFrame,createPreviewEngineLoader,previewFailureMessage,setupFacePilot} from "../../admin/face-preview.mjs";

const names=["blazeface","facemesh","faceres","antispoof","liveness"];
const goodFace=()=>({embedding:Array(64).fill(1),faceScore:0.9,real:0.9,live:0.9});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let index=0;index<15;index++)await Promise.resolve();};
function modelEngine(){
  const entries=names.map(name=>({name,loaded:true,sizeLoadedWeights:100}));
  return {
    models:{stats:vi.fn(()=>({modelStats:entries})),models:Object.fromEntries(names.map(name=>[name,{executor:{},execute:vi.fn(),dispose:vi.fn()}])),reset:vi.fn()},
    entries,load:vi.fn().mockResolvedValue(),warmup:vi.fn().mockResolvedValue(),reset:vi.fn(),
  };
}
class Element{
  constructor(){this.listeners=new Map();this.disabled=false;this.hidden=false;this.checked=false;this.textContent="";this.className="";}
  addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  fire(type){return Promise.all([...this.listeners.get(type)||[]].map(callback=>callback({type})));}
}
function harness({camera,engine,getEngine,readyState=2,policy=true,secure=true}={}){
  const ids=["facePilot","facePilotConsent","facePilotStart","facePilotStop","facePilotVideo","facePilotStatus"];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const video=elements.facePilotVideo;
  Object.assign(video,{readyState,videoWidth:readyState?640:0,videoHeight:readyState?480:0,play:vi.fn().mockResolvedValue(),pause:vi.fn(),srcObject:null});
  const track={stop:vi.fn()};const stream={getTracks:()=>[track]};
  const media=camera||vi.fn().mockResolvedValue(stream);
  const download=vi.fn().mockResolvedValue({data:{},error:null});
  const client={rpc:vi.fn(),from:vi.fn(table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==="staff_profiles"?{active:true,photo_path:"profiles/staff-1/reference"}:{consent_version:1,withdrawn_at:null},error:null})})})})),storage:{from:vi.fn(()=>({download}))}};
  const window=new Element();Object.assign(window,{isSecureContext:secure,getAuthUser:vi.fn().mockResolvedValue({id:"staff-1"}),bootSupabase:()=>client});
  const document=new Element();Object.assign(document,{getElementById:id=>elements[id],visibilityState:"visible",permissionsPolicy:{allowsFeature:()=>policy}});
  const Image=class{constructor(){this.removeAttribute=vi.fn();}decode=vi.fn().mockResolvedValue();};
  const URL={createObjectURL:vi.fn(()=>"blob:reference"),revokeObjectURL:vi.fn()};
  const detector=engine||{detect:vi.fn(async()=>({face:[goodFace()]})),match:{find:vi.fn(()=>({similarity:0.9}))}};
  const loadEngine=getEngine||vi.fn().mockResolvedValue(detector);
  setupFacePilot({document,window,navigator:{mediaDevices:{getUserMedia:media}},getEngine:loadEngine,Image,URL});
  return {elements,video,track,stream,media,client,download,window,document,URL,engine:detector,getEngine:loadEngine,start:()=>elements.facePilotStart.fire("click"),stop:()=>elements.facePilotStop.fire("click"),status:()=>elements.facePilotStatus.textContent};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));});
afterEach(()=>{vi.useRealTimers();});

describe("Human model initialization recovery",()=>{
  it.each(names)("requires loaded weights and an executable %s model",name=>{
    const engine=modelEngine();expect(()=>assertPreviewModels(engine)).not.toThrow();
    engine.entries.find(entry=>entry.name===name).loaded=false;
    expect(()=>assertPreviewModels(engine)).toThrow(/models did not finish loading/);
    engine.entries.find(entry=>entry.name===name).loaded=true;
    engine.models.models[name].executor=null;
    expect(()=>assertPreviewModels(engine)).toThrow(/models did not finish loading/);
  });
  it("rejects empty weights even when stale global stats claim a model is loaded",()=>{
    const engine=modelEngine();engine.entries[0].sizeLoadedWeights=0;
    expect(()=>assertPreviewModels(engine)).toThrow(/models did not finish loading/);
  });
  it("discards a failed candidate, resets module-level models and retries without the bad model cache",async()=>{
    const first=modelEngine(),second=modelEngine(),configurations=[];
    first.entries.find(entry=>entry.name==="antispoof").loaded=false;
    const candidates=[first,second];const loadModule=vi.fn(async()=>({Human:class{constructor(config){configurations.push(config);return candidates.shift();}}}));
    const getEngine=createPreviewEngineLoader(loadModule);
    await expect(getEngine()).rejects.toMatchObject({code:"MODELS_UNAVAILABLE"});
    expect(first.warmup).not.toHaveBeenCalled();expect(first.reset).toHaveBeenCalledOnce();
    for(const model of Object.values(first.models.models))expect(model.dispose).toHaveBeenCalledOnce();
    expect(await getEngine()).toBe(second);expect(await getEngine()).toBe(second);
    expect(loadModule).toHaveBeenCalledTimes(2);expect(configurations[0].cacheModels).toBe(true);expect(configurations[1].cacheModels).toBe(false);
  });
  it("retries synchronous import and warmup failures without retaining a rejected initialization",async()=>{
    const candidate=modelEngine();candidate.warmup.mockRejectedValueOnce(new Error("GPU initialization failed"));
    const loadModule=vi.fn().mockImplementationOnce(()=>{throw new Error("CDN unavailable");}).mockResolvedValue({Human:class{constructor(){return candidate;}}});
    const getEngine=createPreviewEngineLoader(loadModule);
    await expect(getEngine()).rejects.toMatchObject({code:"MODELS_UNAVAILABLE"});
    await expect(getEngine()).rejects.toMatchObject({code:"MODELS_UNAVAILABLE"});
    expect(await getEngine()).toBe(candidate);expect(loadModule).toHaveBeenCalledTimes(3);
  });
  it("shares one initialization when callers arrive together",async()=>{
    const candidate=modelEngine(),loading=deferred();candidate.load.mockReturnValue(loading.promise);
    const loadModule=vi.fn(async()=>({Human:class{constructor(){return candidate;}}}));const getEngine=createPreviewEngineLoader(loadModule);
    const first=getEngine(),second=getEngine();await flush();expect(candidate.load).toHaveBeenCalledOnce();
    loading.resolve();expect(await first).toBe(candidate);expect(await second).toBe(candidate);expect(loadModule).toHaveBeenCalledOnce();
  });
});

describe("camera preview recovery and lifecycle",()=>{
  it("requests camera permission on the explicit click and explains a denial without starting inference",async()=>{
    const camera=vi.fn().mockRejectedValue(Object.assign(new Error("Permission denied"),{name:"NotAllowedError"}));const ui=harness({camera});await flush();
    expect(camera).not.toHaveBeenCalled();const task=ui.start();expect(camera).toHaveBeenCalledOnce();expect(ui.status()).toContain("Choose Allow");await task;
    expect(ui.status()).toContain("Site settings → Camera → Allow");expect(ui.status()).toContain("device settings");expect(ui.getEngine).not.toHaveBeenCalled();expect(ui.elements.facePilotStart.disabled).toBe(false);expect(ui.client.rpc).not.toHaveBeenCalled();
  });
  it.each([[{policy:false},"embedded page"],[{secure:false},"HTTPS"]])("explains browser context restrictions before requesting camera access",async(options,text)=>{
    const ui=harness(options);await flush();await ui.start();expect(ui.status()).toContain(text);expect(ui.media).not.toHaveBeenCalled();
  });
  it("waits for actual video data before loading models",async()=>{
    const ui=harness({readyState:0});await flush();const task=ui.start();await flush();expect(ui.getEngine).not.toHaveBeenCalled();
    Object.assign(ui.video,{readyState:2,videoWidth:640,videoHeight:480});await ui.video.fire("loadeddata");await flush();expect(ui.getEngine).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(350);await task;expect(ui.status()).toContain("matched your reference");expect(ui.track.stop).toHaveBeenCalledOnce();expect(ui.video.srcObject).toBeNull();
  });
  it("fails with a useful video error and releases the camera when no image arrives",async()=>{
    const ui=harness({readyState:0});await flush();const task=ui.start();await flush();await vi.advanceTimersByTimeAsync(10_000);await task;
    expect(ui.status()).toContain("no video image arrived");expect(ui.getEngine).not.toHaveBeenCalled();expect(ui.track.stop).toHaveBeenCalledOnce();expect(ui.elements.facePilotStart.disabled).toBe(false);
  });
  it("reports a model initialization failure separately and permits a fresh successful attempt",async()=>{
    const ui=harness();ui.getEngine.mockRejectedValueOnce(Object.assign(new Error("Models could not initialize. Retry."),{code:"MODELS_UNAVAILABLE"}));await flush();await ui.start();
    expect(ui.status()).toContain("Models could not initialize");expect(ui.engine.detect).not.toHaveBeenCalled();expect(ui.elements.facePilotStart.disabled).toBe(false);
    const task=ui.start();await flush();await vi.advanceTimersByTimeAsync(350);await task;
    expect(ui.status()).toContain("matched your reference");expect(ui.getEngine).toHaveBeenCalledTimes(2);expect(ui.URL.revokeObjectURL).toHaveBeenCalledOnce();expect(ui.client.rpc).not.toHaveBeenCalled();
  });
  it("continues beyond eighteen frames with live PAD guidance and fails closed at thirty seconds",async()=>{
    const ui=harness();ui.engine.detect.mockImplementation(async input=>({face:[input===ui.video?{...goodFace(),real:0.1}:goodFace()]}));await flush();const task=ui.start();await flush();
    await vi.advanceTimersByTimeAsync(3_000);expect(ui.engine.detect.mock.calls.filter(([input])=>input===ui.video).length).toBeGreaterThan(18);expect(ui.status()).toContain("Anti-spoofing check has not passed");expect(ui.status()).toContain("lighting");expect(ui.track.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(27_000);await task;expect(ui.status()).toContain("could not confirm a match");expect(ui.engine.match.find).not.toHaveBeenCalled();expect(ui.track.stop).toHaveBeenCalledOnce();expect(ui.client.rpc).not.toHaveBeenCalled();
  });
  it("resets consecutive matches after a failed PAD frame and requires three new qualified matches",async()=>{
    const ui=harness();let frames=0;ui.engine.detect.mockImplementation(async input=>({face:[input===ui.video&&++frames===3?{...goodFace(),real:0.64}:goodFace()]}));await flush();const task=ui.start();await flush();
    await vi.advanceTimersByTimeAsync(350);expect(ui.status()).toContain("Anti-spoofing check has not passed");expect(ui.track.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);await task;expect(frames).toBe(6);expect(ui.engine.match.find).toHaveBeenCalledTimes(5);expect(ui.status()).toContain("not official identity verification");
  });
  it("stops a late camera grant from an older cancelled request without overwriting a newer attempt",async()=>{
    const first=deferred(),second=deferred();const camera=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);const ui=harness({camera});await flush();
    const oldTask=ui.start();await ui.stop();const newTask=ui.start();const oldTrack={stop:vi.fn()};first.resolve({getTracks:()=>[oldTrack]});await oldTask;
    expect(oldTrack.stop).toHaveBeenCalledOnce();expect(ui.status()).toContain("Opening the camera");expect(ui.getEngine).not.toHaveBeenCalled();expect(ui.video.srcObject).toBeNull();
    second.resolve(ui.stream);await flush();await vi.advanceTimersByTimeAsync(350);await newTask;expect(ui.status()).toContain("matched your reference");expect(ui.track.stop).toHaveBeenCalledOnce();
  });
  it("does not load a reference or restart capture when model loading finishes after cancellation",async()=>{
    const loading=deferred();const ui=harness({getEngine:vi.fn(()=>loading.promise)});await flush();const task=ui.start();await flush();await ui.stop();expect(ui.track.stop).toHaveBeenCalledOnce();
    loading.resolve(ui.engine);await task;expect(ui.download).not.toHaveBeenCalled();expect(ui.status()).toContain("Camera stopped");expect(ui.elements.facePilotStart.disabled).toBe(false);expect(ui.engine.detect).not.toHaveBeenCalled();
  });
  it("stops the camera and explains reload when model initialization never responds",async()=>{
    const loading=deferred();const ui=harness({getEngine:vi.fn(()=>loading.promise)});await flush();const task=ui.start();await flush();
    await vi.advanceTimersByTimeAsync(90_000);expect(ui.track.stop).toHaveBeenCalledOnce();expect(ui.video.srcObject).toBeNull();expect(ui.status()).toContain("models did not respond");expect(ui.status()).toContain("Reload this page");expect(ui.elements.facePilotStart.disabled).toBe(true);
    loading.resolve(ui.engine);await task;expect(ui.engine.detect).not.toHaveBeenCalled();expect(ui.elements.facePilotStart.disabled).toBe(false);
  });
  it("stops at the capture deadline and explains reload without racing a stalled inference",async()=>{
    const stalled=deferred();const ui=harness();ui.engine.detect.mockImplementation(input=>input===ui.video?stalled.promise:Promise.resolve({face:[goodFace()]}));await flush();const task=ui.start();await flush();
    await vi.advanceTimersByTimeAsync(30_000);expect(ui.track.stop).toHaveBeenCalledOnce();expect(ui.status()).toContain("could not confirm a match");expect(ui.status()).toContain("reload this page");expect(ui.elements.facePilotStart.disabled).toBe(true);
    await ui.start();expect(ui.media).toHaveBeenCalledOnce();stalled.resolve({face:[goodFace()]});await task;expect(ui.engine.match.find).not.toHaveBeenCalled();expect(ui.elements.facePilotStart.disabled).toBe(false);
  });
  it("releases video waiting listeners when the employee stops before image readiness",async()=>{
    const ui=harness({readyState:0});await flush();const task=ui.start();await flush();await ui.stop();await task;
    expect(ui.track.stop).toHaveBeenCalledOnce();expect(ui.video.listeners.get("loadeddata").size).toBe(0);expect(ui.getEngine).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
});

describe("preview decision boundaries",()=>{
  it.each([undefined,NaN,0,0.64])("does not accept missing or insufficient anti-spoof confidence %s",real=>{expect(assessLiveFrame([{...goodFace(),real}]).ready).toBe(false);});
  it.each([undefined,NaN,0,0.64])("does not accept missing or insufficient live confidence %s",live=>{expect(assessLiveFrame([{...goodFace(),live}]).ready).toBe(false);});
  it("rejects nonfinite detection confidence rather than advancing to matching",()=>{expect(assessLiveFrame([{...goodFace(),faceScore:NaN}]).ready).toBe(false);});
  it.each([["NotFoundError","No usable camera"],["NotReadableError","Close other camera"],["OverconstrainedError","requested video"]])("distinguishes %s from a failed biometric check",(name,text)=>{expect(previewFailureMessage({name})).toContain(text);});
});
