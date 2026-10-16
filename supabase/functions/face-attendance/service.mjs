// All provider evidence is retrieved server-side. A browser's success callback is never proof.
export const CONSENT_VERSION = '2026-10-15-v1';
export class BiometricError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const deny = (code, message, status) => { throw new BiometricError(code, message, status); };
export async function readRequestBody(request, limit = 8192) {
  const oversized = () => deny('INVALID_REQUEST', 'Request is too large.', 413);
  const declared = request.headers.get('Content-Length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) oversized();
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); oversized(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const bytesToBase64 = value => btoa(String.fromCharCode(...value));
const base64ToBytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export async function sealCollection(collection, staffId, encodedKey) {
  const key = await crypto.subtle.importKey('raw', base64ToBytes(encodedKey), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(staffId)}, key, new TextEncoder().encode(collection));
  return ['v1', bytesToBase64(iv), bytesToBase64(new Uint8Array(ciphertext))].join('.');
}
export async function openCollection(sealed, staffId, encodedKey) {
  const [version, iv, ciphertext, extra] = sealed.split('.');
  if (version !== 'v1' || extra || !iv || !ciphertext) throw new Error('Invalid sealed reference');
  const key = await crypto.subtle.importKey('raw', base64ToBytes(encodedKey), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:base64ToBytes(iv), additionalData:new TextEncoder().encode(staffId)}, key, base64ToBytes(ciphertext)));
}
export function configuration(env) {
  const region = env.AWS_REGION || 'ap-south-1';
  const key = env.BIOMETRIC_TEMPLATE_KEY || '';
  let validKey = false;
  try { validKey = base64ToBytes(key).length === 32; } catch { /* fail closed */ }
  const enabled = env.BIOMETRIC_ATTENDANCE_ENABLED === 'true' && env.BIOMETRIC_VALIDATION_APPROVED === 'true'
    && env.AWS_AI_OPT_OUT_CONFIRMED === 'true' && env.BIOMETRIC_RETENTION_READY === 'true' && validKey && region === 'ap-south-1'
    && Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_LIVENESS_ROLE_ARN && env.BIOMETRIC_PRIVACY_CONTACT);
  return {enabled:Boolean(enabled), region, key, notice:{version:CONSENT_VERSION, retention_days:90,
    storage_region:'AWS Mumbai (ap-south-1)', privacy_contact:env.BIOMETRIC_PRIVACY_CONTACT || 'Ask your administrator to configure the privacy contact.'}};
}
export function validateEvidence(result) {
  if (result.status !== 'SUCCEEDED') deny('LIVENESS_FAILED', 'The live check did not complete. Please try again.');
  if (!Number.isFinite(result.confidence) || result.confidence < 95) deny('LIVENESS_FAILED', 'Liveness verification failed. Use the alternative attendance method.');
  if (!(result.image instanceof Uint8Array) || result.image.length === 0) deny('NO_FACE', 'No usable face was returned.');
  if (!Array.isArray(result.faces) || result.faces.length === 0) deny('NO_FACE', 'No face detected. Face the camera in good light.');
  if (result.faces.length !== 1) deny('MULTIPLE_FACES', 'Only one person can be in the camera view.');
  const face = result.faces[0];
  if (!Number.isFinite(face.Confidence) || face.Confidence < 99 || !Number.isFinite(face.Quality?.Brightness)
    || face.Quality.Brightness < 40 || !Number.isFinite(face.Quality?.Sharpness) || face.Quality.Sharpness < 40
    || face.FaceOccluded?.Value !== false || face.Sunglasses?.Value !== false
    || !Number.isFinite(face.Pose?.Yaw) || Math.abs(face.Pose.Yaw) > 20
    || !Number.isFinite(face.Pose?.Pitch) || Math.abs(face.Pose.Pitch) > 20) {
    deny('POOR_QUALITY', 'Face the camera directly in brighter light, with your face fully visible.');
  }
  return result.image;
}
const required = async promise => {
  const {data, error} = await promise;
  if (error) deny('DATABASE_REJECTED', 'The request was rejected. Refresh your attendance and try again.', 409);
  return data;
};
const rpc = async (db, name, args) => required(db.rpc(name, args));
async function enrollment(db, staffId) {
  return required(db.from('biometric_enrollments').select('*').eq('staff_id', staffId).maybeSingle());
}
const visibleEnrollment = row => row ? {status:row.status,sample_count:row.sample_count,expires_at:row.expires_at} : null;
export async function handleOperation({db, provider, actor, env}, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) deny('INVALID_REQUEST', 'Invalid request.');
  const cfg = configuration(env);
  const profile = await required(db.from('staff_profiles').select('user_id,active,role').eq('user_id', actor).maybeSingle());
  if (!profile?.active || !['admin','cashier','inventory_staff'].includes(profile.role)) deny('FORBIDDEN', 'An active staff account is required.', 403);
  const isAdmin = profile.role === 'admin';
  const target = isAdmin ? (body.staff_id || actor) : actor;
  if (!uuid(target) || (body.staff_id && body.staff_id !== target)) deny('FORBIDDEN', 'Use your own signed-in staff account.', 403);
  const current = await enrollment(db, target);
  const operation = body.operation;
  if (operation === 'status') return {enabled:cfg.enabled,enrolled:current?.status === 'active' && Date.parse(current.expires_at) > Date.now(),enrollment:visibleEnrollment(current),notice:cfg.notice,region:cfg.region};
  if (operation === 'cancel' && uuid(body.session_id)) {
    await rpc(db, 'biometric_fail_session', {p_actor:actor,p_session:body.session_id,p_reason:'CANCELLED'});
    return {cancelled:true};
  }
  // Deletion stays available when the production validation switch is off.
  if (operation === 'delete_enrollment') {
    if (!isAdmin) deny('FORBIDDEN', 'Only an administrator can delete enrollment.', 403);
    if (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 500) deny('REASON_REQUIRED', 'Enter the reason for deletion (5–500 characters).');
    if (!current) deny('NOT_ENROLLED', 'This employee has no biometric enrollment.', 404);
    // Compare generation so concurrent deletion cannot delete a replacement enrollment.
    const locked = await rpc(db, 'biometric_request_deletion', {p_actor:actor,p_staff:target,p_generation:current.generation,p_reason:body.reason.trim()});
    if (!locked) deny('CONFLICT', 'Enrollment changed. Refresh and try again.', 409);
    const collection = await openCollection(locked.collection_ref, target, cfg.key);
    await provider.deleteCollection(collection);
    await rpc(db, 'biometric_remove_enrollment', {p_actor:actor,p_staff:target,p_generation:locked.generation,p_reason:body.reason.trim()});
    return {deleted:true};
  }
  if (!cfg.enabled) deny('SERVICE_DISABLED', 'Face attendance is not enabled. Ask an administrator to use the supervised alternative.', 503);
  const start = async (staffId, purpose) => {
    // Reserve/rate-limit before contacting AWS; a temporary UUID never reaches the browser.
    const session = await rpc(db, 'biometric_open_session', {p_actor:actor,p_staff:staffId,p_purpose:purpose,p_provider_session_id:crypto.randomUUID()});
    try {
      const created = await provider.createSession();
      const updated = await required(db.from('biometric_sessions').update({provider_session_id:created})
        .eq('id',session.id).eq('status','pending').select('id').maybeSingle());
      if (!updated) deny('CONFLICT', 'The session was cancelled. Start again.', 409);
      const credentials = await provider.browserCredentials();
      return {session_id:session.id,liveness_session_id:created,region:cfg.region,credentials};
    } catch (error) {
      try { await rpc(db, 'biometric_fail_session', {p_actor:actor,p_session:session.id,p_reason:'PROVIDER_START_FAILED'}); } catch { /* fail closed */ }
      throw error;
    }
  };
  if (operation === 'start_enrollment') {
    if (!isAdmin) deny('FORBIDDEN', 'Only an administrator can initiate enrollment.', 403);
    if (target === actor) deny('FORBIDDEN', 'Select a non-admin employee for enrollment.', 403);
    if (body.consent !== true || body.consent_version !== CONSENT_VERSION) deny('CONSENT_REQUIRED', 'The employee must read and accept the current biometric notice.');
    if (current) deny('ALREADY_ENROLLED', 'Delete the existing enrollment with a reason before enrolling again.', 409);
    const employee = await required(db.from('staff_profiles').select('active,role').eq('user_id', target).maybeSingle());
    if (!employee?.active || !['cashier','inventory_staff'].includes(employee.role)) deny('FORBIDDEN', 'Select an active non-admin employee.', 403);
    const collection = 'rgc-' + crypto.randomUUID();
    await provider.createCollection(collection);
    try {
      await rpc(db, 'biometric_prepare_enrollment', {p_actor:actor,p_staff:target,p_collection_ref:await sealCollection(collection,target,cfg.key),p_consent_version:CONSENT_VERSION});
    } catch (error) { await provider.deleteCollection(collection); throw error; }
    return start(target, 'enrollment');
  }
  if (operation === 'next_enrollment_sample') {
    if (!isAdmin) deny('FORBIDDEN', 'Administrator access required.', 403);
    if (current?.status !== 'pending') deny('NOT_PENDING', 'No enrollment is waiting for samples.');
    return start(target, 'enrollment');
  }
  if (operation === 'start_verification') {
    if (isAdmin) deny('FORBIDDEN', 'Personal attendance is for non-admin employees.', 403);
    if (!['check_in','check_out'].includes(body.action)) deny('INVALID_ACTION', 'Choose check-in or check-out.');
    if (current?.status !== 'active' || Date.parse(current.expires_at) <= Date.now()) deny('NOT_ENROLLED', 'Ask an administrator to enroll or renew your face, or use the alternative method.');
    return start(actor, body.action);
  }
  if (operation !== 'complete' || !uuid(body.session_id)) deny('INVALID_REQUEST', 'Invalid operation or session.');
  const session = await rpc(db, 'biometric_claim_session', {p_actor:actor,p_session:body.session_id});
  let image;
  try {
    const saved = await enrollment(db, session.staff_id);
    if (!saved || saved.generation !== session.enrollment_generation || saved.status === 'deleting') deny('ENROLLMENT_CHANGED', 'Enrollment changed. Start again.', 409);
    const result = await provider.results(session.provider_session_id);
    image = result.image;
    validateEvidence(result);
    const collection = await openCollection(saved.collection_ref, session.staff_id, cfg.key);
    if (session.purpose !== 'enrollment' || saved.sample_count > 0) {
      // Only this selected employee's isolated collection is ever searched.
      const similarity = await provider.match(collection, image);
      if (!Number.isFinite(similarity) || similarity < 99) deny('FACE_MISMATCH', 'Your face did not match this employee. Attendance was not recorded.');
    }
    if (session.purpose === 'enrollment') {
      // Freeze this generation before writing an external vector. If indexing or
      // its commit is interrupted, it must be deleted rather than retried with
      // an uncommitted sample still present in the employee's collection.
      await rpc(db, 'biometric_begin_index', {p_actor:actor,p_session:session.id});
      await provider.index(collection, image);
      const savedEnrollment = await rpc(db, 'biometric_finish_sample', {p_actor:actor,p_session:session.id});
      return {enrollment:visibleEnrollment(savedEnrollment)};
    }
    const attendance = await rpc(db, 'biometric_finish_attendance', {p_actor:actor,p_session:session.id});
    return {attendance};
  } catch (error) {
    // A failing audit write must never turn provider failure into attendance success.
    try { await rpc(db, 'biometric_fail_session', {p_actor:actor,p_session:session.id,p_reason:error instanceof BiometricError ? error.code : 'PROVIDER_ERROR'}); } catch { /* no attendance write */ }
    throw error;
  } finally {
    // Only vectors remain at the provider. No photos, reference bytes or credentials are persisted here.
    if (image instanceof Uint8Array) image.fill(0);
  }
}
