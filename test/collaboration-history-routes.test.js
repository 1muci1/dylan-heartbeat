"use strict";

const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { CollaborationHistoryService } = require("../collaboration-history-service");
const { registerCollaborationHistoryRoutes } = require("../collaboration-history-routes");
const { applyMigrations } = require("../database");

const apiKey = "history-route-test-key";
const auth = { authorization: `Bearer ${apiKey}` };
const app = Fastify({ logger: false });
const database = new DatabaseSync(":memory:");
applyMigrations(database);
let sequence = 0;
const service = new CollaborationHistoryService({
  idFactory: () => `route-history-${++sequence}`,
  now: () => "2026-07-24T23:00:00.000Z"
});
const first = service.save({
  roomId: "route-room-1",
  topic: "第一场议事",
  participants: ["chen", "chatgpt"],
  summary: "第一场议事的安全摘要。"
});
const second = service.save({
  roomId: "route-room-2",
  topic: "第二场议事",
  participants: ["chatgpt"],
  summary: "第二场议事的安全摘要。"
});
registerCollaborationHistoryRoutes(app, { service, apiKey });

before(() => app.ready());
after(async () => {
  await app.close();
  database.close();
});

test("lists Collaboration History records through an authenticated read-only GET", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/collaboration/history",
    headers: auth
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().records.map(record => record.id), [first.id, second.id]);
  assert.equal(response.json().error, null);
});

test("gets one History record with only the service fields", async () => {
  const response = await app.inject({
    method: "GET",
    url: `/api/collaboration/history/${first.id}`,
    headers: auth
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().record, first);
  assert.deepEqual(Object.keys(response.json().record), [
    "id",
    "roomId",
    "topic",
    "participants",
    "summary",
    "createdAt"
  ]);
});

test("requires the existing Gateway Bearer authentication", async () => {
  for (const headers of [{}, { authorization: "Bearer wrong-key" }]) {
    const response = await app.inject({
      method: "GET",
      url: "/api/collaboration/history",
      headers
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
    assert.equal(response.headers["www-authenticate"], "Bearer");
  }
});

test("returns a stable 404 for a missing History id", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/collaboration/history/missing-history",
    headers: auth
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    record: null,
    error: {
      code: "COLLABORATION_HISTORY_NOT_FOUND",
      message: "议事记录不存在"
    }
  });
});

test("read-only History requests leave Memory count unchanged", async () => {
  const before = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );
  await app.inject({ method: "GET", url: "/api/collaboration/history", headers: auth });
  await app.inject({
    method: "GET",
    url: `/api/collaboration/history/${second.id}`,
    headers: auth
  });
  const after = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );

  assert.equal(after, before);
});

test("HTTP response mutations cannot change History Service data", async () => {
  const response = await app.inject({
    method: "GET",
    url: `/api/collaboration/history/${first.id}`,
    headers: auth
  });
  const exposed = response.json().record;
  exposed.topic = "changed";
  exposed.participants.push("changed");

  assert.deepEqual(service.get(first.id), first);
});

test("service exceptions use a stable safe error structure", async t => {
  const failingApp = Fastify({ logger: false });
  t.after(() => failingApp.close());
  registerCollaborationHistoryRoutes(failingApp, {
    apiKey,
    service: {
      list() { throw Object.assign(new Error("private service detail"), { code: "PRIVATE_FAILURE" }); },
      get() { throw new Error("private service detail"); }
    }
  });
  await failingApp.ready();

  const response = await failingApp.inject({
    method: "GET",
    url: "/api/collaboration/history",
    headers: auth
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), {
    records: null,
    error: {
      code: "PRIVATE_FAILURE",
      message: "Collaboration History 服务暂时不可用"
    }
  });
  assert.doesNotMatch(response.body, /private service detail/);
});
