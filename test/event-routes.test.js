"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { openDatabase } = require("../database");
const { registerEventRoutes } = require("../event-routes");
const { EventStore } = require("../event-store");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-event-routes-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  let sequence = 0;
  const store = new EventStore({
    database: connection.db,
    clock: () => new Date("2026-07-18T12:00:00.000Z"),
    idFactory: () => `route-event-${++sequence}`
  });
  const app = Fastify({ logger: false });
  registerEventRoutes(app, {
    store,
    apiKey: "event-token",
    clock: () => new Date("2026-07-18T12:00:00.000Z")
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    connection.db.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  return { app, db: connection.db, store };
}

const auth = token => ({ authorization: `Bearer ${token || "event-token"}` });

test("list and get return readonly sanitized Events", async t => {
  const { app, db, store } = await fixture(t);
  const created = store.create({
    eventType: "chat.turn_completed",
    subjectType: "session",
    subjectId: "session-1",
    payload: {
      visible: "ok",
      token: "hidden",
      nested: { password: "hidden", result: "safe" },
      records: [{ prompt: "hidden", name: "kept" }]
    }
  }, { source: "gateway" });
  const beforeEvents = Number(db.prepare("SELECT COUNT(*) n FROM events").get().n);
  const beforeMemories = Number(db.prepare("SELECT COUNT(*) n FROM memory_items").get().n);

  const list = await app.inject({ method: "GET", url: "/api/v1/events", headers: auth() });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().items.length, 1);
  assert.deepEqual(list.json().items[0].payload, {
    visible: "ok",
    nested: { result: "safe" },
    records: [{ name: "kept" }]
  });

  const get = await app.inject({ method: "GET", url: `/api/v1/events/${created.id}`, headers: auth() });
  assert.equal(get.statusCode, 200, get.body);
  assert.equal(get.json().event.id, created.id);
  assert.equal(get.json().event.dedupeKey, undefined);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM events").get().n), beforeEvents);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), beforeMemories);
});

test("list supports pagination, filters, sort, time range, and expiry", async t => {
  const { app, store } = await fixture(t);
  store.create({ eventType: "memory.created", subjectType: "memory", subjectId: "m1", occurredAt: "2026-07-15T10:00:00Z" }, { source: "memory-api" });
  store.create({ eventType: "ai_job.completed", subjectType: "ai_job", subjectId: "j1", occurredAt: "2026-07-16T10:00:00Z" }, { source: "ai-task-runner" });
  store.create({ eventType: "memory.updated", subjectType: "memory", subjectId: "m1", occurredAt: "2026-07-17T10:00:00Z" }, { source: "memory-api" });
  store.create({ eventType: "memory.deleted", subjectType: "memory", subjectId: "expired", occurredAt: "2026-07-17T11:00:00Z", expiresAt: "2026-07-18T11:00:00Z" }, { source: "memory-api" });

  const page = await app.inject({ method: "GET", url: "/api/v1/events?page=2&limit=2", headers: auth() });
  assert.deepEqual(page.json().meta, { page: 2, limit: 2, total: 3, totalPages: 2 });
  assert.equal(page.json().items.length, 1);

  const filter = await app.inject({ method: "GET", url: "/api/v1/events?category=memory&source=memory-api&subjectType=memory&subjectId=m1&sort=oldest", headers: auth() });
  assert.deepEqual(filter.json().items.map(item => item.eventType), ["memory.created", "memory.updated"]);

  const type = await app.inject({ method: "GET", url: "/api/v1/events?eventType=ai_job.completed", headers: auth() });
  assert.deepEqual(type.json().items.map(item => item.subjectId), ["j1"]);

  const time = await app.inject({ method: "GET", url: "/api/v1/events?occurredFrom=2026-07-16T00:00:00Z&occurredTo=2026-07-17T00:00:00Z", headers: auth() });
  assert.deepEqual(time.json().items.map(item => item.subjectId), ["j1"]);

  const expired = await app.inject({ method: "GET", url: "/api/v1/events?includeExpired=true", headers: auth() });
  assert.equal(expired.json().meta.total, 4);
});

test("auth, not found, and invalid query errors are enforced", async t => {
  const { app } = await fixture(t);
  for (const headers of [{}, auth("wrong")]) {
    const response = await app.inject({ method: "GET", url: "/api/v1/events", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
  }
  const missing = await app.inject({ method: "GET", url: "/api/v1/events/missing", headers: auth() });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "EVENT_NOT_FOUND");
  for (const url of [
    "/api/v1/events?page=0",
    "/api/v1/events?limit=101",
    "/api/v1/events?sort=random",
    "/api/v1/events?includeExpired=yes",
    "/api/v1/events?eventType=unknown",
    "/api/v1/events?occurredFrom=invalid",
    "/api/v1/events?unknown=value"
  ]) {
    const response = await app.inject({ method: "GET", url, headers: auth() });
    assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
  }
});
