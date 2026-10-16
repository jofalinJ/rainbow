import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// This executes the production migration and PL/pgSQL against an isolated
// PostgreSQL engine. No credentials, network, or production database is used.
const ADMIN = '10000000-0000-4000-8000-000000000001';
const STAFF = '10000000-0000-4000-8000-000000000002';
const OTHER = '10000000-0000-4000-8000-000000000003';
const INACTIVE = '10000000-0000-4000-8000-000000000004';
const CONSENT = '2026-10-15-v1';
const SEALED = 'v1.mock-encrypted-collection-identifier-for-test';
let db;
let legacy;
let sessionCounter = 0;

async function rows(sql, params = []) { return (await db.query(sql, params)).rows; }
async function one(sql, params = []) { return (await rows(sql, params))[0]; }
async function asRole(role, user, work) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
  try { return await work(); } finally { await db.exec('reset role'); }
}
const service = work => asRole('service_role', null, work);
const signed = (user, work) => asRole('authenticated', user, work);
async function prepare(staff = STAFF, actor = ADMIN) {
  return service(() => one('select * from public.biometric_prepare_enrollment($1,$2,$3,$4)', [actor, staff, SEALED, CONSENT]));
}
async function enroll(staff = STAFF) {
  await prepare(staff);
  for (let i = 0; i < 3; i++) {
    const s = await open('enrollment', ADMIN, staff);
    await claim(s.id, ADMIN);
    await sample(s.id);
  }
  return one('select * from public.biometric_enrollments where staff_id=$1', [staff]);
}
async function open(purpose, actor = STAFF, staff = STAFF) {
  return service(() => one('select * from public.biometric_open_session($1,$2,$3,$4)', [actor, staff, purpose, `test-provider-${++sessionCounter}`]));
}
async function claim(id, actor = STAFF) {
  return service(() => one('select * from public.biometric_claim_session($1,$2)', [actor, id]));
}
async function beginIndex(id, actor = ADMIN) {
  return service(() => one('select * from public.biometric_begin_index($1,$2)', [actor, id]));
}
async function sample(id, actor = ADMIN) {
  await beginIndex(id, actor);
  return service(() => one('select * from public.biometric_finish_sample($1,$2)', [actor, id]));
}
async function finish(id, actor = STAFF) {
  return service(() => one('select * from public.biometric_finish_attendance($1,$2)', [actor, id]));
}
async function punch(action, staff = STAFF) {
  const s = await open(action, staff, staff);
  await claim(s.id, staff);
  return finish(s.id, staff);
}
async function today() { return (await one("select (clock_timestamp() at time zone 'Asia/Kolkata')::date::text as day")).day; }
async function manual(action, reason = 'Approved manual fallback', extra = {}) {
  return signed(extra.actor || ADMIN, () => one(
    'select * from public.admin_correct_attendance($1,$2::date,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9)',
    [extra.staff || STAFF, extra.date || null, action, reason, extra.status || null,
      extra.checkIn || null, extra.checkOut || null, extra.notes || null, extra.review || null]
  ));
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema public, auth to authenticated, anon, service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.staff_profiles(user_id uuid primary key references auth.users(id), role text not null, active boolean not null, full_name text);
    alter table public.staff_profiles enable row level security;
    grant select on public.staff_profiles to authenticated;
    grant all on public.staff_profiles to service_role;
    create policy fixture_staff_read on public.staff_profiles for select to authenticated using (true);
    create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.staff_profiles where user_id=auth.uid() and active and role='admin')
    $$;
    create table storage.objects(id uuid primary key default gen_random_uuid());
    alter table storage.objects enable row level security;
    insert into auth.users(id) values ('${STAFF}');
    insert into public.staff_profiles values ('${STAFF}','cashier',true,'Legacy Employee');
  `);
  const original = new URL('../../supabase/migrations/20261011123003_create_attendance_table.sql', import.meta.url);
  await db.exec(await readFile(original, 'utf8'));
  await db.exec(`alter table public.attendance
    add column photo_path text,
    add column photo_review_status text not null default 'Not submitted',
    add column photo_reviewed_by uuid references auth.users(id),
    add column photo_reviewed_at timestamptz;
    insert into public.attendance(staff_id,date,check_in,check_out,notes)
    values ('${STAFF}', '2026-01-01', '22:00', '06:00', 'Preserve this historical overnight shift');`);
  const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
  const filename = (await readdir(migrationDir)).find(name => name.endsWith('_verified_biometric_attendance.sql'));
  assert.ok(filename, 'The production biometric migration exists');
  await db.exec(await readFile(new URL(filename, migrationDir), 'utf8'));
  legacy = await one('select * from public.attendance');
});

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('truncate public.biometric_audit_events, public.biometric_sessions, public.biometric_enrollments, public.attendance, public.staff_profiles, auth.users restart identity cascade');
  await db.exec(`insert into auth.users(id) values ('${ADMIN}'),('${STAFF}'),('${OTHER}'),('${INACTIVE}');
    insert into public.staff_profiles(user_id,role,active,full_name) values
      ('${ADMIN}','admin',true,'Administrator'),('${STAFF}','cashier',true,'Cashier'),
      ('${OTHER}','inventory_staff',true,'Inventory'),('${INACTIVE}','cashier',false,'Inactive');`);
});
after(async () => { await db?.close(); });

test('migration preserves legacy overnight history and computes exact IST duration', () => {
  assert.equal(legacy.notes, 'Preserve this historical overnight shift');
  assert.equal(legacy.verification_method, 'legacy');
  assert.equal(legacy.check_in_at.toISOString(), '2026-01-01T16:30:00.000Z');
  assert.equal(legacy.check_out_at.toISOString(), '2026-01-02T00:30:00.000Z');
  assert.equal(Number(legacy.working_seconds), 8 * 3600);
});

test('browser roles cannot write attendance or read templates and cannot call privileged verification RPCs', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['attendance', 'biometric_enrollments', 'biometric_sessions', 'biometric_audit_events']) {
      const perms = await one("select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') as allowed", [role, `public.${table}`]);
      assert.equal(perms.allowed, false, `${role} cannot mutate ${table}`);
    }
    for (const signature of [
      'biometric_prepare_enrollment(uuid,uuid,text,text)', 'biometric_open_session(uuid,uuid,text,text)',
      'biometric_claim_session(uuid,uuid)', 'biometric_begin_index(uuid,uuid)', 'biometric_finish_sample(uuid,uuid)',
      'biometric_finish_attendance(uuid,uuid)', 'biometric_fail_session(uuid,uuid,text)',
      'biometric_request_deletion(uuid,uuid,uuid,text)',
      'biometric_remove_enrollment(uuid,uuid,uuid,text)', 'biometric_purge_enrollment(uuid,uuid)'
    ]) {
      assert.equal((await one('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, `public.${signature}`])).allowed, false);
    }
  }
  await signed(ADMIN, async () => {
    await assert.rejects(() => db.exec(`insert into public.attendance(staff_id) values ('${STAFF}')`), /permission denied/);
    await assert.rejects(() => db.exec('select * from public.biometric_enrollments'), /permission denied/);
  });
});

test('legacy unverified staff attendance RPC fails closed', async () => {
  await signed(STAFF, () => assert.rejects(() => one("select * from public.staff_attendance_action('check_in')"), /requires a live face verification/));
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('enrollment requires an active admin, current consent and active non-admin target', async () => {
  await assert.rejects(() => prepare(STAFF, STAFF), /active administrator/);
  await assert.rejects(() => prepare(ADMIN), /active cashier/);
  await assert.rejects(() => prepare(INACTIVE), /active cashier/);
  await service(() => assert.rejects(() => one('select * from public.biometric_prepare_enrollment($1,$2,$3,$4)', [ADMIN, STAFF, SEALED, 'old']), /current staff consent/));
  const e = await prepare();
  assert.equal(e.sample_count, 0);
  assert.equal(e.status, 'pending');
  assert.ok(e.consent_at instanceof Date);
  assert.equal(Math.round((e.expires_at - e.consent_at) / 86400000), 1);
  await assert.rejects(() => prepare(), /Delete the existing/);
});

test('exactly three claimed, one-use samples activate enrollment and audit safely', async () => {
  await prepare();
  for (let i = 1; i <= 3; i++) {
    const s = await open('enrollment', ADMIN);
    await service(() => assert.rejects(() => one('select * from public.biometric_finish_sample($1,$2)', [ADMIN, s.id]), /expired, changed, or was already used/));
    await assert.rejects(() => beginIndex(s.id), /expired, changed, or was already used/);
    await claim(s.id, ADMIN);
    await service(() => assert.rejects(() => one('select * from public.biometric_finish_sample($1,$2)', [ADMIN, s.id]), /expired, changed, or was already used/));
    const indexing = await beginIndex(s.id);
    assert.equal(indexing.status, 'indexing');
    assert.equal(indexing.sample_count, i - 1);
    await assert.rejects(() => beginIndex(s.id), /expired, changed, or was already used/);
    const e = await service(() => one('select * from public.biometric_finish_sample($1,$2)', [ADMIN, s.id]));
    assert.equal(e.sample_count, i);
    assert.equal(e.status, i === 3 ? 'active' : 'pending');
    assert.equal(Math.round((e.expires_at - e.updated_at) / 86400000), i === 3 ? 90 : 1);
    await service(() => assert.rejects(() => one('select * from public.biometric_finish_sample($1,$2)', [ADMIN, s.id]), /expired, changed, or was already used/));
  }
  await assert.rejects(() => open('enrollment', ADMIN), /current biometric enrollment/);
  const audit = await rows('select * from public.biometric_audit_events');
  assert.equal(audit.length, 4);
  assert.equal(audit.at(-1).event, 'enrollment_completed');
  assert.ok(!JSON.stringify(audit).includes(SEALED));
});

test('interrupted provider indexing stays frozen and cannot open or claim a later enrollment sample', async () => {
  const enrollment = await prepare();
  const s = await open('enrollment', ADMIN);
  await claim(s.id, ADMIN);
  await beginIndex(s.id);
  // A crashed worker cannot tell whether the provider accepted its index write.
  await db.query("update public.biometric_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1", [s.id]);
  await assert.rejects(() => open('enrollment', ADMIN), /current biometric enrollment/);
  await assert.rejects(() => prepare(), /Delete the existing/);
  const pending = await one(`insert into public.biometric_sessions(provider_session_id,actor_id,staff_id,purpose,enrollment_generation)
    values ($1,$2,$3,'enrollment',$4) returning *`, [`test-racing-provider-${++sessionCounter}`, ADMIN, STAFF, enrollment.generation]);
  await assert.rejects(() => claim(pending.id, ADMIN), /active administrator and pending enrollment/);
  const frozen = await one('select status,sample_count from public.biometric_enrollments where staff_id=$1', [STAFF]);
  assert.deepEqual(frozen, { status: 'indexing', sample_count: 0 });
  assert.equal((await one('select status from public.biometric_sessions where id=$1', [pending.id])).status, 'pending');
});

test('cancellation after provider indexing cannot activate the enrollment or release the freeze', async () => {
  await prepare();
  for (let i = 0; i < 2; i++) {
    const s = await open('enrollment', ADMIN); await claim(s.id, ADMIN); await sample(s.id);
  }
  const s = await open('enrollment', ADMIN); await claim(s.id, ADMIN); await beginIndex(s.id);
  await service(() => one('select * from public.biometric_fail_session($1,$2,$3)', [ADMIN, s.id, 'CANCELLED']));
  await service(() => assert.rejects(() => one('select * from public.biometric_finish_sample($1,$2)', [ADMIN, s.id]), /expired, changed, or was already used/));
  await assert.rejects(() => beginIndex(s.id), /expired, changed, or was already used/);
  await assert.rejects(() => open('enrollment', ADMIN), /current biometric enrollment/);
  assert.deepEqual(await one('select status,sample_count from public.biometric_enrollments where staff_id=$1', [STAFF]), { status: 'indexing', sample_count: 2 });
  assert.equal((await one("select count(*)::int as n from public.biometric_audit_events where event='enrollment_completed'")).n, 0);
});

test('session or enrollment expiry after provider indexing cannot complete or restart enrollment', async () => {
  for (const expired of ['session', 'enrollment']) {
    const staff = expired === 'session' ? STAFF : OTHER;
    await prepare(staff);
    const s = await open('enrollment', ADMIN, staff); await claim(s.id, ADMIN); await beginIndex(s.id);
    if (expired === 'session') {
      await db.query("update public.biometric_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1", [s.id]);
    } else {
      await db.query("update public.biometric_enrollments set expires_at=clock_timestamp()-interval '1 second' where staff_id=$1", [staff]);
    }
    await service(() => assert.rejects(() => one('select * from public.biometric_finish_sample($1,$2)', [ADMIN, s.id]), /expired, changed, or was already used/));
    await assert.rejects(() => open('enrollment', ADMIN, staff), /current biometric enrollment/);
    assert.deepEqual(await one('select status,sample_count from public.biometric_enrollments where staff_id=$1', [staff]), { status: 'indexing', sample_count: 0 });
  }
  assert.equal((await one("select count(*)::int as n from public.biometric_enrollments where status='active'")).n, 0);
});

test('beginning provider indexing rejects another actor, inactive staff and changed enrollment generations', async () => {
  await prepare();
  const s = await open('enrollment', ADMIN); await claim(s.id, ADMIN);
  await assert.rejects(() => beginIndex(s.id, STAFF), /active administrator/);
  await assert.rejects(() => beginIndex(s.id, OTHER), /active administrator/);
  await db.query('update public.staff_profiles set active=false where user_id=$1', [STAFF]);
  await assert.rejects(() => beginIndex(s.id), /Active non-admin staff/);
  await db.query('update public.staff_profiles set active=true where user_id=$1', [STAFF]);
  await db.query('update public.biometric_enrollments set generation=gen_random_uuid() where staff_id=$1', [STAFF]);
  await assert.rejects(() => beginIndex(s.id), /expired, changed, or was already used/);
  assert.deepEqual(await one('select status,sample_count from public.biometric_enrollments where staff_id=$1', [STAFF]), { status: 'pending', sample_count: 0 });
});

test('attendance rejects missing or incomplete enrollment and cross-employee sessions', async () => {
  await assert.rejects(() => open('check_in'), /current biometric enrollment/);
  await prepare();
  await assert.rejects(() => open('check_in'), /current biometric enrollment/);
  await assert.rejects(() => open('check_in', OTHER, STAFF), /only their own/);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('session claiming is scoped, expires and cannot be replayed', async () => {
  await enroll();
  const s = await open('check_in');
  await assert.rejects(() => claim(s.id, OTHER), /not found/);
  await finish(s.id).then(() => assert.fail('Unclaimed session must not finish'), error => assert.match(error.message, /already used/));
  await claim(s.id);
  await assert.rejects(() => claim(s.id), /already used/);
  await db.query("update public.biometric_sessions set expires_at=clock_timestamp()-interval '1 second' where id=$1", [s.id]);
  await assert.rejects(() => finish(s.id), /expired/);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('verified check-in and check-out use server IST time, consume sessions atomically and compute duration', async () => {
  await enroll();
  const before = Date.now();
  const entered = await punch('check_in');
  assert.equal(entered.staff_id, STAFF);
  assert.equal(entered.date.toISOString().slice(0, 10), await today());
  assert.equal(entered.status, 'Present');
  assert.equal(entered.verification_method, 'face_liveness');
  assert.equal(entered.verification_result, 'verified');
  assert.ok(entered.check_in_at.getTime() >= before - 1000);
  assert.equal(entered.check_out_at, null);
  const completed = await punch('check_out');
  assert.equal(completed.id, entered.id);
  assert.ok(completed.check_out_at >= completed.check_in_at);
  assert.equal(Number(completed.working_seconds), Math.floor((completed.check_out_at - completed.check_in_at) / 1000));
  assert.equal((await one("select count(*)::int as n from public.biometric_sessions where purpose<>'enrollment' and status='verified'")).n, 2);
});

test('duplicate check-in rolls back attendance and leaves the unsuccessful session unconsumed', async () => {
  await enroll();
  const first = await punch('check_in');
  const duplicate = await open('check_in');
  await claim(duplicate.id);
  await assert.rejects(() => finish(duplicate.id), /open shift already exists/);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 1);
  assert.equal((await one('select check_in_at from public.attendance')).check_in_at.getTime(), first.check_in_at.getTime());
  assert.equal((await one('select status from public.biometric_sessions where id=$1', [duplicate.id])).status, 'processing');
  assert.equal((await one("select count(*)::int as n from public.biometric_audit_events where event='attendance_check_in'")).n, 1);
});

test('checkout without a check-in never creates attendance', async () => {
  await enroll();
  const s = await open('check_out'); await claim(s.id);
  await assert.rejects(() => finish(s.id), /single open shift/);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('cross-midnight checkout closes the previous IST day when the shift is less than 24 hours old', async () => {
  await enroll();
  await db.query(`insert into public.attendance(staff_id,date,check_in,check_in_at,status,verification_method,verification_result)
    select $1, ((clock_timestamp() at time zone 'Asia/Kolkata')::date-1),
      '23:59:59'::time, (((clock_timestamp() at time zone 'Asia/Kolkata')::date-1)+'23:59:59'::time) at time zone 'Asia/Kolkata',
      'Present','face_liveness','verified'`, [STAFF]);
  const result = await punch('check_out');
  assert.ok(result.check_out_at > result.check_in_at);
  assert.ok(Number(result.working_seconds) <= 86400);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 1);
});

test('stale or ambiguous open shifts reject checkout', async () => {
  await enroll();
  await db.query(`insert into public.attendance(staff_id,date,check_in,check_in_at)
    select $1, ((clock_timestamp() at time zone 'Asia/Kolkata')::date-2), '00:00', clock_timestamp()-interval '48 hours'`, [STAFF]);
  const s = await open('check_out'); await claim(s.id);
  await assert.rejects(() => finish(s.id), /too old or conflicts/);
  assert.equal((await one('select check_out_at from public.attendance')).check_out_at, null);
});

test('sessions enforce five attempts per minute and only one live session per actor or target', async () => {
  await enroll();
  const pending = await open('check_in');
  await assert.rejects(() => open('check_out'), /current verification/);
  await service(() => one('select * from public.biometric_fail_session($1,$2,$3)', [STAFF, pending.id, 'cancelled']));
  for (let i = 0; i < 4; i++) {
    const s = await open('check_in');
    await service(() => one('select * from public.biometric_fail_session($1,$2,$3)', [STAFF, s.id, 'cancelled']));
  }
  await assert.rejects(() => open('check_in'), /Too many verification attempts/);
});

test('failures only append safe audit metadata and do not alter attendance', async () => {
  await enroll();
  const s = await open('check_in'); await claim(s.id);
  const failed = await service(() => one('select * from public.biometric_fail_session($1,$2,$3)', [STAFF, s.id, 'provider returned private image bytes']));
  assert.equal(failed.status, 'failed');
  const audit = await one("select reason,details from public.biometric_audit_events where event='verification_failed'");
  assert.equal(audit.reason, 'verification_failed');
  assert.deepEqual(audit.details, { purpose: 'check_in' });
  await assert.rejects(() => finish(s.id), /already used/);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('failed pending sessions can be cancelled and uppercase provider reason codes are preserved safely', async () => {
  await enroll();
  const s = await open('check_in');
  await service(() => one('select * from public.biometric_fail_session($1,$2,$3)', [STAFF, s.id, 'PROVIDER_START_FAILED']));
  assert.equal((await one("select reason from public.biometric_audit_events where event='verification_failed'")).reason, 'provider_start_failed');
  const next = await open('check_in');
  await service(() => one('select * from public.biometric_fail_session($1,$2,$3)', [STAFF, next.id, 'CANCELLED']));
  assert.equal((await one('select status from public.biometric_sessions where id=$1', [next.id])).status, 'failed');
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('completed verification cannot be reported as cancelled', async () => {
  await enroll();
  const s = await open('check_in'); await claim(s.id); await finish(s.id);
  await service(() => assert.rejects(() => one('select * from public.biometric_fail_session($1,$2,$3)', [STAFF, s.id, 'CANCELLED']), /already completed/));
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 1);
});

test('deletion requires an admin and matching deleting generation, then invalidates old sessions', async () => {
  const e = await enroll();
  const s = await open('check_in'); await claim(s.id);
  await service(() => assert.rejects(() => one('select public.biometric_remove_enrollment($1,$2,$3,$4)', [STAFF, STAFF, e.generation, 'Employee requested deletion']), /active administrator/));
  await service(() => assert.rejects(() => one('select public.biometric_remove_enrollment($1,$2,$3,$4)', [ADMIN, STAFF, e.generation, 'Employee requested deletion']), /Delete the provider template/));
  await service(() => one('select * from public.biometric_request_deletion($1,$2,$3,$4)', [ADMIN, STAFF, e.generation, 'Employee requested deletion']));
  await assert.rejects(() => finish(s.id), /expired, changed/);
  await service(() => assert.rejects(() => one('select public.biometric_remove_enrollment($1,$2,$3,$4)', [ADMIN, STAFF, OTHER, 'Employee requested deletion']), /Delete the provider template/));
  await service(() => one('select public.biometric_remove_enrollment($1,$2,$3,$4)', [ADMIN, STAFF, e.generation, 'Employee requested deletion']));
  assert.equal((await one('select count(*)::int as n from public.biometric_enrollments')).n, 0);
  assert.equal((await one('select status from public.biometric_sessions where id=$1', [s.id])).status, 'failed');
  await prepare();
  await service(() => assert.rejects(() => one('select public.biometric_remove_enrollment($1,$2,$3,$4)', [ADMIN, STAFF, e.generation, 'Employee requested deletion']), /Delete the provider template/));
});

test('requested deletion validates admin, reason and generation, expires immediately, and is safely retryable', async () => {
  const e = await enroll();
  const request = (actor, generation, reason) => service(() => one('select * from public.biometric_request_deletion($1,$2,$3,$4)', [actor, STAFF, generation, reason]));
  await assert.rejects(() => request(STAFF, e.generation, 'Staff withdrew consent'), /active administrator/);
  await assert.rejects(() => request(ADMIN, e.generation, 'x'), /deletion reason/);
  await assert.rejects(() => request(ADMIN, e.generation, 'x'.repeat(501)), /deletion reason/);
  await assert.rejects(() => request(ADMIN, OTHER, 'Staff withdrew consent'), /enrollment changed/);
  assert.equal((await one('select status from public.biometric_enrollments where staff_id=$1', [STAFF])).status, 'active');
  const before = Date.now();
  const requested = await request(ADMIN, e.generation, '  Staff withdrew consent  ');
  assert.equal(requested.status, 'deleting');
  assert.equal(requested.sample_count, 3);
  assert.ok(requested.expires_at.getTime() >= before - 1000);
  assert.ok(requested.expires_at.getTime() <= Date.now());
  assert.equal((await one('select count(*)::int as n from public.biometric_enrollments where expires_at<=clock_timestamp()')).n, 1);
  assert.deepEqual(await one("select actor_id,event,reason from public.biometric_audit_events where event='enrollment_deletion_requested'"),
    { actor_id: ADMIN, event: 'enrollment_deletion_requested', reason: 'Staff withdrew consent' });
  await request(ADMIN, e.generation, 'Retry provider deletion after failure');
  assert.equal((await one("select count(*)::int as n from public.biometric_audit_events where event='enrollment_deletion_requested'")).n, 1);
  assert.equal((await one('select expires_at from public.biometric_enrollments where staff_id=$1', [STAFF])).expires_at.getTime(), requested.expires_at.getTime());
  await assert.rejects(() => open('check_in'), /current biometric enrollment/);
  await assert.rejects(() => request(ADMIN, OTHER, 'Stale retry must be rejected'), /enrollment changed/);
  await service(() => one('select public.biometric_purge_enrollment($1,$2)', [STAFF, e.generation]));
  assert.equal((await one('select count(*)::int as n from public.biometric_enrollments')).n, 0);
});

test('an interrupted indexing enrollment can be marked for immediate provider cleanup', async () => {
  const e = await prepare();
  const s = await open('enrollment', ADMIN); await claim(s.id, ADMIN); await beginIndex(s.id);
  await service(() => one('select * from public.biometric_request_deletion($1,$2,$3,$4)', [ADMIN, STAFF, e.generation, 'Reset interrupted enrollment']));
  await service(() => assert.rejects(() => one('select * from public.biometric_finish_sample($1,$2)', [ADMIN, s.id]), /expired, changed/));
  await service(() => one('select public.biometric_purge_enrollment($1,$2)', [STAFF, e.generation]));
  assert.equal((await one('select status from public.biometric_sessions where id=$1', [s.id])).status, 'failed');
  assert.equal((await one('select count(*)::int as n from public.biometric_enrollments')).n, 0);
  const reset = await prepare();
  assert.notEqual(reset.generation, e.generation);
  assert.equal(reset.status, 'pending');
  assert.equal(reset.sample_count, 0);
});

test('requesting deletion repairs an already-deleting enrollment that still has a future expiry', async () => {
  const e = await enroll();
  await db.query("update public.biometric_enrollments set status='deleting' where staff_id=$1", [STAFF]);
  const requested = await service(() => one('select * from public.biometric_request_deletion($1,$2,$3,$4)', [ADMIN, STAFF, e.generation, 'Retry interrupted provider deletion']));
  assert.equal(requested.status, 'deleting');
  assert.ok(requested.expires_at <= new Date());
  assert.equal((await one("select count(*)::int as n from public.biometric_audit_events where event='enrollment_deletion_requested'")).n, 1);
});

test('enrollment FK prevents account deletion orphaning the provider template', async () => {
  await prepare();
  await assert.rejects(() => db.query('delete from public.staff_profiles where user_id=$1', [STAFF]), /foreign key constraint/);
});

test('retention purge requires expired provider-deleted generation and leaves a system audit', async () => {
  const e = await enroll();
  const s = await open('check_in');
  await service(() => assert.rejects(() => one('select public.biometric_purge_enrollment($1,$2)', [STAFF, e.generation]), /matching, expired/));
  await db.query("update public.biometric_enrollments set status='deleting' where staff_id=$1", [STAFF]);
  await service(() => assert.rejects(() => one('select public.biometric_purge_enrollment($1,$2)', [STAFF, e.generation]), /matching, expired/));
  await db.query("update public.biometric_enrollments set expires_at=clock_timestamp()-interval '1 second' where staff_id=$1", [STAFF]);
  await service(() => assert.rejects(() => one('select public.biometric_purge_enrollment($1,$2)', [STAFF, OTHER]), /matching, expired/));
  await service(() => one('select public.biometric_purge_enrollment($1,$2)', [STAFF, e.generation]));
  assert.equal((await one('select count(*)::int as n from public.biometric_enrollments')).n, 0);
  assert.equal((await one('select status from public.biometric_sessions where id=$1', [s.id])).status, 'failed');
  const audit = await one("select actor_id,event,reason from public.biometric_audit_events where event='enrollment_purged'");
  assert.deepEqual(audit, { actor_id: null, event: 'enrollment_purged', reason: 'Retention or requested deletion cleanup' });
});

test('expired enrollment cannot open or complete an attendance session', async () => {
  await enroll();
  const s = await open('check_in'); await claim(s.id);
  await db.query("update public.biometric_enrollments set expires_at=clock_timestamp()-interval '1 second' where staff_id=$1", [STAFF]);
  await assert.rejects(() => finish(s.id), /expired, changed/);
  await assert.rejects(() => open('check_in'), /current biometric enrollment/);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('timestamp constraints reject invalid verified rows and unique key rejects conflicting dates', async () => {
  await db.query(`insert into public.attendance(staff_id,date,check_in_at,check_out_at,check_in,check_out,verification_method,verification_result)
    values ($1,'2026-01-01','2026-01-01T03:30Z','2026-01-01T11:30Z','09:00','17:00','face_liveness','verified')`, [STAFF]);
  await assert.rejects(() => db.query("update public.attendance set check_out_at='2026-01-01T02:30Z',check_out='08:00' where staff_id=$1", [STAFF]), /attendance_verified_timestamps_check/);
  await assert.rejects(() => db.query("update public.attendance set check_in='10:00' where staff_id=$1", [STAFF]), /attendance_verified_timestamps_check/);
  await assert.rejects(() => db.query("insert into public.attendance(staff_id,date) values ($1,'2026-01-01')", [STAFF]), /attendance_staff_date_unique/);
  await assert.rejects(() => db.query("update public.attendance set verification_result='manual' where staff_id=$1", [STAFF]), /attendance_verification_consistency_check/);
});

test('deactivation and generation changes reject a previously claimed session', async () => {
  await enroll();
  const s = await open('check_in'); await claim(s.id);
  await db.query('update public.staff_profiles set active=false where user_id=$1', [STAFF]);
  await assert.rejects(() => finish(s.id), /Active non-admin staff/);
  await db.query('update public.staff_profiles set active=true where user_id=$1', [STAFF]);
  await db.query('update public.biometric_enrollments set generation=gen_random_uuid() where staff_id=$1', [STAFF]);
  await assert.rejects(() => finish(s.id), /expired, changed/);
  assert.equal((await one('select count(*)::int as n from public.attendance')).n, 0);
});

test('RLS lets active staff read only their own attendance and only active admins read the audit', async () => {
  const day = await today();
  await manual('status', 'Cashier on approved leave', { date: day, status: 'On Leave' });
  await manual('status', 'Inventory on approved leave', { staff: OTHER, date: day, status: 'On Leave' });
  await signed(STAFF, async () => {
    const visible = await rows('select staff_id from public.attendance');
    assert.deepEqual(visible, [{ staff_id: STAFF }]);
    assert.equal((await rows('select * from public.biometric_audit_events')).length, 0);
  });
  await signed(ADMIN, async () => {
    assert.equal((await rows('select * from public.attendance')).length, 2);
    assert.equal((await rows('select * from public.biometric_audit_events')).length, 2);
  });
  await db.query('update public.staff_profiles set active=false where user_id=$1', [STAFF]);
  await signed(STAFF, async () => assert.equal((await rows('select * from public.attendance')).length, 0));
});

test('manual fallback requires active admin and reason, uses server times and records who/why', async () => {
  const day = await today();
  await assert.rejects(() => manual('check_in', 'Valid reason', { actor: STAFF, date: day }), /active administrator/);
  await assert.rejects(() => manual('check_in', 'x', { date: day }), /correction reason/);
  const start = Date.now();
  const record = await manual('check_in', 'Employee declined biometric enrollment', { date: day, checkIn: '2000-01-01T00:00:00Z' });
  assert.ok(record.check_in_at.getTime() >= start - 1000);
  assert.equal(record.verification_method, 'manual');
  await manual('check_out', 'Employee declined biometric enrollment', { date: day });
  const audit = await one("select actor_id,reason from public.biometric_audit_events where event='admin_check_in'");
  assert.equal(audit.actor_id, ADMIN);
  assert.equal(audit.reason, 'Employee declined biometric enrollment');
});

test('historical corrections validate dates, duration and overlap; failures roll back audit and attendance', async () => {
  const historical = { date: '2026-01-01', checkIn: '2026-01-01T03:30:00Z', checkOut: '2026-01-01T11:30:00Z' };
  const corrected = await manual('correct', 'Correct missing historical times', historical);
  assert.equal(Number(corrected.working_seconds), 28800);
  await assert.rejects(() => manual('correct', 'Incorrect date rejected', { ...historical, checkIn: '2026-01-02T03:30:00Z' }), /IST attendance date/);
  await assert.rejects(() => manual('correct', 'Too long shift rejected', { ...historical, checkOut: '2026-01-03T11:30:00Z' }), /at most 24 hours/);
  await assert.rejects(() => manual('correct', 'Negative shift rejected', { ...historical, checkOut: '2026-01-01T02:30:00Z' }), /at most 24 hours/);
  assert.equal((await one('select count(*)::int as n from public.biometric_audit_events')).n, 1);
  assert.equal(Number((await one('select working_seconds from public.attendance')).working_seconds), 28800);
});

test('historical photo review remains available through the audited correction RPC', async () => {
  const day = await today();
  await db.query('insert into public.attendance(staff_id,date,photo_path,photo_review_status) values ($1,$2,$3,$4)', [STAFF, day, 'attendance/historical.jpg', 'Pending']);
  const reviewed = await manual('review_photo', 'Compared with the preserved reference photo', { date: day, review: 'Approved' });
  assert.equal(reviewed.photo_review_status, 'Approved');
  assert.equal(reviewed.photo_reviewed_by, ADMIN);
  assert.ok(reviewed.photo_reviewed_at instanceof Date);
  assert.equal(reviewed.verification_method, 'legacy');
});
