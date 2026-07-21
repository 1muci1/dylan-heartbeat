"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { EventStore } = require("../event-store");
const { StructuredMemoryStore } = require("../structured-memory-store");
const { AiMemoryStore } = require("../ai-memory-store");
const { SessionStore } = require("../session-store");

async function fixture(t, options = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-events-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  const realEventStore = new EventStore({ database: connection.db });
  const eventStore = options.eventStore || realEventStore;
  const memories = new StructuredMemoryStore({ database: connection.db, filename: connection.filename, eventStore });
  const candidates = new AiMemoryStore({ database: connection.db, memoryStore: memories, eventStore });
  const sessions = new SessionStore({ database: connection.db, filename: connection.filename });
  const forbiddenAdapter = {
    calls: 0,
    async generate() {
      this.calls++;
      throw new Error("MODEL_MUST_NOT_BE_CALLED");
    }
  };
  t.after(async () => {
    connection.db.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  return { db: connection.db, realEventStore, eventStore, memories, candidates, sessions, forbiddenAdapter };
}

function assertSafePayload(payload) {
  assert.doesNotMatch(JSON.stringify(payload), /content|prompt|token|password|stack/i);
}

test("StructuredMemoryStore records safe CRUD lifecycle Events", async t => {
  const f = await fixture(t);
  const memory = f.memories.create({
    type: "MEMORY",
    title: "private title",
    content: "private full memory content",
    importance: 4,
    source: "manual"
  }, { eventContext: { source: "memory-api" } });
  const updated = f.memories.update(memory.id, { title: "new private title", importance: 5 }, { source: "memory-api" });
  f.memories.softDelete(memory.id, { source: "memory-api" });
  const restored = f.memories.restore(memory.id, { source: "memory-api" });

  const events = f.realEventStore.list({ limit: 100, sort: "oldest" }).items;
  assert.deepEqual(events.map(event => event.eventType).sort(), [
    "memory.created", "memory.updated", "memory.deleted", "memory.restored"
  ].sort());
  for (const event of events) {
    assert.equal(event.subjectType, "memory");
    assert.equal(event.subjectId, memory.id);
    assertSafePayload(event.payload);
  }
  const byType=Object.fromEntries(events.map(event=>[event.eventType,event]));
  assert.deepEqual(byType["memory.created"].payload, { type: "MEMORY", importance: 4, source: "manual" });
  assert.equal(byType["memory.created"].dedupeKey, `memory:${memory.id}:created`);
  assert.deepEqual(byType["memory.updated"].payload, { changedFields: ["title", "importance"] });
  assert.equal(byType["memory.updated"].dedupeKey, `memory:${memory.id}:updated:${updated.updatedAt}`);
  assert.deepEqual(byType["memory.deleted"].payload, { previousStatus: "active" });
  assert.equal(byType["memory.deleted"].dedupeKey, `memory:${memory.id}:deleted`);
  assert.deepEqual(byType["memory.restored"].payload, { previousStatus: "deleted" });
  assert.equal(byType["memory.restored"].dedupeKey, `memory:${memory.id}:restored`);
  assert.equal(restored.status, "active");

  f.memories.softDelete(memory.id, { source: "memory-api" });
  assert.equal(f.realEventStore.list({ eventType: "memory.deleted", limit: 100 }).meta.total, 1);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 1);
  assert.equal(f.forbiddenAdapter.calls, 0);
});

test("Candidate create, approve, and reject emit bounded Events without recursion", async t => {
  const f = await fixture(t);
  const session = f.sessions.createSession("candidate events");
  const approvedCandidate = f.candidates.insertCandidates(session.id, [{
    type: "NOTE",
    title: "private candidate title",
    content: "private candidate content",
    importance: 4,
    reason: "private extraction reason"
  }]).candidates[0];
  const approved = f.candidates.approveCandidate(approvedCandidate.id, {}, "reviewer");

  const rejectedCandidate = f.candidates.insertCandidates(session.id, [{
    type: "EVENT",
    content: "another private candidate",
    importance: 2,
    reason: "sensitive rejection context"
  }]).candidates[0];
  f.candidates.setCandidateStatus(rejectedCandidate.id, "reject", "reviewer");

  const events = f.realEventStore.list({ limit: 100, sort: "oldest" }).items;
  assert.deepEqual(events.map(event => event.eventType).sort(), [
    "memory_candidate.created",
    "memory.created",
    "memory_candidate.approved",
    "memory_candidate.created",
    "memory_candidate.rejected"
  ].sort());
  assert.equal(events.length, 5);
  const approvedEvent = events.find(event => event.eventType === "memory_candidate.approved");
  const memoryEvent = events.find(event => event.eventType === "memory.created");
  assert.equal(approvedEvent.subjectId, approvedCandidate.id);
  assert.equal(memoryEvent.subjectId, approved.approvedMemoryId);
  assert.ok(approvedEvent.correlationId);
  assert.equal(approvedEvent.correlationId, memoryEvent.correlationId);
  assert.equal(approvedEvent.source, "memory-candidate");
  assert.equal(memoryEvent.source, "memory-candidate");

  const rejectedEvent = events.find(event => event.eventType === "memory_candidate.rejected");
  assert.deepEqual(rejectedEvent.payload, { reasonCode: "USER_REJECTED" });
  for (const event of events) assertSafePayload(event.payload);

  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 1);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n), 2);
  assert.equal(f.candidates.listCandidates({}).meta.total, 2);
  assert.equal(f.forbiddenAdapter.calls, 0);
});

test("Memory and Candidate main flows survive Event write failures", async t => {
  const failingEventStore = {
    create() { throw Object.assign(new Error("event unavailable"), { code: "EVENT_WRITE_FAILED" }); }
  };
  const f = await fixture(t, { eventStore: failingEventStore });
  const memory = f.memories.create({ content: "create survives" }, { eventContext: { source: "memory-api" } });
  assert.equal(f.memories.update(memory.id, { title: "update survives" }, { source: "memory-api" }).title, "update survives");
  f.memories.softDelete(memory.id, { source: "memory-api" });
  assert.equal(f.memories.restore(memory.id, { source: "memory-api" }).status, "active");

  const session = f.sessions.createSession("approve survives");
  const candidate = f.candidates.insertCandidates(session.id, [{ type: "NOTE", content: "approve survives" }]).candidates[0];
  const approved = f.candidates.approveCandidate(candidate.id, {}, "reviewer");
  assert.equal(approved.status, "approved");
  assert.ok(approved.approvedMemoryId);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 2);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n), 1);
  assert.equal(f.realEventStore.list({ limit: 100 }).meta.total, 0);
  assert.equal(f.forbiddenAdapter.calls, 0);
});

test("Candidate approval rolls back both correlated Events when the second Event write fails", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-event-savepoint-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  const realEventStore = new EventStore({ database: connection.db });
  const selectiveStore = {
    create(input, context) {
      if (input.eventType === "memory_candidate.approved") throw Object.assign(new Error("forced second event failure"), { code: "EVENT_WRITE_FAILED" });
      return realEventStore.create(input, context);
    }
  };
  const memories = new StructuredMemoryStore({ database: connection.db, eventStore: selectiveStore });
  const candidates = new AiMemoryStore({ database: connection.db, memoryStore: memories, eventStore: selectiveStore });
  const sessions = new SessionStore({ database: connection.db });
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });

  const session = sessions.createSession("savepoint");
  const candidate = candidates.insertCandidates(session.id, [{ type: "NOTE", content: "savepoint candidate" }]).candidates[0];
  const before = realEventStore.list({ limit: 100 }).meta.total;
  const approved = candidates.approveCandidate(candidate.id);
  assert.equal(approved.status, "approved");
  assert.equal(Number(connection.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 1);
  assert.equal(realEventStore.list({ limit: 100 }).meta.total, before);
});
