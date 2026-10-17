import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import {
  CONSENT_VERSION, configuration, sealCollection, openCollection, validateEvidence, handleOperation,
} from '../../supabase/functions/face-attendance/service.mjs';

const STAFF = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const ADMIN = '10000000-0000-4000-8000-000000000003';
const SESSION = '20000000-0000-4000-8000-000000000001';
const GENERATION = '30000000-0000-4000-8000-000000000001';
const COLLECTION = 'rgc-isolated-employee-enrollment';
const KEY = Buffer.alloc(32, 17).toString('base64');
const validEnv = () => ({
  BIOMETRIC_PROVIDER: 'aws',
  AWS_REGION: 'ap-south-1', BIOMETRIC_TEMPLATE_KEY: KEY,
  BIOMETRIC_ATTENDANCE_ENABLED: 'true', BIOMETRIC_VALIDATION_APPROVED: 'true', AWS_AI_OPT_OUT_CONFIRMED: 'true', BIOMETRIC_RETENTION_READY: 'true',
  AWS_ACCESS_KEY_ID: 'server-access-key', AWS_SECRET_ACCESS_KEY: 'server-secret-never-returned',
  AWS_LIVENESS_ROLE_ARN: 'arn:aws:iam::123456789012:role/liveness-only',
  BIOMETRIC_PRIVACY_CONTACT: 'privacy@example.test',
});
const goodEvidence = () => ({
  status: 'SUCCEEDED', confidence: 99.9, image: new Uint8Array([25, 50, 75, 100]),
  faces: [{Confidence: 99.99, Quality: {Brightness: 70, Sharpness: 80},
    Pose: {Yaw: 1, Pitch: 2}, FaceOccluded: {Value: false}, Sunglasses: {Value: false}}],
});
const attendance = {id: 'attendance-result', staff_id: STAFF, check_in: '09:30:00', date: '2026-10-15'};

// Only the database boundary is simulated. Query/RPC calls are observable, including any
// attempt to write attendance after bad provider evidence or rejected session claims.
async function harness(options = {}) {
  const actor = options.actor ?? STAFF;
  const profile = options.profile ?? {user_id: actor, active: true, role: actor === ADMIN ? 'admin' : 'cashier'};
  const row = options.row === null ? null : {
    staff_id: STAFF, status: 'active', sample_count: 3, generation: GENERATION,
    expires_at: '2099-01-01T00:00:00Z', collection_ref: await sealCollection(COLLECTION, STAFF, KEY),
    ...options.row,
  };
  const session = {
    id: SESSION, staff_id: STAFF, enrollment_generation: GENERATION,
    provider_session_id: 'aws-server-created-session', purpose: 'check_in', ...options.session,
  };
  const evidence = options.evidence ?? goodEvidence();
  let claimed = false;
  const sessionUpdates = [];
  const errors = options.rpcErrors ?? {};
  const db = {
    from: vi.fn(table => {
      const filters = {};
      let updates;
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((name, value) => { filters[name] = value; return query; }),
        update: vi.fn(value => { updates = value; return query; }),
        maybeSingle: vi.fn(async () => {
          if (table === 'staff_profiles') return {data: filters.user_id === actor ? profile : {active: true, role: 'cashier'}, error: null};
          if (table === 'biometric_sessions') {
            sessionUpdates.push({updates, filters: {...filters}});
            return {data: {id: SESSION}, error: null};
          }
          if (table !== 'biometric_enrollments') throw new Error(`Unexpected table ${table}`);
          if (updates && row && (!filters.generation || filters.generation === row.generation)) Object.assign(row, updates);
          return {data: row, error: null};
        }),
      };
      return query;
    }),
    rpc: vi.fn(async (name, args) => {
      if (errors[name]) return {data: null, error: errors[name]};
      if (name === 'biometric_claim_session') {
        if (claimed) return {data: null, error: {message: 'Session already claimed'}};
        claimed = true;
        return {data: session, error: null};
      }
      if (name === 'biometric_open_session') return {data: {id: SESSION}, error: null};
      if (name === 'biometric_finish_attendance') return {data: attendance, error: null};
      if (name === 'biometric_finish_sample') return {data: {...row, status: 'active', sample_count: 3}, error: null};
      if (name === 'biometric_request_deletion') {
        Object.assign(row, {status: 'deleting', expires_at: new Date().toISOString()});
        return {data: row, error: null};
      }
      if (['biometric_begin_index', 'biometric_fail_session', 'biometric_prepare_enrollment', 'biometric_remove_enrollment'].includes(name)) return {data: true, error: null};
      throw new Error(`Unexpected RPC ${name}: ${JSON.stringify(args)}`);
    }),
  };
  const credentials = {accessKeyId: 'temporary-client-access', secretAccessKey: 'temporary-client-secret',
    sessionToken: 'temporary-token', expiration: '2099-01-01T00:00:00.000Z'};
  const provider = {
    createSession: vi.fn(async () => 'aws-server-created-session'),
    browserCredentials: vi.fn(async () => credentials),
    results: vi.fn(async () => evidence),
    match: vi.fn(async () => options.similarity ?? 99.9),
    index: vi.fn(async () => undefined),
    createCollection: vi.fn(async () => undefined),
    deleteCollection: vi.fn(async () => undefined),
    ...options.provider,
  };
  const context = {db, provider, actor, env: {...validEnv(), ...options.env}};
  return {context, db, provider, row, session, evidence, credentials, sessionUpdates,
    run: body => handleOperation(context, body),
    rpcCalls: name => db.rpc.mock.calls.filter(([called]) => called === name),
  };
}

describe('encrypted biometric reference protection', () => {
  it('round-trips using the bound employee and a fresh IV on each encryption', async () => {
    const first = await sealCollection(COLLECTION, STAFF, KEY);
    const second = await sealCollection(COLLECTION, STAFF, KEY);
    expect(first).not.toBe(second);
    expect(first).not.toContain(COLLECTION);
    await expect(openCollection(first, STAFF, KEY)).resolves.toBe(COLLECTION);
    await expect(openCollection(second, STAFF, KEY)).resolves.toBe(COLLECTION);
  });

  it('rejects another employee, another key, tampered ciphertext, and malformed envelopes', async () => {
    const sealed = await sealCollection(COLLECTION, STAFF, KEY);
    await expect(openCollection(sealed, OTHER, KEY)).rejects.toThrow();
    await expect(openCollection(sealed, STAFF, Buffer.alloc(32, 18).toString('base64'))).rejects.toThrow();
    const parts = sealed.split('.');
    const cipher = Buffer.from(parts[2], 'base64');
    cipher[0] ^= 1;
    parts[2] = cipher.toString('base64');
    await expect(openCollection(parts.join('.'), STAFF, KEY)).rejects.toThrow();
    for (const bad of ['v2.iv.cipher', sealed + '.extra', 'v1..']) {
      await expect(openCollection(bad, STAFF, KEY)).rejects.toThrow();
    }
  });
});

describe('production configuration gates', () => {
  it('enables only the fully configured validated Mumbai service', () => {
    expect(configuration(validEnv()).enabled).toBe(true);
    for (const field of ['BIOMETRIC_ATTENDANCE_ENABLED', 'BIOMETRIC_VALIDATION_APPROVED', 'AWS_AI_OPT_OUT_CONFIRMED', 'BIOMETRIC_RETENTION_READY',
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_LIVENESS_ROLE_ARN', 'BIOMETRIC_PRIVACY_CONTACT']) {
      expect(configuration({...validEnv(), [field]: ''}).enabled, field).toBe(false);
    }
    for (const key of ['', 'not-base64!', Buffer.alloc(16).toString('base64')]) {
      expect(configuration({...validEnv(), BIOMETRIC_TEMPLATE_KEY: key}).enabled).toBe(false);
    }
    expect(configuration({...validEnv(), AWS_REGION: 'us-east-1'}).enabled).toBe(false);
    expect(configuration({...validEnv(), BIOMETRIC_ATTENDANCE_ENABLED: 'TRUE'}).enabled).toBe(false);
  });

  it('allows a safe status response but rejects starts before provider calls when disabled', async () => {
    const h = await harness({env: {BIOMETRIC_VALIDATION_APPROVED: 'false'}});
    const status = await h.run({operation: 'status'});
    expect(status).toMatchObject({enabled: false, enrolled: true, notice: {version: CONSENT_VERSION}});
    expect(JSON.stringify(status)).not.toContain(COLLECTION);
    expect(JSON.stringify(status)).not.toContain(KEY);
    await expect(h.run({operation: 'start_verification', action: 'check_in'})).rejects.toMatchObject({code: 'SERVICE_DISABLED'});
    expect(h.provider.createSession).not.toHaveBeenCalled();
    expect(h.provider.browserCredentials).not.toHaveBeenCalled();
  });
});

describe('server-derived biometric evidence and attendance', () => {
  it('completes a verified staff check-in using only its stored provider session and collection', async () => {
    const h = await harness();
    await expect(h.run({operation: 'complete', session_id: SESSION, isLive: false,
      similarity: 0, provider_session_id: 'client-substitute', collection: 'roster'})).resolves.toEqual({attendance});
    expect(h.provider.results).toHaveBeenCalledExactlyOnceWith('aws-server-created-session');
    expect(h.provider.match.mock.calls[0][0]).toBe(COLLECTION);
    expect(h.rpcCalls('biometric_finish_attendance')).toEqual([['biometric_finish_attendance', {p_actor: STAFF, p_session: SESSION}]]);
    expect(h.rpcCalls('biometric_fail_session')).toHaveLength(0);
    expect(h.evidence.image).toEqual(new Uint8Array(4));
  });

  const badEvidenceCases = [
    ['incomplete liveness', value => { value.status = 'IN_PROGRESS'; }, 'LIVENESS_FAILED'],
    ['failed liveness', value => { value.confidence = 94.99; }, 'LIVENESS_FAILED'],
    ['nonfinite liveness', value => { value.confidence = NaN; }, 'LIVENESS_FAILED'],
    ['missing bytes', value => { value.image = new Uint8Array(); }, 'NO_FACE'],
    ['untrusted image type', value => { value.image = 'client-image'; }, 'NO_FACE'],
    ['no face', value => { value.faces = []; }, 'NO_FACE'],
    ['multiple faces', value => { value.faces.push({...value.faces[0]}); }, 'MULTIPLE_FACES'],
    ['dim face', value => { value.faces[0].Quality.Brightness = 39.99; }, 'POOR_QUALITY'],
    ['blurred face', value => { value.faces[0].Quality.Sharpness = 39.99; }, 'POOR_QUALITY'],
    ['missing quality', value => { delete value.faces[0].Quality; }, 'POOR_QUALITY'],
    ['occluded face', value => { value.faces[0].FaceOccluded.Value = true; }, 'POOR_QUALITY'],
    ['sunglasses', value => { value.faces[0].Sunglasses.Value = true; }, 'POOR_QUALITY'],
    ['missing occlusion attribute', value => { delete value.faces[0].FaceOccluded; }, 'POOR_QUALITY'],
    ['unknown occlusion attribute', value => { value.faces[0].FaceOccluded.Value = undefined; }, 'POOR_QUALITY'],
    ['nonboolean occlusion attribute', value => { value.faces[0].FaceOccluded.Value = 'false'; }, 'POOR_QUALITY'],
    ['missing sunglasses attribute', value => { delete value.faces[0].Sunglasses; }, 'POOR_QUALITY'],
    ['unknown sunglasses attribute', value => { value.faces[0].Sunglasses.Value = undefined; }, 'POOR_QUALITY'],
    ['nonboolean sunglasses attribute', value => { value.faces[0].Sunglasses.Value = 'false'; }, 'POOR_QUALITY'],
    ['extreme yaw', value => { value.faces[0].Pose.Yaw = 20.01; }, 'POOR_QUALITY'],
    ['extreme pitch', value => { value.faces[0].Pose.Pitch = -20.01; }, 'POOR_QUALITY'],
    ['nonfinite pose', value => { value.faces[0].Pose.Yaw = Infinity; }, 'POOR_QUALITY'],
    ['low detection confidence', value => { value.faces[0].Confidence = 98.99; }, 'POOR_QUALITY'],
  ];
  it.each(badEvidenceCases)('records no attendance for %s despite a browser success claim', async (_name, mutate, code) => {
    const evidence = goodEvidence();
    mutate(evidence);
    const h = await harness({evidence});
    await expect(h.run({operation: 'complete', session_id: SESSION, isLive: true, similarity: 100})).rejects.toMatchObject({code});
    expect(h.provider.match).not.toHaveBeenCalled();
    expect(h.provider.index).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
    expect(h.rpcCalls('biometric_fail_session')[0]?.[1].p_reason).toBe(code);
    if (evidence.image instanceof Uint8Array) expect(evidence.image).toEqual(new Uint8Array(evidence.image.length));
  });

  it.each([98.99, NaN, Infinity])('rejects provider similarity %s without writing attendance', async similarity => {
    const h = await harness({similarity});
    await expect(h.run({operation: 'complete', session_id: SESSION, similarity: 100})).rejects.toMatchObject({code: 'FACE_MISMATCH'});
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
    expect(h.evidence.image).toEqual(new Uint8Array(4));
  });

  it('cannot turn provider errors or failure-audit errors into attendance success', async () => {
    const providerError = new Error('Provider timeout');
    const h = await harness({provider: {results: vi.fn(async () => { throw providerError; })},
      rpcErrors: {biometric_fail_session: {message: 'Audit unavailable'}}});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toBe(providerError);
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
    expect(h.rpcCalls('biometric_fail_session')[0][1].p_reason).toBe('PROVIDER_ERROR');
  });

  it('never reads provider results after a rejected expired/cross-actor/replayed database claim', async () => {
    const h = await harness({rpcErrors: {biometric_claim_session: {message: 'Not owned, expired, or already used'}}});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toMatchObject({code: 'DATABASE_REJECTED'});
    expect(h.provider.results).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
  });

  it('allows only one completion when the atomic database claim rejects a concurrent replay', async () => {
    const h = await harness();
    const result = await Promise.allSettled([h.run({operation: 'complete', session_id: SESSION}), h.run({operation: 'complete', session_id: SESSION})]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect(h.provider.results).toHaveBeenCalledTimes(1);
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(1);
  });

  it.each([{generation: 'replacement'}, {status: 'deleting'}])('rejects enrollment replacement/deletion before fetching evidence: %j', async row => {
    const h = await harness({row});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toMatchObject({code: 'ENROLLMENT_CHANGED'});
    expect(h.provider.results).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
  });

  it('fails closed for an encrypted collection moved to another employee', async () => {
    const h = await harness({row: {collection_ref: await sealCollection(COLLECTION, OTHER, KEY)}});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toThrow();
    expect(h.provider.match).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
    expect(h.provider.results).not.toHaveBeenCalled();
  });

  it('rejects a staff request naming another employee before any claim or credential request', async () => {
    const h = await harness();
    await expect(h.run({operation: 'start_verification', staff_id: OTHER, action: 'check_in'})).rejects.toMatchObject({code: 'FORBIDDEN'});
    await expect(h.run({operation: 'complete', staff_id: OTHER, session_id: SESSION})).rejects.toMatchObject({code: 'FORBIDDEN'});
    expect(h.db.rpc).not.toHaveBeenCalled();
    expect(h.provider.browserCredentials).not.toHaveBeenCalled();
  });

  it.each([{active: false, role: 'cashier'}, {active: true, role: 'customer'}])('rejects inactive or unauthorized profiles: %j', async profile => {
    const h = await harness({profile});
    await expect(h.run({operation: 'status'})).rejects.toMatchObject({code: 'FORBIDDEN'});
    expect(h.db.rpc).not.toHaveBeenCalled();
  });
});

describe('authorized enrollment and temporary browser credentials', () => {
  it('rejects nonadmin enrollment and admin personal verification', async () => {
    const staff = await harness({row: null});
    await expect(staff.run({operation: 'start_enrollment', consent: true, consent_version: CONSENT_VERSION})).rejects.toMatchObject({code: 'FORBIDDEN'});
    expect(staff.provider.createCollection).not.toHaveBeenCalled();
    const admin = await harness({actor: ADMIN});
    await expect(admin.run({operation: 'start_verification', action: 'check_in'})).rejects.toMatchObject({code: 'FORBIDDEN'});
    expect(admin.provider.browserCredentials).not.toHaveBeenCalled();
  });

  it.each([{consent: false, consent_version: CONSENT_VERSION}, {consent: true, consent_version: 'old'}, {}])('requires affirmative current consent: %j', async consent => {
    const h = await harness({actor: ADMIN, row: null});
    await expect(h.run({operation: 'start_enrollment', staff_id: STAFF, ...consent})).rejects.toMatchObject({code: 'CONSENT_REQUIRED'});
    expect(h.provider.createCollection).not.toHaveBeenCalled();
    expect(h.provider.browserCredentials).not.toHaveBeenCalled();
  });

  it('creates a bound encrypted reference and persists consent before returning enrollment credentials', async () => {
    const h = await harness({actor: ADMIN, row: null});
    const result = await h.run({operation: 'start_enrollment', staff_id: STAFF, consent: true, consent_version: CONSENT_VERSION});
    const collection = h.provider.createCollection.mock.calls[0][0];
    const prepared = h.rpcCalls('biometric_prepare_enrollment')[0][1];
    expect(prepared).toMatchObject({p_actor: ADMIN, p_staff: STAFF, p_consent_version: CONSENT_VERSION});
    expect(prepared.p_collection_ref).not.toContain(collection);
    await expect(openCollection(prepared.p_collection_ref, STAFF, KEY)).resolves.toBe(collection);
    expect(h.rpcCalls('biometric_open_session')[0][1]).toMatchObject({p_actor: ADMIN, p_staff: STAFF, p_purpose: 'enrollment'});
    expect(result.credentials).toEqual(h.credentials);
    expect(JSON.stringify(result)).not.toContain('server-secret-never-returned');
  });

  it('deletes the new provider collection if preparing the enrollment fails', async () => {
    const h = await harness({actor: ADMIN, row: null, rpcErrors: {biometric_prepare_enrollment: {message: 'Concurrent enrollment exists'}}});
    await expect(h.run({operation: 'start_enrollment', staff_id: STAFF, consent: true, consent_version: CONSENT_VERSION})).rejects.toMatchObject({code: 'DATABASE_REJECTED'});
    expect(h.provider.deleteCollection).toHaveBeenCalledExactlyOnceWith(h.provider.createCollection.mock.calls[0][0]);
    expect(h.provider.browserCredentials).not.toHaveBeenCalled();
  });

  it('checks a later sample against the same employee before indexing and finalizing', async () => {
    const h = await harness({actor: ADMIN, row: {status: 'pending', sample_count: 2}, session: {purpose: 'enrollment'}});
    await expect(h.run({operation: 'complete', session_id: SESSION})).resolves.toMatchObject({enrollment: {status: 'active', sample_count: 3}});
    expect(h.provider.match.mock.calls[0][0]).toBe(COLLECTION);
    expect(h.provider.index.mock.calls[0][0]).toBe(COLLECTION);
    expect(h.provider.match.mock.invocationCallOrder[0]).toBeLessThan(h.provider.index.mock.invocationCallOrder[0]);
    expect(h.rpcCalls('biometric_begin_index')).toEqual([['biometric_begin_index', {p_actor: ADMIN, p_session: SESSION}]]);
    const beginIndexCall = h.db.rpc.mock.calls.findIndex(([name]) => name === 'biometric_begin_index');
    const finishSampleCall = h.db.rpc.mock.calls.findIndex(([name]) => name === 'biometric_finish_sample');
    expect(h.db.rpc.mock.invocationCallOrder[beginIndexCall]).toBeLessThan(h.provider.index.mock.invocationCallOrder[0]);
    expect(h.provider.index.mock.invocationCallOrder[0]).toBeLessThan(h.db.rpc.mock.invocationCallOrder[finishSampleCall]);
    expect(h.rpcCalls('biometric_finish_sample')).toHaveLength(1);
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
  });

  it('does not create an external vector when the database rejects freezing an enrollment sample', async () => {
    const h = await harness({actor: ADMIN, row: {status: 'pending', sample_count: 1}, session: {purpose: 'enrollment'},
      rpcErrors: {biometric_begin_index: {message: 'Enrollment changed or session cancelled'}}});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toMatchObject({code: 'DATABASE_REJECTED'});
    expect(h.provider.match).toHaveBeenCalledTimes(1);
    expect(h.provider.index).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_finish_sample')).toHaveLength(0);
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
    expect(h.rpcCalls('biometric_fail_session')[0]?.[1].p_reason).toBe('DATABASE_REJECTED');
    expect(h.evidence.image).toEqual(new Uint8Array(4));
  });

  it('cannot report enrollment or attendance success after an external indexing failure', async () => {
    const indexError = new Error('Indexing interrupted after sending image');
    const h = await harness({actor: ADMIN, row: {status: 'pending', sample_count: 1}, session: {purpose: 'enrollment'},
      provider: {index: vi.fn(async () => { throw indexError; })}});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toBe(indexError);
    expect(h.rpcCalls('biometric_begin_index')).toHaveLength(1);
    expect(h.provider.index).toHaveBeenCalledTimes(1);
    expect(h.rpcCalls('biometric_finish_sample')).toHaveLength(0);
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
    expect(h.rpcCalls('biometric_fail_session')[0]?.[1].p_reason).toBe('PROVIDER_ERROR');
    expect(h.evidence.image).toEqual(new Uint8Array(4));
  });

  it('cannot report success when the database rejects committing an indexed enrollment sample', async () => {
    const h = await harness({actor: ADMIN, row: {status: 'pending', sample_count: 2}, session: {purpose: 'enrollment'},
      rpcErrors: {biometric_finish_sample: {message: 'Session cancelled while indexing'}}});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toMatchObject({code: 'DATABASE_REJECTED'});
    expect(h.rpcCalls('biometric_begin_index')).toHaveLength(1);
    expect(h.provider.index).toHaveBeenCalledTimes(1);
    expect(h.rpcCalls('biometric_finish_sample')).toHaveLength(1);
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
    expect(h.rpcCalls('biometric_fail_session')[0]?.[1].p_reason).toBe('DATABASE_REJECTED');
    expect(h.evidence.image).toEqual(new Uint8Array(4));
  });

  it('does not add a different person as a later enrollment sample', async () => {
    const h = await harness({actor: ADMIN, row: {status: 'pending', sample_count: 1}, session: {purpose: 'enrollment'}, similarity: 50});
    await expect(h.run({operation: 'complete', session_id: SESSION})).rejects.toMatchObject({code: 'FACE_MISMATCH'});
    expect(h.provider.index).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_finish_sample')).toHaveLength(0);
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
  });

  it('returns credentials only after the database approves a server-derived action', async () => {
    const h = await harness();
    const result = await h.run({operation: 'start_verification', action: 'check_out', collection: 'client-chosen'});
    expect(h.rpcCalls('biometric_open_session')[0][1]).toMatchObject({p_actor: STAFF, p_staff: STAFF, p_purpose: 'check_out'});
    expect(h.rpcCalls('biometric_open_session')[0][1].p_provider_session_id).toMatch(/^[\da-f-]{36}$/i);
    expect(h.sessionUpdates).toEqual([{updates: {provider_session_id: 'aws-server-created-session'}, filters: {id: SESSION, status: 'pending'}}]);
    expect(result).toEqual({provider: 'aws', session_id: SESSION, liveness_session_id: 'aws-server-created-session', region: 'ap-south-1', credentials: h.credentials});
    const rejected = await harness({rpcErrors: {biometric_open_session: {message: 'Session limit reached'}}});
    await expect(rejected.run({operation: 'start_verification', action: 'check_in'})).rejects.toMatchObject({code: 'DATABASE_REJECTED'});
    expect(rejected.provider.createSession).not.toHaveBeenCalled();
    expect(rejected.provider.browserCredentials).not.toHaveBeenCalled();
  });

  it('does not contact the provider for an expired enrollment or invalid attendance action', async () => {
    const expired = await harness({row: {expires_at: '2000-01-01T00:00:00Z'}});
    await expect(expired.run({operation: 'start_verification', action: 'check_in'})).rejects.toMatchObject({code: 'NOT_ENROLLED'});
    expect(expired.provider.createSession).not.toHaveBeenCalled();
    const invalid = await harness();
    await expect(invalid.run({operation: 'start_verification', action: 'client-anything'})).rejects.toMatchObject({code: 'INVALID_ACTION'});
    expect(invalid.provider.createSession).not.toHaveBeenCalled();
  });

  it('keeps deletion available while disabled, and does not remove the record on provider deletion failure', async () => {
    const h = await harness({actor: ADMIN, env: {BIOMETRIC_ATTENDANCE_ENABLED: 'false'},
      provider: {deleteCollection: vi.fn(async () => { throw new Error('Temporary delete failure'); })}});
    await expect(h.run({operation: 'delete_enrollment', staff_id: STAFF, reason: 'Employee withdrew consent'})).rejects.toThrow('Temporary delete failure');
    expect(h.row.status).toBe('deleting');
    expect(h.rpcCalls('biometric_request_deletion')).toEqual([['biometric_request_deletion', {
      p_actor: ADMIN, p_staff: STAFF, p_generation: GENERATION, p_reason: 'Employee withdrew consent',
    }]]);
    expect(h.rpcCalls('biometric_remove_enrollment')).toHaveLength(0);
    expect(h.provider.browserCredentials).not.toHaveBeenCalled();
  });

  it('does not delete a provider collection when the database rejects a stale enrollment generation', async () => {
    const h = await harness({actor: ADMIN, rpcErrors: {biometric_request_deletion: {message: 'Enrollment generation changed'}}});
    await expect(h.run({operation: 'delete_enrollment', staff_id: STAFF, reason: 'Employee withdrew consent'})).rejects.toMatchObject({code: 'DATABASE_REJECTED'});
    expect(h.provider.deleteCollection).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_remove_enrollment')).toHaveLength(0);
  });
});

describe('cancelling server-owned liveness sessions', () => {
  it('keeps cancellation available while face attendance is disabled without fetching evidence or credentials', async () => {
    const h = await harness({env: {BIOMETRIC_ATTENDANCE_ENABLED: 'false'}});
    await expect(h.run({operation: 'cancel', session_id: SESSION, reason: 'browser claimed success'})).resolves.toEqual({cancelled: true});
    expect(h.rpcCalls('biometric_fail_session')).toEqual([['biometric_fail_session', {p_actor: STAFF, p_session: SESSION, p_reason: 'CANCELLED'}]]);
    expect(h.provider.results).not.toHaveBeenCalled();
    expect(h.provider.browserCredentials).not.toHaveBeenCalled();
    expect(h.provider.index).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_finish_attendance')).toHaveLength(0);
  });

  it('does not report cancellation success when the database rejects another actor or completed session', async () => {
    const h = await harness({rpcErrors: {biometric_fail_session: {message: 'Session is not owned or cancellable'}}});
    await expect(h.run({operation: 'cancel', session_id: SESSION})).rejects.toMatchObject({code: 'DATABASE_REJECTED'});
    expect(h.provider.results).not.toHaveBeenCalled();
    expect(h.rpcCalls('biometric_claim_session')).toHaveLength(0);
  });

  it('rejects a malformed cancellation identifier before writing a session or contacting the provider', async () => {
    const h = await harness();
    await expect(h.run({operation: 'cancel', session_id: 'another-session'})).rejects.toMatchObject({code: 'INVALID_REQUEST'});
    expect(h.db.rpc).not.toHaveBeenCalled();
    expect(h.provider.results).not.toHaveBeenCalled();
    expect(h.provider.browserCredentials).not.toHaveBeenCalled();
  });

  it('rejects cancellation naming another employee before invoking its database policy', async () => {
    const h = await harness();
    await expect(h.run({operation: 'cancel', session_id: SESSION, staff_id: OTHER})).rejects.toMatchObject({code: 'FORBIDDEN'});
    expect(h.db.rpc).not.toHaveBeenCalled();
    expect(h.provider.results).not.toHaveBeenCalled();
  });
});

// Execute the actual adapter implementation with inert SDK command classes. Only module
// imports/types are removed; all policy/request/result logic below is production source.
function providerWithSdk(send, env = validEnv(), clientConfigurations = []) {
  const path = new URL('../../supabase/functions/face-attendance/aws-provider.ts', import.meta.url);
  const source = stripTypeScriptTypes(readFileSync(path, 'utf8').replace(/^import[\s\S]*?from 'npm:[^']+';\s*/gm, '')).replace('export function awsProvider', 'function awsProvider');
  const names = ['RekognitionClient', 'STSClient', 'CreateCollectionCommand', 'DeleteCollectionCommand',
    'CreateFaceLivenessSessionCommand', 'GetFaceLivenessSessionResultsCommand', 'DetectFacesCommand',
    'IndexFacesCommand', 'SearchFacesByImageCommand', 'AssumeRoleCommand'];
  const sdk = names.map(name => name.endsWith('Client') ? class {
    constructor(configuration) { clientConfigurations.push({name, configuration}); }
    send(command) {return send(command);}
  } :
    class {constructor(input) {this.input = input; this.commandName = name;}});
  return new Function(...names, `${source}\nreturn awsProvider;`)(...sdk)(env);
}

describe('AWS adapter credentials and retention boundaries', () => {
  it('binds both provider clients to the same explicit regional server identity', () => {
    const configurations = [];
    const env = {...validEnv(), AWS_SESSION_TOKEN: 'server-session-token'};
    providerWithSdk(vi.fn(), env, configurations);
    expect(configurations.map(client => client.name)).toEqual(['RekognitionClient', 'STSClient']);
    for (const {configuration} of configurations) {
      expect(configuration).toMatchObject({region: 'ap-south-1', credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: 'server-session-token',
      }});
    }
  });

  it('issues temporary minimum-duration credentials restricted to liveness streaming', async () => {
    const send = vi.fn(async () => ({Credentials: {AccessKeyId: 'temp', SecretAccessKey: 'secret', SessionToken: 'token', Expiration: new Date('2099-01-01')}}));
    const provider = providerWithSdk(send);
    expect(await provider.browserCredentials()).toEqual({accessKeyId: 'temp', secretAccessKey: 'secret', sessionToken: 'token', expiration: '2099-01-01T00:00:00.000Z'});
    const request = send.mock.calls[0][0];
    expect(request.commandName).toBe('AssumeRoleCommand');
    expect(request.input.DurationSeconds).toBe(900);
    const policy = JSON.parse(request.input.Policy);
    expect(policy.Statement).toEqual([{Effect: 'Allow', Action: 'rekognition:StartFaceLivenessSession', Resource: '*'}]);
    expect(request.input.RoleArn).toBe(validEnv().AWS_LIVENESS_ROLE_ARN);
  });

  it('rejects incomplete STS credentials', async () => {
    const provider = providerWithSdk(async () => ({Credentials: {AccessKeyId: 'temp', SecretAccessKey: 'secret'}}));
    await expect(provider.browserCredentials()).rejects.toThrow('No liveness credentials');
  });

  it('creates liveness sessions without S3 persistence or audit images', async () => {
    const send = vi.fn(async () => ({SessionId: 'fresh-provider-session'}));
    const provider = providerWithSdk(send);
    await expect(provider.createSession()).resolves.toBe('fresh-provider-session');
    const request = send.mock.calls[0][0].input;
    expect(request.Settings.AuditImagesLimit).toBe(0);
    expect(request.Settings).not.toHaveProperty('OutputConfig');
    expect(request.Settings.ChallengePreferences).toEqual([{Type: 'FaceMovementAndLightChallenge'}]);
  });

  it('uses one selected employee collection with a high similarity gate', async () => {
    const send = vi.fn(async () => ({FaceMatches: [{Similarity: 99.99}]}));
    const provider = providerWithSdk(send);
    const image = new Uint8Array([1, 2, 3]);
    await expect(provider.match(COLLECTION, image)).resolves.toBe(99.99);
    const request = send.mock.calls[0][0].input;
    expect(request).toMatchObject({CollectionId: COLLECTION, FaceMatchThreshold: 99, MaxFaces: 1, Image: {Bytes: image}});
  });

  it('indexes one image only into the selected employee collection without returning its face vector', async () => {
    const send = vi.fn(async () => ({FaceRecords: [{Face: {FaceId: 'provider-private-face'}}]}));
    const provider = providerWithSdk(send);
    const image = new Uint8Array([1, 2, 3]);
    await expect(provider.index(COLLECTION, image)).resolves.toBeUndefined();
    expect(send.mock.calls[0][0].input).toMatchObject({CollectionId: COLLECTION, Image: {Bytes: image}, MaxFaces: 1, QualityFilter: 'AUTO'});
  });

  it.each([
    {}, {FaceRecords: []}, {FaceRecords: [{}, {}]}, {FaceRecords: [{}], UnindexedFaces: [{Reasons: ['LOW_SHARPNESS']}]},
  ])('rejects an absent, ambiguous, or partially rejected indexed sample: %j', async result => {
    const provider = providerWithSdk(async () => result);
    await expect(provider.index(COLLECTION, new Uint8Array([1, 2, 3]))).rejects.toThrow('Enrollment quality rejected');
  });

  it('retries deletion safely after a provider collection was already removed', async () => {
    const provider = providerWithSdk(async () => { throw Object.assign(new Error('Already removed'), {name: 'ResourceNotFoundException'}); });
    await expect(provider.deleteCollection(COLLECTION)).resolves.toBeUndefined();
    const denied = providerWithSdk(async () => { throw Object.assign(new Error('No permission'), {name: 'AccessDeniedException'}); });
    await expect(denied.deleteCollection(COLLECTION)).rejects.toThrow('No permission');
  });

  it('clears reference bytes when provider face detection fails before evidence returns', async () => {
    const image = new Uint8Array([20, 40, 60]);
    const provider = providerWithSdk(async command => {
      if (command.commandName === 'GetFaceLivenessSessionResultsCommand') return {Status: 'SUCCEEDED', Confidence: 99, ReferenceImage: {Bytes: image}};
      throw new Error('Face detection unavailable');
    });
    await expect(provider.results('stored-session')).rejects.toThrow('Face detection unavailable');
    expect(image).toEqual(new Uint8Array(3));
  });
});

it('evidence validation preserves usable bytes only for a successful single clear face', () => {
  const evidence = goodEvidence();
  expect(validateEvidence(evidence)).toBe(evidence.image);
});
