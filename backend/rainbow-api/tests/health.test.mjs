import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function call(path, method = "GET", env = {}) {
  return worker.fetch(new Request(`https://test.example${path}`, { method }), env);
}

test("GET /api/health returns original dashboard response shape", async () => {
  const response = await call("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    application: "Rainbow Gold Covering",
    service: "rainbow-api",
    status: "online",
    version: "1.0.0",
    environment: "development"
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("GET / preserves existing health-check behavior", async () => {
  const response = await call("/", "GET", { APP_ENV: "staging" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).environment, "staging");
});

test("HEAD health request returns headers without a body", async () => {
  const response = await call("/api/health", "HEAD");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("unsupported methods on health return 405 with Allow header", async () => {
  const response = await call("/api/health", "POST");
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD");
});

test("unimplemented business routes are not exposed", async () => {
  const response = await call("/api/payments/create", "POST");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).success, false);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});
