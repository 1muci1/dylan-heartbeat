"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { openDatabase } = require("../database");
const { StateStore } = require("../state-store");
const { registerStateRoutes } = require("../state-routes");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-state-routes-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  const store = new StateStore({ database: connection.db });
  const app = Fastify({ logger: false });
  registerStateRoutes(app, { store, apiKey: "state-token" });
  await app.ready();
  t.after(async () => { await app.close(); connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { app, db: connection.db, store };
}

const auth = token => ({ authorization: `Bearer ${token || "state-token"}` });

test("GET /api/v1/state returns only public companion/default State", async t => {
  const { app, db, store } = await fixture(t);
  store.set({
    scopeType: "companion",
    scopeId: "default",
    stateKey: "last_user_interaction_at",
    value: { timestamp: "2026-07-18T12:00:00Z", token: "hidden", nested: { prompt: "hidden", safe: true } },
    sourceKind: "event",
    confidence: 1
  });
  const before = Number(db.prepare("SELECT COUNT(*) n FROM companion_state").get().n);
  const response = await app.inject({ method: "GET", url: "/api/v1/state", headers: auth() });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items.length, 1);
  assert.deepEqual(response.json().items[0].value, { timestamp: "2026-07-18T12:00:00Z", nested: { safe: true } });
  for (const hidden of ["id", "version", "value_json", "sourceMemoryId"]) assert.equal(hidden in response.json().items[0], false);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), before);
});

test("State API auth, empty result, and scope restrictions", async t => {
  const { app } = await fixture(t);
  for (const headers of [{}, auth("wrong")]) {
    const response = await app.inject({ method: "GET", url: "/api/v1/state", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
  }
  const empty = await app.inject({ method: "GET", url: "/api/v1/state?scopeType=companion&scopeId=default", headers: auth() });
  assert.deepEqual(empty.json(), { items: [] });
  for (const url of ["/api/v1/state?scopeType=test&scopeId=default", "/api/v1/state?scopeType=companion&scopeId=internal-test"]) {
    const response = await app.inject({ method: "GET", url, headers: auth() });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "STATE_SCOPE_FORBIDDEN");
  }
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await app.inject({ method, url: "/api/v1/state", headers: auth(), payload: {} });
    assert.equal(response.statusCode, 404);
  }
});
