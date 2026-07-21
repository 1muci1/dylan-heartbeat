"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { EventStore } = require("../event-store");
const { StateStore } = require("../state-store");
const { StateProjector } = require("../state-projector");

async function fixture(t, options = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-event-state-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  const stateStore = new StateStore({ database: connection.db });
  const stateProjector = options.stateProjector === undefined ? new StateProjector({ stateStore }) : options.stateProjector;
  const eventStore = new EventStore({ database: connection.db, stateProjector });
  const forbiddenAdapter = { calls: 0, async generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { db: connection.db, eventStore, stateStore, stateProjector, forbiddenAdapter };
}

test("EventStore automatically projects chat.turn_completed after saving the Event", async t => {
  const f = await fixture(t);
  const event = f.eventStore.create({
    eventType: "chat.turn_completed",
    subjectType: "session",
    subjectId: "session-auto",
    payload: { content: "must not be projected", prompt: "secret", token: "secret" },
    occurredAt: "2026-07-18T09:30:00Z"
  }, { source: "gateway" });
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n), 1);
  const state = f.stateStore.get("companion", "default", "last_user_interaction_at");
  assert.deepEqual(state.value, { timestamp: "2026-07-18T09:30:00.000Z" });
  assert.equal(state.sourceEventId, event.id);
  assert.equal(state.version, 1);
  assert.doesNotMatch(JSON.stringify(state), /must not be projected|prompt|secret|token/i);
  assert.equal(f.forbiddenAdapter.calls, 0);
});

test("EventStore automatically projects memory.created without changing Memory", async t => {
  const f = await fixture(t);
  f.db.prepare("INSERT INTO memory_items (id,type,content,importance,status,created_at,updated_at,content_hash) VALUES (?,?,?,?,?,?,?,?)")
    .run("memory-auto", "NOTE", "existing content", 3, "active", "2026-07-18", "2026-07-18", "event-state-memory-hash");
  const beforeMemory = Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n);
  const event = f.eventStore.create({
    eventType: "memory.created",
    subjectType: "memory",
    subjectId: "memory-auto",
    payload: { type: "NOTE", content: "must not project" },
    occurredAt: "2026-07-18T10:00:00Z"
  }, { source: "memory-api" });
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n), 1);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), beforeMemory);
  const state = f.stateStore.get("companion", "default", "recent_memory_created_at");
  assert.deepEqual(state.value, { memoryId: "memory-auto", type: "NOTE" });
  assert.equal(state.sourceEventId, event.id);
  assert.equal(f.forbiddenAdapter.calls, 0);
});

test("Projection failure never removes or rejects the saved Event", async t => {
  const calls = [];
  const f = await fixture(t, { stateProjector: { project(event) { calls.push(event.id); throw new Error("forced projection failure"); } } });
  const event = f.eventStore.create({ eventType: "chat.turn_completed", occurredAt: "2026-07-18T11:00:00Z" }, { source: "gateway" });
  assert.equal(calls.length, 1);
  assert.equal(f.eventStore.get(event.id).id, event.id);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n), 1);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 0);
});

test("EventStore without a projector retains its previous behavior", async t => {
  const f = await fixture(t, { stateProjector: null });
  const event = f.eventStore.create({ eventType: "chat.turn_completed" }, { source: "gateway" });
  assert.equal(f.eventStore.get(event.id).id, event.id);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n), 1);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 0);
});

test("re-projecting the same Event is idempotent", async t => {
  const f = await fixture(t);
  const event = f.eventStore.create({ eventType: "chat.turn_completed", occurredAt: "2026-07-18T12:00:00Z" }, { source: "gateway" });
  const before = f.stateStore.get("companion", "default", "last_user_interaction_at");
  assert.deepEqual(f.stateProjector.project(event), []);
  const after = f.stateStore.get("companion", "default", "last_user_interaction_at");
  assert.equal(after.version, before.version);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n), 1);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(f.forbiddenAdapter.calls, 0);
});
