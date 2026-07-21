"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS, applyMigrations, openDatabase } = require("../database");
const { EventStore } = require("../event-store");
const { StateStore } = require("../state-store");
const { StateProjector } = require("../state-projector");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-state-projection-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  let sequence = 0;
  const stateStore = new StateStore({
    database: connection.db,
    clock: () => new Date("2026-07-18T12:00:00.000Z"),
    idFactory: () => `state-${++sequence}`
  });
  const eventStore = new EventStore({ database: connection.db });
  const projector = new StateProjector({ stateStore });
  const forbiddenAdapter = { calls: 0, async generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { db: connection.db, stateStore, eventStore, projector, forbiddenAdapter };
}

test("migration 8 upgrades v7 without changing existing Event or Memory data", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-state-upgrade-"));
  const db = new DatabaseSync(path.join(dir, "database.sqlite"));
  t.after(async () => { db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  applyMigrations(db, { migrations: MIGRATIONS.slice(0, 7) });
  db.prepare("INSERT INTO memory_items (id,type,content,importance,status,created_at,updated_at,content_hash) VALUES (?,?,?,?,?,?,?,?)")
    .run("memory-before-v8", "MEMORY", "unchanged", 3, "active", "2026-01-01", "2026-01-01", "state-upgrade-hash");
  db.prepare("INSERT INTO events (id,event_type,category,source,payload_json,importance,priority,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("event-before-v8", "memory.created", "memory", "memory-api", "{}", 3, 3, "2026-01-01", "2026-01-01");
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 8) }), [8]);
  assert.equal(db.prepare("SELECT content FROM memory_items WHERE id='memory-before-v8'").get().content, "unchanged");
  assert.equal(db.prepare("SELECT event_type FROM events WHERE id='event-before-v8'").get().event_type, "memory.created");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM companion_state").get().n, 0);
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 8) }), []);
});

test("StateStore set/get/list derives protected fields and increments version", async t => {
  const { stateStore } = await fixture(t);
  const first = stateStore.set({
    scopeType: "companion", scopeId: "default", stateKey: "test_key", value: { enabled: true },
    sourceKind: "system", confidence: 0.8
  });
  assert.equal(first.id, "state-1");
  assert.equal(first.version, 1);
  assert.equal(first.valueType, "object");
  const second = stateStore.set({
    scopeType: "companion", scopeId: "default", stateKey: "test_key", value: { enabled: false },
    sourceKind: "system", confidence: 1
  });
  assert.equal(second.id, first.id);
  assert.equal(second.version, 2);
  assert.deepEqual(stateStore.get("companion", "default", "test_key").value, { enabled: false });
  assert.deepEqual(stateStore.list("companion", "default").map(state => state.stateKey), ["test_key"]);
  for (const forbidden of ["id", "updatedAt", "version"]) {
    assert.throws(() => stateStore.set({
      scopeType: "companion", scopeId: "default", stateKey: "forbidden", value: {}, sourceKind: "system", [forbidden]: "x"
    }), error => error.code === "STATE_INVALID");
  }
});

test("StateProjector applies safe rules and is idempotent without mutating inputs", async t => {
  const f = await fixture(t);
  const chat = f.eventStore.create({
    eventType: "chat.turn_completed", subjectType: "session", subjectId: "session-1",
    payload: { content: "must not project", prompt: "secret", token: "secret" }, occurredAt: "2026-07-16T10:00:00Z"
  }, { source: "gateway" });
  const chatSnapshot = structuredClone(chat);
  const chatChanges = f.projector.project(chat);
  assert.equal(chatChanges.length, 1);
  assert.deepEqual(chatChanges[0].value, { timestamp: "2026-07-16T10:00:00.000Z" });
  assert.equal(chatChanges[0].sourceKind, "event");
  assert.equal(chatChanges[0].sourceEventId, chat.id);
  assert.deepEqual(chat, chatSnapshot);
  assert.deepEqual(f.projector.project(chat), []);
  assert.equal(f.stateStore.get("companion", "default", "last_user_interaction_at").version, 1);

  f.db.prepare("INSERT INTO memory_items (id,type,content,importance,status,created_at,updated_at,content_hash) VALUES (?,?,?,?,?,?,?,?)")
    .run("memory-1", "NOTE", "existing memory", 3, "active", "2026-07-17", "2026-07-17", "projection-memory-hash");
  const memory = f.eventStore.create({
    eventType: "memory.created", subjectType: "memory", subjectId: "memory-1",
    payload: { type: "NOTE", content: "full private content", prompt: "secret", token: "secret" },
    occurredAt: "2026-07-17T10:00:00Z"
  }, { source: "memory-api" });
  const memoryChanges = f.projector.project(memory);
  assert.deepEqual(memoryChanges[0].value, { memoryId: "memory-1", type: "NOTE" });
  assert.equal(memoryChanges[0].sourceMemoryId, "memory-1");

  const job = f.eventStore.create({
    eventType: "ai_job.completed", subjectType: "ai_job", subjectId: "job-1",
    payload: { jobType: "session_summary", prompt: "secret" }, occurredAt: "2026-07-18T10:00:00Z"
  }, { source: "ai-task-runner" });
  assert.deepEqual(f.projector.project(job)[0].value, { jobType: "session_summary", timestamp: "2026-07-18T10:00:00.000Z" });

  const serialized = JSON.stringify(f.stateStore.list("companion", "default"));
  assert.doesNotMatch(serialized, /full private content|prompt|secret|token/i);
  assert.equal(f.forbiddenAdapter.calls, 0);
});

test("projection leaves Event and Memory tables unchanged and ignores unsupported rules", async t => {
  const f = await fixture(t);
  const event = f.eventStore.create({
    eventType: "memory.updated", subjectType: "memory", subjectId: "memory-2", payload: { changedFields: ["title"] }
  }, { source: "memory-api" });
  const eventCount = Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n);
  const memoryCount = Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n);
  assert.deepEqual(f.projector.project(event), []);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n), eventCount);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), memoryCount);
  assert.equal(f.stateStore.list("companion", "default").length, 0);
  assert.equal(f.forbiddenAdapter.calls, 0);
});
