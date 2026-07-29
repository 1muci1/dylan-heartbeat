"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { openDatabase } = require("../database");
const { registerMemoryRoutes } = require("../memory-routes");
const { StructuredMemoryStore } = require("../structured-memory-store");
const { AgentMemoryRetriever } = require("../agent-memory-retriever");
const { AgentMemoryContextBuilder } = require("../agent-memory-context-builder");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-api-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  const store = new StructuredMemoryStore({ database: connection.db, filename: connection.filename });
  const retriever = new AgentMemoryRetriever({ store, defaultLimit: 12, defaultCharacterBudget: 5000 });
  const contextBuilder = new AgentMemoryContextBuilder({ maxItems: 12, maxCharacters: 5000 });
  const app = Fastify({ logger: false });
  registerMemoryRoutes(app, { store, retriever, contextBuilder, apiKey: "memory-token" });
  await app.ready();
  t.after(async () => {
    await app.close();
    connection.db.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  return { app, store };
}

const auth = token => ({ authorization: `Bearer ${token || "memory-token"}` });

async function create(app, body) {
  const response = await app.inject({ method: "POST", url: "/api/v1/memories", headers: auth(), payload: body });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().error, null);
  return response.json().data;
}

test("memory CRUD, soft delete, restore, Moments, filters, dates, keyword, and pagination", async t => {
  const { app } = await fixture(t);
  const first = await create(app, { type: "MEMORY", title: "Alpha", content: "quiet morning", occurredAt: "2026-07-01", importance: 2 });
  const moment = await create(app, { type: "MOMENT", title: "Moment", content: "summer rain", occurredAt: "2026-07-14T12:00:00Z", importance: 5 });
  await create(app, { type: "EVENT", title: "Boundary", content: "end of day", occurredAt: "2026-07-14T23:59:59.999Z" });

  const detail = await app.inject({ method: "GET", url: `/api/v1/memories/${first.id}`, headers: auth() });
  assert.equal(detail.json().data.content, "quiet morning");
  const edited = await app.inject({ method: "PATCH", url: `/api/v1/memories/${first.id}`, headers: auth(), payload: { title: "Edited", importance: 4 } });
  assert.equal(edited.json().data.title, "Edited");

  const moments = await app.inject({ method: "GET", url: "/api/v1/memories?type=MOMENT", headers: auth() });
  assert.deepEqual(moments.json().data.map(item => item.id), [moment.id]);
  const keyword = await app.inject({ method: "GET", url: "/api/v1/memories?keyword=rain", headers: auth() });
  assert.deepEqual(keyword.json().data.map(item => item.id), [moment.id]);
  const date = await app.inject({ method: "GET", url: "/api/v1/memories?dateFrom=2026-07-14&dateTo=2026-07-14", headers: auth() });
  assert.equal(date.json().meta.total, 2);
  const page = await app.inject({ method: "GET", url: "/api/v1/memories?page=2&limit=2&sort=oldest", headers: auth() });
  assert.equal(page.json().meta.page, 2);
  assert.equal(page.json().data.length, 1);

  const removed = await app.inject({ method: "DELETE", url: `/api/v1/memories/${first.id}`, headers: auth() });
  assert.equal(removed.json().data.status, "deleted");
  const hidden = await app.inject({ method: "GET", url: `/api/v1/memories/${first.id}`, headers: auth() });
  assert.equal(hidden.statusCode, 404);
  const deletedList = await app.inject({ method: "GET", url: "/api/v1/memories?status=deleted", headers: auth() });
  assert.equal(deletedList.json().data[0].id, first.id);
  const restored = await app.inject({ method: "POST", url: `/api/v1/memories/${first.id}/restore`, headers: auth() });
  assert.equal(restored.json().data.status, "active");

  const stats = await app.inject({ method: "GET", url: "/api/v1/memories/stats", headers: auth() });
  assert.equal(stats.json().data.total, 3);
  assert.equal(stats.json().data.byType.MOMENT, 1);
});

test("comment CRUD uses soft deletion", async t => {
  const { app } = await fixture(t);
  const memory = await create(app, { type: "MOMENT", content: "commentable moment" });
  const created = await app.inject({
    method: "POST", url: `/api/v1/memories/${memory.id}/comments`, headers: auth(),
    payload: { author: "我", content: "first comment" }
  });
  assert.equal(created.statusCode, 201);
  const comment = created.json().data;
  const edited = await app.inject({
    method: "PATCH", url: `/api/v1/memories/${memory.id}/comments/${comment.id}`, headers: auth(),
    payload: { content: "edited comment" }
  });
  assert.equal(edited.json().data.content, "edited comment");
  const listed = await app.inject({ method: "GET", url: `/api/v1/memories/${memory.id}/comments`, headers: auth() });
  assert.equal(listed.json().data.length, 1);
  await app.inject({ method: "DELETE", url: `/api/v1/memories/${memory.id}/comments/${comment.id}`, headers: auth() });
  const empty = await app.inject({ method: "GET", url: `/api/v1/memories/${memory.id}/comments`, headers: auth() });
  assert.deepEqual(empty.json().data, []);
});

test("auth and invalid parameters return uniform errors", async t => {
  const { app } = await fixture(t);
  for (const headers of [{}, auth("wrong")]) {
    const response = await app.inject({ method: "GET", url: "/api/v1/memories", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().data, null);
  }
  for (const url of [
    "/api/v1/memories?page=0",
    "/api/v1/memories?limit=101",
    "/api/v1/memories?type=UNKNOWN",
    "/api/v1/memories?dateFrom=invalid",
    "/api/v1/memories?sort=random"
  ]) {
    const response = await app.inject({ method: "GET", url, headers: auth() });
    assert.equal(response.statusCode, 400, url);
    assert.ok(response.json().error);
  }
});

test("admin Memory debug is authenticated and returns metadata without content or secrets", async t => {
  const { app } = await fixture(t);
  await create(app, {
    type: "MEMORY",
    title: "学习专业",
    content: "private memory body",
    importance: 5,
    source: "memory-import:v1:fact:debug"
  });
  const denied = await app.inject({ method: "GET", url: "/admin/memory/debug?query=专业" });
  assert.equal(denied.statusCode, 401);

  const response = await app.inject({
    method: "GET",
    url: "/admin/memory/debug?query=专业",
    headers: auth()
  });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.query, "专业");
  assert.ok(data.selectedAlwaysOn.some(item => item.title === "学习专业"));
  assert.equal(typeof data.finalInjectedTokenEstimate, "number");
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(serialized, /private memory body|memory-token|api.?key|bearer/iu);
});
