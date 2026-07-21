"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Fastify = require("fastify");
const { registerRelationshipRoutes } = require("../relationship-routes");

const auth = token => ({ authorization: `Bearer ${token || "relationship-token"}` });

async function fixture(t) {
  const view = {
    interactionStyle: { value: "concise", source: "memory" },
    proactiveContact: { enabled: true, source: "state" },
    familiarity: { level: 2, basis: "interaction_count" },
    recentTopics: ["Events"], importantMemoryIds: ["memory-1"], updatedAt: "2026-07-18T12:00:00.000Z"
  };
  let calls = 0;
  const app = Fastify({ logger: false });
  registerRelationshipRoutes(app, { service: { get() { calls++; return view; } }, apiKey: "relationship-token" });
  await app.ready();
  t.after(() => app.close());
  return { app, calls: () => calls, view };
}

test("GET /api/v1/relationship authenticates and returns only the default view", async t => {
  const { app, calls, view } = await fixture(t);
  for (const headers of [{}, auth("wrong")]) {
    const response = await app.inject({ method: "GET", url: "/api/v1/relationship", headers });
    assert.equal(response.statusCode, 401);
  }
  const response = await app.inject({ method: "GET", url: "/api/v1/relationship", headers: auth() });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), view);
  assert.equal(calls(), 1);
});

test("Relationship API rejects non-default scopes, extra parameters, and writes", async t => {
  const { app, calls } = await fixture(t);
  for (const url of [
    "/api/v1/relationship?scopeType=user&scopeId=default",
    "/api/v1/relationship?scopeType=companion&scopeId=internal-test"
  ]) {
    const response = await app.inject({ method: "GET", url, headers: auth() });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "RELATIONSHIP_SCOPE_FORBIDDEN");
  }
  const extra = await app.inject({ method: "GET", url: "/api/v1/relationship?stateKey=x", headers: auth() });
  assert.equal(extra.statusCode, 400);
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await app.inject({ method, url: "/api/v1/relationship", headers: auth(), payload: {} });
    assert.equal(response.statusCode, 404);
  }
  assert.equal(calls(), 0);
});
