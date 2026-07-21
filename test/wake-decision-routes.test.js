"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { registerWakeDecisionRoutes } = require("../wake-decision-routes");

const snapshot = {
  mode: "shadow",
  rollout: { percent: 10, enabled: false },
  shadow: { total: 100, agreementRate: 0.95, eligible: true, reasonCodes: [] },
  enforced: {
    totalEvaluated: 20, rolloutEnabled: 2, adapterAllowed: 1, adapterRejected: 1,
    adapterUnavailable: 0, legacyContinued: 19, decisionBlocked: 1,
    rejectionReasons: { DECISION_REJECTED: 1 }
  }
};

async function fixture(t, overrides = {}) {
  let calls = 0;
  const gate = overrides.gate || {
    mode: "shadow",
    getDashboardSnapshot() { calls++; return snapshot; }
  };
  const app = Fastify({ logger: false });
  registerWakeDecisionRoutes(app, { gate, apiKey: "dashboard-token" });
  await app.ready();
  t.after(() => app.close());
  return { app, calls: () => calls, gate };
}

const auth = token => ({ authorization: `Bearer ${token || "dashboard-token"}` });

test("authenticated GET returns the safe Dashboard structure", async t => {
  const { app, calls } = await fixture(t);
  const response = await app.inject({ method: "GET", url: "/api/v1/wake-decision/dashboard", headers: auth() });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), snapshot);
  assert.equal(calls(), 1);
});

test("missing and incorrect Bearer tokens are rejected without reading Gate", async t => {
  const { app, calls } = await fixture(t);
  for (const headers of [{}, auth("wrong")]) {
    const response = await app.inject({ method: "GET", url: "/api/v1/wake-decision/dashboard", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
  }
  assert.equal(calls(), 0);
});

test("route strips sensitive or unknown fields returned by a compromised source", async t => {
  const gate = { mode: "shadow", getDashboardSnapshot: () => ({
    ...snapshot,
    userId: "hidden", scopeId: "hidden", candidate: { prompt: "hidden" }, token: "hidden", stack: "hidden",
    shadow: { ...snapshot.shadow, prompt: "hidden", reasonCodes: ["LOW_AGREEMENT", "private token"] },
    enforced: { ...snapshot.enforced, memory: "hidden", rejectionReasons: { COOLDOWN: 2, "private token": 9 } }
  }) };
  const { app } = await fixture(t, { gate });
  const response = await app.inject({ method: "GET", url: "/api/v1/wake-decision/dashboard", headers: auth() });
  assert.deepEqual(response.json().shadow.reasonCodes, ["LOW_AGREEMENT"]);
  assert.deepEqual(response.json().enforced.rejectionReasons, { COOLDOWN: 2 });
  assert.doesNotMatch(response.body, /hidden|private|userId|scopeId|candidate|prompt|memory|chat|token|stack|api.?key/i);
});

test("only GET without query parameters is available", async t => {
  const { app, calls } = await fixture(t);
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await app.inject({ method, url: "/api/v1/wake-decision/dashboard", headers: auth(), payload: {} });
    assert.equal(response.statusCode, 404);
  }
  const query = await app.inject({ method: "GET", url: "/api/v1/wake-decision/dashboard?scopeId=private", headers: auth() });
  assert.equal(query.statusCode, 400);
  assert.equal(calls(), 0);
});

test("Dashboard reads do not call Adapter or change Gate mode", async t => {
  let adapterCalls = 0;
  const gate = {
    mode: "shadow",
    adapter: { evaluate() { adapterCalls++; } },
    getDashboardSnapshot: () => snapshot
  };
  const { app } = await fixture(t, { gate });
  const response = await app.inject({ method: "GET", url: "/api/v1/wake-decision/dashboard", headers: auth() });
  assert.equal(response.statusCode, 200);
  assert.equal(adapterCalls, 0);
  assert.equal(gate.mode, "shadow");
});

test("route has no database, model, persistence, or Wake internals dependency", async t => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const database = new Proxy({}, { get() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); } });
  const { app } = await fixture(t, { gate: { getDashboardSnapshot: () => snapshot }, model, database });
  await app.inject({ method: "GET", url: "/api/v1/wake-decision/dashboard", headers: auth() });
  assert.equal(model.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-routes.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|event-store|state-store|structured-memory-store|wake_up|model-adapter)["']\)|SELECT|INSERT|UPDATE|DELETE|fetch\(|(?:read|write)File/i);
});
