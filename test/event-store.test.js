"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS, applyMigrations, openDatabase } = require("../database");
const { EventStore, MAX_PAYLOAD_BYTES } = require("../event-store");

async function fixture(t, options = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-events-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  let sequence = 0;
  const store = new EventStore({
    database: connection.db,
    clock: options.clock || (() => new Date("2026-07-18T12:00:00.000Z")),
    idFactory: options.idFactory || (() => `event-${++sequence}`)
  });
  t.after(async () => {
    connection.db.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  return { ...connection, store };
}

test("migration 7 creates events in a new database and is idempotent", async t => {
  const { db } = await fixture(t);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get());
  assert.deepEqual(applyMigrations(db), []);
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events'").all().map(row => row.name));
  for (const name of ["idx_events_dedupe_key", "idx_events_occurred", "idx_events_type_occurred", "idx_events_category_occurred", "idx_events_subject", "idx_events_correlation", "idx_events_expires"]) {
    assert.ok(indexes.has(name), name);
  }
});

test("migration 7 upgrades v6 without changing existing table data", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-events-upgrade-"));
  const db = new DatabaseSync(path.join(dir, "database.sqlite"));
  t.after(async () => { db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  applyMigrations(db, { migrations: MIGRATIONS.slice(0, 6) });
  db.prepare("INSERT INTO chat_sessions VALUES (?,?,?,?)").run("session-1", "keep", "2026-01-01", "2026-01-01");
  db.prepare("INSERT INTO memory_items (id,type,content,importance,status,created_at,updated_at,content_hash) VALUES (?,?,?,?,?,?,?,?)")
    .run("memory-1", "MEMORY", "unchanged", 3, "active", "2026-01-01", "2026-01-01", "event-upgrade-hash");
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 7) }), [7]);
  assert.equal(db.prepare("SELECT content FROM memory_items WHERE id='memory-1'").get().content, "unchanged");
  assert.equal(db.prepare("SELECT title FROM chat_sessions WHERE id='session-1'").get().title, "keep");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events").get().n, 0);
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 7) }), []);
});

test("create generates protected fields and validates registry source and payload", async t => {
  const { store } = await fixture(t);
  const event = store.create({
    eventType: "chat.turn_completed",
    subjectType: "session",
    subjectId: "session-1",
    payload: { messageCount: 2 },
    importance: 4,
    priority: 2
  }, { source: "gateway" });
  assert.equal(event.id, "event-1");
  assert.equal(event.category, "chat");
  assert.equal(event.createdAt, "2026-07-18T12:00:00.000Z");
  assert.deepEqual(event.payload, { messageCount: 2 });
  assert.throws(() => store.create({ eventType: "unknown" }, { source: "gateway" }), error => error.code === "EVENT_TYPE_UNKNOWN");
  assert.throws(() => store.create({ eventType: "chat.turn_completed" }, { source: "ai-task-runner" }), error => error.code === "EVENT_SOURCE_FORBIDDEN");
  assert.throws(() => store.create({ eventType: "chat.turn_completed" }), error => error.code === "EVENT_INVALID");
  for (const input of [
    { eventType: "chat.turn_completed", source: "gateway" },
    { eventType: "chat.turn_completed", category: "fake" },
    { eventType: "chat.turn_completed", id: "chosen" },
    { eventType: "chat.turn_completed", createdAt: "2020-01-01" }
  ]) assert.throws(() => store.create(input, { source: "gateway" }), error => error.code === "EVENT_INVALID");
  for (const payload of [null, [], "text", { invalid: undefined }, { invalid: Infinity }]) {
    assert.throws(() => store.create({ eventType: "chat.turn_completed", payload }, { source: "gateway" }), error => error.code === "EVENT_PAYLOAD_INVALID");
  }
  assert.throws(() => store.create({ eventType: "chat.turn_completed", payload: { text: "x".repeat(MAX_PAYLOAD_BYTES) } }, { source: "gateway" }), error => error.code === "EVENT_PAYLOAD_INVALID");
});

test("dedupe, get, existsByDedupeKey and not found behavior", async t => {
  const { store } = await fixture(t);
  const created = store.create({ eventType: "memory.created", dedupeKey: "memory:m1:created" }, { source: "structured-memory-store" });
  assert.equal(store.existsByDedupeKey("memory:m1:created"), true);
  assert.equal(store.existsByDedupeKey("memory:m2:created"), false);
  assert.deepEqual(store.get(created.id), created);
  assert.throws(() => store.create({ eventType: "memory.created", dedupeKey: "memory:m1:created" }, { source: "structured-memory-store" }), error => error.code === "EVENT_DUPLICATE");
  assert.throws(() => store.get("missing"), error => error.code === "EVENT_NOT_FOUND");
});

test("memory-import-runtime may create memory.created while unknown sources remain forbidden", async t => {
  const { store } = await fixture(t);
  const event = store.create({
    eventType: "memory.created",
    subjectType: "memory",
    subjectId: "imported-memory-1",
    payload: { type: "MEMORY", importance: 4, source: "memory-import:v1:fact:reviewed" },
    dedupeKey: "memory:imported-memory-1:created"
  }, { source: "memory-import-runtime" });
  assert.equal(event.eventType, "memory.created");
  assert.equal(event.source, "memory-import-runtime");
  assert.throws(
    () => store.create({ eventType: "memory.created" }, { source: "unapproved-memory-importer" }),
    error => error.code === "EVENT_SOURCE_FORBIDDEN"
  );
});

test("list paginates, filters time, and normalizes timestamps", async t => {
  const { store } = await fixture(t);
  for (const [index, occurredAt] of ["2026-07-16T12:00:00+02:00", "2026-07-17T10:00:00Z", "2026-07-18T10:00:00Z"].entries()) {
    store.create({ eventType: "ai_job.completed", subjectType: "ai_job", subjectId: `job-${index}`, occurredAt }, { source: "ai-task-runner" });
  }
  const page = store.list({ page: 2, limit: 2 });
  assert.deepEqual(page.meta, { page: 2, limit: 2, total: 3, totalPages: 2 });
  assert.equal(page.items.length, 1);
  const filtered = store.list({ occurredFrom: "2026-07-17T00:00:00Z", occurredTo: "2026-07-18T00:00:00Z" });
  assert.deepEqual(filtered.items.map(item => item.subjectId), ["job-1"]);
  assert.equal(store.list({ sort: "oldest" }).items[0].occurredAt, "2026-07-16T10:00:00.000Z");
  assert.throws(() => store.list({ occurredFrom: "not-a-date" }), error => error.code === "EVENT_TIME_INVALID");
});

test("EventStore does not modify Memory and has no model dependency", async t => {
  const { db, store } = await fixture(t);
  const before = Number(db.prepare("SELECT COUNT(*) n FROM memory_items").get().n);
  store.create({ eventType: "memory.created", payload: { memoryId: "not-created" } }, { source: "structured-memory-store" });
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), before);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n), 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n), 0);
});
