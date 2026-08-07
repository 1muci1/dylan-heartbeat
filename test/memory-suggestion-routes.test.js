"use strict";

const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { test } = require("node:test");
const { registerMemorySuggestionRoutes } = require("../memory-suggestion-routes");

test("memory suggestion routes require auth and expose approve/reject only", async t => {
  const calls = [];
  const store = {
    list() { calls.push("list"); return [{ id: "suggestion-1", status: "pending", title: "安全标题" }]; },
    approve(id) { calls.push(`approve:${id}`); return { id, status: "approved" }; },
    reject(id) { calls.push(`reject:${id}`); return { id, status: "rejected" }; }
  };
  const app = Fastify({ logger: false });
  registerMemorySuggestionRoutes(app, { store, apiKey: "test-key" });
  await app.ready();
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/api/memory/suggestions" })).statusCode, 401);
  const headers = { authorization: "Bearer test-key" };
  assert.equal((await app.inject({ method: "GET", url: "/api/memory/suggestions", headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/memory/suggestions/suggestion-1/approve", headers })).json().data.status, "approved");
  assert.equal((await app.inject({ method: "POST", url: "/api/memory/suggestions/suggestion-2/reject", headers })).json().data.status, "rejected");
  assert.deepEqual(calls, ["list", "approve:suggestion-1", "reject:suggestion-2"]);
});
