import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {selfHostedProvider} from '../../supabase/functions/face-attendance/self-hosted-provider.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../fixtures/selfhost_worker.py', import.meta.url));
const ORIGIN = 'https://contract.example.test';

async function stopWorker(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null || !worker.pid) return;
  let timer;
  const exit = new Promise(resolve => worker.once('exit', resolve));
  worker.kill('SIGTERM');
  await Promise.race([exit, new Promise(resolve => {timer = setTimeout(resolve, 3000);})]);
  clearTimeout(timer);
  if (worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGKILL');
    await Promise.race([exit, delay(1000)]);
  }
}

async function workerUrl(worker) {
  const address = await new Promise((resolve, reject) => {
    let output = '', diagnostics = '';
    const timer = setTimeout(() => finish(new Error('Python contract worker did not announce its port within 10 seconds')), 10000);
    function finish(error, value) {
      clearTimeout(timer);
      worker.stdout.off('data', onData);
      worker.stderr.off('data', onErrorData);
      worker.off('error', onError);
      worker.off('exit', onExit);
      if (error) reject(error); else resolve(value);
    }
    function onErrorData(data) {diagnostics = (diagnostics + data).slice(-4000);}
    function onError(error) {
      finish(new Error('Cannot start Python contract worker. Install services/face-biometric/requirements-test.txt into its .venv, or set SELF_HOSTED_TEST_PYTHON. ' + error.message));
    }
    function onExit(code, signal) {
      finish(new Error(`Python contract worker exited before startup (${code ?? signal}). Install services/face-biometric/requirements-test.txt into its .venv, or set SELF_HOSTED_TEST_PYTHON.\n${diagnostics}`));
    }
    function onData(data) {
      output += data;
      const lineEnd = output.indexOf('\n');
      if (lineEnd < 0) return;
      try {
        const announcement = JSON.parse(output.slice(0, lineEnd));
        assert.equal(announcement.mock_engine, true);
        assert.ok(Number.isInteger(announcement.port) && announcement.port > 0 && announcement.port < 65536);
        finish(null, `http://127.0.0.1:${announcement.port}`);
      } catch (error) {finish(error);}
    }
    worker.stdout.on('data', onData);
    worker.stderr.on('data', onErrorData);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Python contract worker stopped during startup');
    try {
      const response = await fetch(address + '/health', {signal: AbortSignal.timeout(500)});
      if (response.ok) {
        assert.deepEqual(await response.json(), {provider: 'self_hosted', models_ready: true, pilot_approved: true, ready: true});
        return address;
      }
    } catch { /* The socket is bound before uvicorn finishes starting. */ }
    await delay(50);
  }
  throw new Error('Python contract worker did not become healthy within 10 seconds');
}

// Intentionally fails when Python dependencies are missing; no skipped transport checks.
// Override SELF_HOSTED_TEST_PYTHON only to select another prepared Python interpreter.
test('JavaScript adapter interoperates with the real Python worker over HTTP', {timeout: 30000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'selfhost-contract-'));
  const serverKey = randomBytes(32).toString('hex');
  const python = process.env.SELF_HOSTED_TEST_PYTHON || join(ROOT, 'services/face-biometric/.venv/bin/python');
  const worker = spawn(python, [FIXTURE, '--mock-engine', '--data-dir', directory], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, SELF_HOSTED_CONTRACT_API_KEY: serverKey},
  });
  t.after(async () => {
    await stopWorker(worker);
    await rm(directory, {recursive: true, force: true});
  });
  const base = await workerUrl(worker);
  const adapter = selfHostedProvider({
    SELF_HOSTED_FACE_URL: base,
    SELF_HOSTED_FACE_API_KEY: serverKey,
    SELF_HOSTED_ALLOW_LOCAL_HTTP: 'true',
  });
  const collection = 'rgc-contract-' + randomBytes(8).toString('hex');
  const browserFetch = async (credentials, token = credentials.uploadToken) => fetch(credentials.uploadUrl, {
    method: 'POST',
    headers: {Origin: ORIGIN, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify({frames: Array(6).fill('contract-test-frame')}),
    signal: AbortSignal.timeout(2000),
  });
  async function capture(purpose) {
    const session = await adapter.createSession({collection, purpose});
    const credentials = await adapter.browserCredentials(session);
    assert.equal(credentials.uploadUrl, base + '/v1/sessions/' + session + '/capture');
    assert.deepEqual(credentials.capture, {frameCount: 6, intervalMs: 600});
    assert.ok(Date.parse(credentials.expiration) > Date.now());
    assert.notEqual(credentials.uploadToken, serverKey);
    assert.ok(!JSON.stringify(credentials).includes(serverKey));
    await assert.rejects(adapter.browserCredentials(session), /unavailable/);
    assert.equal((await browserFetch(credentials, serverKey)).status, 401);
    const response = await browserFetch(credentials);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {accepted: true});
    assert.equal((await browserFetch(credentials)).status, 409);
    // A scoped browser token cannot read privileged server evidence.
    const protectedResult = await fetch(base + '/v1/sessions/' + session + '/result', {
      headers: {Authorization: 'Bearer ' + credentials.uploadToken}, signal: AbortSignal.timeout(2000),
    });
    assert.equal(protectedResult.status, 401);
    const result = await adapter.results(session);
    assert.deepEqual(result, {status: 'SUCCEEDED', provider: 'self_hosted', confidence: 99,
      face_count: 1, quality_passed: true, live_score: .99, frames_verified: 6, template_token: session});
    assert.ok(!JSON.stringify(result).includes(serverKey));
    return session;
  }

  await adapter.createCollection(collection);
  await assert.rejects(adapter.createSession({collection, purpose: 'check_in'}), /rejected/);
  for (let sample = 0; sample < 3; sample++) {
    const session = await capture('enrollment');
    // Enrollment indexes the capture directly; verification would consume it.
    await adapter.index(collection, session);
    await assert.rejects(adapter.index(collection, session), /rejected/);
  }
  await assert.rejects(adapter.createSession({collection, purpose: 'enrollment'}), /rejected/);
  const verification = await capture('check_in');
  assert.deepEqual(await adapter.match(collection, verification), {matched: true, similarity: .8});
  await assert.rejects(adapter.match(collection, verification), /rejected/);
  const pending = await adapter.createSession({collection, purpose: 'check_out'});
  await adapter.deleteCollection(collection);
  await adapter.deleteCollection(collection); // Retried deletion remains safe.
  await assert.rejects(adapter.results(pending), /rejected/);
  await assert.rejects(adapter.results(verification), /rejected/);
  await assert.rejects(adapter.createSession({collection, purpose: 'check_in'}), /rejected/);
});
