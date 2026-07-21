"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { EventStore } = require("../event-store");
const { EVENT_DEFINITIONS } = require("../event-definitions");
const { RelationshipViewService } = require("../relationship-view");
const { StateStore } = require("../state-store");
const { StructuredMemoryStore } = require("../structured-memory-store");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-relationship-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  const definitions = {
    ...EVENT_DEFINITIONS,
    "project.milestone_reached": { category: "project", allowedSources: ["project-store"] }
  };
  const memoryStore = new StructuredMemoryStore({ database: connection.db });
  const eventStore = new EventStore({ database: connection.db, definitions });
  const stateStore = new StateStore({ database: connection.db });
  const service = new RelationshipViewService({
    memoryStore, eventStore, stateStore, clock: () => new Date("2026-07-18T12:00:00Z")
  });
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { db: connection.db, eventStore, memoryStore, service, stateStore };
}

test("Memory + State + Event produce a deterministic, content-free Relationship View", async t => {
  const { db, eventStore, memoryStore, service, stateStore } = await fixture(t);
  const preference = memoryStore.create({ type: "NOTE", title: "回复长度偏好", content: "用户喜欢简洁回复", importance: 4 }, { suppressEvent: true });
  const important = memoryStore.create({ type: "MEMORY", title: "重要项目", content: "private project detail", importance: 5 }, { suppressEvent: true });
  const ordinary = memoryStore.create({ type: "NOTE", title: "普通记录", content: "ordinary content", importance: 3 }, { suppressEvent: true });
  stateStore.set({ scopeType: "companion", scopeId: "default", stateKey: "interaction_count", value: { count: 25 }, sourceKind: "event" });
  stateStore.set({ scopeType: "companion", scopeId: "default", stateKey: "proactive_contact_enabled", value: { enabled: true }, sourceKind: "system" });
  stateStore.set({ scopeType: "companion", scopeId: "default", stateKey: "proactive_contact_cooldown", value: { minutes: 60, token: "hidden" }, sourceKind: "system" });
  eventStore.create({ eventType: "project.milestone_reached", subjectType: "project", subjectId: "project-1", payload: { topic: "Event infrastructure", content: "hidden" }, dedupeKey: "project-1" }, { source: "project-store" });
  eventStore.create({ eventType: "memory.created", subjectType: "memory", subjectId: important.id, payload: { type: "MEMORY", topic: "Architecture" }, dedupeKey: "relationship-memory" }, { source: "memory-api" });
  eventStore.create({ eventType: "chat.turn_completed", subjectType: "chat", subjectId: "chat-1", payload: { topic: "must-not-appear", prompt: "hidden" }, dedupeKey: "relationship-chat" }, { source: "gateway" });
  const before = {
    events: db.prepare("SELECT COUNT(*) n FROM events").get().n,
    memories: db.prepare("SELECT COUNT(*) n FROM memory_items").get().n,
    states: db.prepare("SELECT COUNT(*) n FROM companion_state").get().n
  };

  const view = service.get();
  assert.deepEqual(view.interactionStyle, { value: "concise", source: "memory" });
  assert.deepEqual(view.familiarity, { level: 2, basis: "interaction_count" });
  assert.equal(view.proactiveContact.enabled, true);
  assert.deepEqual(view.proactiveContact.cooldown, { minutes: 60 });
  assert.deepEqual(view.recentTopics, ["Architecture", "Event infrastructure"]);
  assert.deepEqual(new Set(view.importantMemoryIds), new Set([preference.id, important.id]));
  assert.equal(view.importantMemoryIds.includes(ordinary.id), false);
  assert.doesNotMatch(JSON.stringify(view), /private project detail|ordinary content|must-not-appear|hidden/);
  assert.deepEqual({
    events: db.prepare("SELECT COUNT(*) n FROM events").get().n,
    memories: db.prepare("SELECT COUNT(*) n FROM memory_items").get().n,
    states: db.prepare("SELECT COUNT(*) n FROM companion_state").get().n
  }, before);
});

test("empty stores return a stable default structure without model inference", async t => {
  const { service } = await fixture(t);
  const forbiddenModel = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  assert.deepEqual(service.get(), {
    interactionStyle: { value: "unspecified", source: "default" },
    proactiveContact: { enabled: false, source: "default" },
    familiarity: { level: 1, basis: "interaction_count" },
    recentTopics: [],
    importantMemoryIds: [],
    updatedAt: "2026-07-18T12:00:00.000Z"
  });
  assert.equal(forbiddenModel.calls, 0);
});
