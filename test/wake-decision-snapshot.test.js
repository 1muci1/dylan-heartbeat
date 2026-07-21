"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { WakeDecisionSnapshotClient } = require("../wake-decision-snapshot-client");
const { registerWakeDecisionRoutes } = require("../wake-decision-routes");
const { createWakeDecisionSnapshotServer } = require("../wake-decision-snapshot-server");

const runtimeSnapshot = {
  mode: "enforced",
  rollout: { percent: 10, enabled: true },
  shadow: { total: 100, agreementRate: 0.95, eligible: true, reasonCodes: [] },
  enforced: {
    totalEvaluated: 20, rolloutEnabled: 2, adapterAllowed: 1, adapterRejected: 1,
    adapterUnavailable: 0, legacyContinued: 19, decisionBlocked: 1,
    rejectionReasons: { DECISION_REJECTED: 1 }
  }
};

function runtime(options = {}) {
  const instance = createWakeDecisionSnapshotServer({
    gate: options.gate || { getDashboardSnapshot: () => runtimeSnapshot },
    token: options.token === undefined ? "internal-only-token" : options.token,
    logger: { debug() {} }
  });
  return { instance, fetch: handlerFetch(instance.handler) };
}

function handlerFetch(handler) {
  return async (_url, options = {}) => {
    let status = 200;
    let body = "";
    const headers = {};
    const req = {
      url: "/internal/wake-decision/snapshot",
      method: options.method || "GET",
      headers: Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value]))
    };
    const res = {
      writeHead(code, values) { status = code; Object.assign(headers, values); },
      end(value) { body = String(value || ""); }
    };
    handler(req, res);
    return { ok: status >= 200 && status < 300, status, headers, json: async () => JSON.parse(body) };
  };
}

test("snapshot server requires its dedicated Bearer token and only permits GET", async t => {
  const { fetch: localFetch } = runtime();
  for (const headers of [{}, { Authorization: "Bearer wrong" }]) {
    const response = await localFetch("http://local", { headers });
    assert.equal(response.status, 401);
  }
  const ok = await localFetch("http://local", { headers: { Authorization: "Bearer internal-only-token" } });
  assert.equal(ok.status, 200);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await localFetch("http://local", { method, headers: { Authorization: "Bearer internal-only-token" } });
    assert.equal(response.status, 405);
  }
});

test("snapshot server rejects all access when its internal token is missing", async t => {
  const { fetch: localFetch } = runtime({ token: "" });
  const response = await localFetch("http://local");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "INTERNAL_TOKEN_MISSING");
});

test("client reads an authenticated runtime snapshot", async t => {
  const { fetch: localFetch } = runtime();
  const client = new WakeDecisionSnapshotClient({ token: "internal-only-token", fetch: localFetch });
  const result = await client.fetchSnapshot();
  assert.equal(result.mode, "enforced");
  assert.deepEqual(result.rollout, { percent: 10 });
  assert.deepEqual(result.enforced, runtimeSnapshot.enforced);
});

test("client returns null for missing token, HTTP failure, invalid JSON, and network failure", async () => {
  assert.equal(await new WakeDecisionSnapshotClient({ token: "" }).fetchSnapshot(), null);
  assert.equal(await new WakeDecisionSnapshotClient({ token: "x", fetch: async () => ({ ok: false }) }).fetchSnapshot(), null);
  assert.equal(await new WakeDecisionSnapshotClient({ token: "x", fetch: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }) }).fetchSnapshot(), null);
  assert.equal(await new WakeDecisionSnapshotClient({ url: "http://127.0.0.1:1", token: "x", timeoutMs: 50 }).fetchSnapshot(), null);
  assert.equal(await new WakeDecisionSnapshotClient({ url: "https://external.example/snapshot", token: "x", fetch: async () => { throw new Error("MUST_NOT_FETCH"); } }).fetchSnapshot(), null);
});

async function dashboard(t, snapshotClient) {
  let fallbackCalls = 0;
  const app = Fastify({ logger: false });
  registerWakeDecisionRoutes(app, {
    apiKey: "dashboard-token",
    snapshotClient,
    gate: { getDashboardSnapshot() { fallbackCalls++; return { ...runtimeSnapshot, mode: "legacy", rollout: { percent: 0, enabled: false } }; } }
  });
  await app.ready();
  t.after(() => app.close());
  return { app, fallbackCalls: () => fallbackCalls };
}

test("Dashboard prefers the remote Wake Runtime snapshot", async t => {
  const { app, fallbackCalls } = await dashboard(t, { fetchSnapshot: async () => runtimeSnapshot });
  const response = await app.inject({
    method: "GET", url: "/api/v1/wake-decision/dashboard",
    headers: { authorization: "Bearer dashboard-token" }
  });
  assert.equal(response.json().mode, "enforced");
  assert.deepEqual(response.json().rollout, { percent: 10, enabled: true });
  assert.equal(fallbackCalls(), 0);
});

test("Dashboard falls back locally when the runtime client returns null", async t => {
  const { app, fallbackCalls } = await dashboard(t, { fetchSnapshot: async () => null });
  const response = await app.inject({
    method: "GET", url: "/api/v1/wake-decision/dashboard",
    headers: { authorization: "Bearer dashboard-token" }
  });
  assert.equal(response.json().mode, "legacy");
  assert.equal(fallbackCalls(), 1);
});

test("snapshot boundary strips sensitive fields and has no database/model/persistence effect", async t => {
  let modelCalls = 0;
  const { fetch: localFetch } = runtime({ gate: { getDashboardSnapshot: () => ({
    ...runtimeSnapshot,
    userId: "hidden", candidate: { prompt: "hidden" }, token: "hidden", stack: "hidden",
    shadow: { ...runtimeSnapshot.shadow, memory: "hidden", reasonCodes: ["LOW_AGREEMENT", "private token"] },
    enforced: { ...runtimeSnapshot.enforced, chat: "hidden", rejectionReasons: { COOLDOWN: 1, "private token": 2 } }
  }) } });
  const client = new WakeDecisionSnapshotClient({ token: "internal-only-token", fetch: localFetch, model: { generate() { modelCalls++; } } });
  const result = await client.fetchSnapshot();
  assert.deepEqual(result.shadow.reasonCodes, ["LOW_AGREEMENT"]);
  assert.deepEqual(result.enforced.rejectionReasons, { COOLDOWN: 1 });
  assert.doesNotMatch(JSON.stringify(result), /hidden|private|userId|candidate|prompt|memory|chat|token|stack/);
  assert.equal(modelCalls, 0);
});

test("snapshot bridge has no database, file persistence, Event/State/Memory, or model dependency", () => {
  const root = path.join(__dirname, "..");
  const source = ["wake-decision-snapshot-server.js", "wake-decision-snapshot-client.js"]
    .map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|event-store|state-store|structured-memory-store|model-adapter)["']\)/);
  assert.doesNotMatch(source, /(?:read|write)File|sqlite|redis|SELECT|INSERT|UPDATE|DELETE|createJob|model\.generate/i);
});
