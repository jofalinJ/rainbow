import {describe,it,expect,vi} from 'vitest';
import {selfHostedUrl,selfHostedProvider} from '../../supabase/functions/face-attendance/self-hosted-provider.mjs';
import {configuration,collectionDescriptor,validateSelfHostedEvidence,handleOperation,sealCollection,SELF_HOSTED_CONSENT_VERSION} from '../../supabase/functions/face-attendance/service.mjs';
const STAFF='10000000-0000-4000-8000-000000000001',ADMIN='10000000-0000-4000-8000-000000000002';
const SESSION='20000000-0000-4000-8000-000000000001',PROVIDER_SESSION='30000000-0000-4000-8000-000000000001';
const COLLECTION='rgc-isolated-employee',KEY=Buffer.alloc(32,19).toString('base64');
const env=()=>({BIOMETRIC_PROVIDER:'self_hosted',BIOMETRIC_ATTENDANCE_ENABLED:'true',BIOMETRIC_VALIDATION_APPROVED:'true',BIOMETRIC_RETENTION_READY:'true',
  BIOMETRIC_TEMPLATE_KEY:KEY,BIOMETRIC_PRIVACY_CONTACT:'privacy@example.test',SELF_HOSTED_FACE_URL:'https://faces.example.test',
  SELF_HOSTED_FACE_API_KEY:'s'.repeat(40),SELF_HOSTED_STORAGE_LOCATION:'Test shop server',SELF_HOSTED_PAD_VALIDATED:'true'});
const evidence=()=>({provider:'self_hosted',status:'SUCCEEDED',live_score:.99,frames_verified:6,face_count:1,quality_passed:true,template_token:PROVIDER_SESSION});
async function harness(options={}){
  let row=options.row===null?null:{staff_id:STAFF,status:'active',sample_count:3,consent_version:SELF_HOSTED_CONSENT_VERSION,generation:'generation',expires_at:'2099-01-01T00:00:00Z',
    collection_ref:await sealCollection('self_hosted:'+COLLECTION,STAFF,KEY),...options.row};
  const actor=options.actor||STAFF;
  const profile={user_id:actor,active:true,role:actor===ADMIN?'admin':'cashier'};
  const session={id:SESSION,staff_id:STAFF,enrollment_generation:'generation',provider_session_id:PROVIDER_SESSION,purpose:options.purpose||'check_in'};
  const db={from:vi.fn(table=>{const filters={};const q={select:()=>q,eq:(key,value)=>{filters[key]=value;return q;},update:()=>q,maybeSingle:async()=>({data:table==='staff_profiles'?(filters.user_id===actor?profile:{active:true,role:'cashier'}):table==='biometric_sessions'?{id:SESSION}:row,error:null})};return q;}),
    rpc:vi.fn(async(name,args)=>{
      if(options.rpcError===name)return {data:null,error:{message:'rejected'}};
      if(name==='biometric_claim_session')return {data:session};
      if(name==='biometric_open_session')return {data:{id:SESSION}};
      if(name==='biometric_prepare_enrollment'){row={staff_id:STAFF,...args};return {data:row};}
      if(name==='biometric_request_deletion')return {data:row};
      if(name==='biometric_finish_attendance')return {data:{staff_id:STAFF,check_in_at:'2026-10-17T04:00:00Z'}};
      if(name==='biometric_finish_sample')return {data:{...row,status:'active',sample_count:3}};
      return {data:true};
    })};
  const local={createCollection:vi.fn(async()=>{}),deleteCollection:vi.fn(async()=>{}),createSession:vi.fn(async()=>PROVIDER_SESSION),
    browserCredentials:vi.fn(async()=>({uploadUrl:'https://faces.example.test/v1/sessions/'+PROVIDER_SESSION+'/capture',uploadToken:'u'.repeat(40),expiration:'2099-01-01T00:00:00Z',capture:{frameCount:6,intervalMs:600}})),
    results:vi.fn(async()=>options.evidence||evidence()),match:vi.fn(async()=>options.match||{matched:true,similarity:.7}),index:vi.fn(async()=>{})};
  const aws={deleteCollection:vi.fn(async()=>{})};
  const providerFor=vi.fn(kind=>kind==='self_hosted'?local:aws);
  const context={db,providerFor,actor,env:{...env(),...options.env}};
  return {db,local,aws,providerFor,run:body=>handleOperation(context,body),writes:()=>db.rpc.mock.calls.filter(([name])=>name==='biometric_finish_attendance')};
}
describe('self-hosted provider configuration and evidence',()=>{
  it('needs no AWS credentials and defaults to self-hosted',()=>{
    const values=env();delete values.BIOMETRIC_PROVIDER;
    expect(configuration(values)).toMatchObject({enabled:true,kind:'self_hosted',notice:{version:SELF_HOSTED_CONSENT_VERSION,provider:'self_hosted',storage_region:'Test shop server'}});
  });
  it.each(['SELF_HOSTED_PAD_VALIDATED','BIOMETRIC_VALIDATION_APPROVED','BIOMETRIC_RETENTION_READY','BIOMETRIC_ATTENDANCE_ENABLED'])('stays disabled without %s',key=>{
    expect(configuration({...env(),[key]:'false'}).enabled).toBe(false);
  });
  it.each(['http://faces.example.test','https://user:secret@faces.example.test','https://faces.example.test/path','https://faces.example.test?secret=1','https://faces.example.test#fragment'])('rejects unsafe service URL %s',url=>expect(selfHostedUrl({...env(),SELF_HOSTED_FACE_URL:url})).toBeNull());
  it('allows local HTTP only with the explicit development flag',()=>{
    const values={...env(),SELF_HOSTED_FACE_URL:'http://127.0.0.1:8080'};
    expect(selfHostedUrl(values)).toBeNull();expect(selfHostedUrl({...values,SELF_HOSTED_ALLOW_LOCAL_HTTP:'true'})).toBe('http://127.0.0.1:8080');
  });
  it('keeps old AWS references distinct from self-hosted collections',()=>{
    expect(collectionDescriptor(COLLECTION)).toEqual({kind:'aws',id:COLLECTION});
    expect(collectionDescriptor('self_hosted:'+COLLECTION)).toEqual({kind:'self_hosted',id:COLLECTION});
    expect(()=>collectionDescriptor('self_hosted:../../other')).toThrow();
  });
  it.each([
    ['failed PAD',e=>{e.live_score=.94;}],['untrusted success',e=>{e.status='FAILED';}],['missing frames',e=>{e.frames_verified=5;}],
    ['other session',e=>{e.template_token=SESSION;}],['multiple people',e=>{e.face_count=2;}],['no face',e=>{e.face_count=0;}],
    ['unknown quality',e=>{delete e.quality_passed;}],['unknown provider',e=>{e.provider='browser';}],['nonfinite PAD',e=>{e.live_score=NaN;}],
  ])('rejects %s without writing attendance',async(_name,mutate)=>{
    const result=evidence();mutate(result);const h=await harness({evidence:result});
    await expect(h.run({operation:'complete',session_id:SESSION,verified:true})).rejects.toThrow();
    expect(h.writes()).toHaveLength(0);expect(h.local.match).not.toHaveBeenCalled();
  });
  it('accepts only the protected opaque result token',()=>expect(validateSelfHostedEvidence(evidence(),PROVIDER_SESSION)).toBe(PROVIDER_SESSION));
});
describe('self-hosted authenticated attendance orchestration',()=>{
  it('uses protected provider evidence and the employee collection for a successful punch',async()=>{
    const h=await harness();await expect(h.run({operation:'complete',session_id:SESSION,collection:'client-choice',live_score:1})).resolves.toHaveProperty('attendance.staff_id',STAFF);
    expect(h.local.results).toHaveBeenCalledWith(PROVIDER_SESSION);expect(h.local.match).toHaveBeenCalledWith(COLLECTION,PROVIDER_SESSION);expect(h.writes()).toHaveLength(1);
  });
  it.each([{matched:false,similarity:.9},{matched:true,similarity:.49},{matched:true,similarity:NaN},{matched:true,similarity:1.1}])('rejects invalid matching evidence %j',async match=>{
    const h=await harness({match});await expect(h.run({operation:'complete',session_id:SESSION})).rejects.toMatchObject({code:'FACE_MISMATCH'});expect(h.writes()).toHaveLength(0);
  });
  it('reserves the database attempt before issuing camera upload credentials',async()=>{
    const h=await harness();const start=await h.run({operation:'start_verification',action:'check_in'});
    expect(start.provider).toBe('self_hosted');expect(start.credentials).not.toHaveProperty('secretAccessKey');
    expect(h.local.createSession).toHaveBeenCalledWith({collection:COLLECTION,purpose:'check_in'});
    expect(h.db.rpc.mock.invocationCallOrder[0]).toBeLessThan(h.local.createSession.mock.invocationCallOrder[0]);
  });
  it('never fetches provider evidence when an enrollment belongs to AWS',async()=>{
    const h=await harness({row:{collection_ref:await sealCollection(COLLECTION,STAFF,KEY),consent_version:'2026-10-15-v1'}});
    expect(await h.run({operation:'status'})).toMatchObject({enrolled:false,provider_mismatch:true});
    await expect(h.run({operation:'complete',session_id:SESSION})).rejects.toMatchObject({code:'PROVIDER_CHANGED'});expect(h.local.results).not.toHaveBeenCalled();
  });
  it('deletes legacy AWS templates through AWS even with self-hosted selected and attendance disabled',async()=>{
    const h=await harness({actor:ADMIN,row:{collection_ref:await sealCollection(COLLECTION,STAFF,KEY),consent_version:'2026-10-15-v1'},env:{BIOMETRIC_ATTENDANCE_ENABLED:'false'}});
    await h.run({operation:'delete_enrollment',staff_id:STAFF,reason:'Employee requested provider switch'});
    expect(h.aws.deleteCollection).toHaveBeenCalledWith(COLLECTION);expect(h.local.deleteCollection).not.toHaveBeenCalled();
  });
  it('requires new self-hosted notice consent before creating a collection',async()=>{
    const h=await harness({actor:ADMIN,row:null});
    await expect(h.run({operation:'start_enrollment',staff_id:STAFF,consent:true,consent_version:'2026-10-15-v1'})).rejects.toMatchObject({code:'CONSENT_REQUIRED'});
    expect(h.local.createCollection).not.toHaveBeenCalled();
    await h.run({operation:'start_enrollment',staff_id:STAFF,consent:true,consent_version:SELF_HOSTED_CONSENT_VERSION});
    const args=h.db.rpc.mock.calls.find(([name])=>name==='biometric_prepare_enrollment')[1];
    expect(args.p_consent_version).toBe(SELF_HOSTED_CONSENT_VERSION);
  });
});
describe('self-hosted HTTP adapter',()=>{
  const sessionResponse=()=>({session_id:PROVIDER_SESSION,upload_token:'u'.repeat(40),expires_at:'2099-01-01T00:00:00Z',challenge:{type:'passive_multiframe',frame_count:6}});
  it('sends privileged operations only to the configured server and gives the browser only a scoped token',async()=>{
    const fetchImpl=vi.fn(async()=>Response.json(sessionResponse()));const p=selfHostedProvider(env(),{fetchImpl});
    expect(await p.createSession({collection:COLLECTION,purpose:'check_out'})).toBe(PROVIDER_SESSION);
    const [url,options]=fetchImpl.mock.calls[0];expect(url).toBe('https://faces.example.test/v1/sessions');expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toEqual({collection_id:COLLECTION,mode:'check_out'});expect(options.headers.Authorization).toBe('Bearer '+'s'.repeat(40));
    const credentials=await p.browserCredentials(PROVIDER_SESSION);expect(credentials.uploadUrl).toBe('https://faces.example.test/v1/sessions/'+PROVIDER_SESSION+'/capture');
    expect(JSON.stringify(credentials)).not.toContain('s'.repeat(40));await expect(p.browserCredentials(PROVIDER_SESSION)).rejects.toThrow();
  });
  it('rejects substituted result tokens and never returns embeddings or photos',async()=>{
    const p=selfHostedProvider(env(),{fetchImpl:async()=>Response.json({...evidence(),template_token:SESSION})});
    await expect(p.results(PROVIDER_SESSION)).rejects.toThrow('Mismatched');
  });
  it('fails closed for redirects, bad HTTP and incomplete indexing',async()=>{
    const p=selfHostedProvider(env(),{fetchImpl:async()=>Response.json({indexed:false})});await expect(p.index(COLLECTION,PROVIDER_SESSION)).rejects.toThrow();
    const down=selfHostedProvider(env(),{fetchImpl:async()=>new Response('',{status:503})});await expect(down.createCollection(COLLECTION)).rejects.toThrow();
  });
});
