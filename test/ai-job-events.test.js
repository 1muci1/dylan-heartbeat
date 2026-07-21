"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { SessionStore } = require("../session-store");
const { StructuredMemoryStore } = require("../structured-memory-store");
const { AiMemoryStore } = require("../ai-memory-store");
const { AiTaskRunner } = require("../ai-task-runner");
const { EventStore } = require("../event-store");

async function fixture(t, options = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-ai-job-events-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  const sessions = new SessionStore({ database: connection.db, filename: connection.filename });
  const memories = new StructuredMemoryStore({ database: connection.db, filename: connection.filename });
  const realEventStore = new EventStore({ database: connection.db });
  const eventStore = options.eventStore || realEventStore;
  const store = new AiMemoryStore({ database: connection.db, memoryStore: memories, eventStore });
  const service = options.service || {
    provider: "fake",
    generateSummary: async () => ({ summary: { id: "fake-summary" } }),
    extractCandidates: async () => ({ candidates: [], duplicates: [] })
  };
  const runner = new AiTaskRunner({
    store,
    service,
    eventStore,
    config: {
      maxAttempts: 1,
      timeoutMs: 1000,
      concurrency: 1,
      summaryModel: "fake-summary",
      extractionModel: "fake-memory",
      automationEnabled: false,
      summaryEnabled: false,
      extractionEnabled: false
    }
  });
  t.after(async () => {
    runner.stop();
    connection.db.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  return { db: connection.db, sessions, memories, realEventStore, eventStore, store, runner };
}

function sessionWithMessage(fixture, title) {
  const session = fixture.sessions.createSession(title);
  fixture.sessions.addMessage(session.id, "user", "local test input");
  return session;
}

test("AI Job queued, completed, failed, and cancelled states emit bounded Events", async t => {
  const f = await fixture(t);

  const completedSession = sessionWithMessage(f, "completed");
  const completed = await f.runner.run("session_summary", completedSession.id);

  const failedSession = sessionWithMessage(f, "failed");
  const failure = Object.assign(new Error("private upstream detail"), { code: "FAKE_FAILURE", stack: "secret stack" });
  f.runner.service.generateSummary = async () => { throw failure; };
  await assert.rejects(f.runner.run("session_summary", failedSession.id), error => error.code === "FAKE_FAILURE");
  const failed = f.store.listJobs({ sessionId: failedSession.id }).items[0];

  const cancelledSession = sessionWithMessage(f, "cancelled");
  const queued = f.store.createJob("memory_extraction", cancelledSession.id, 1, "fake", "fake-memory");
  const cancelled = f.store.cancelJob(queued.id);

  const events = f.realEventStore.list({ limit: 100, sort: "oldest" }).items;
  assert.equal(events.length, 6);
  assert.deepEqual(events.map(event => event.eventType), [
    "ai_job.queued", "ai_job.completed", "ai_job.queued", "ai_job.failed", "ai_job.queued", "ai_job.cancelled"
  ]);

  const completedEvent = events.find(event => event.eventType === "ai_job.completed");
  assert.equal(completedEvent.subjectType, "ai_job");
  assert.equal(completedEvent.subjectId, completed.job.id);
  assert.equal(completedEvent.dedupeKey, `ai-job:${completed.job.id}:completed`);
  assert.equal(completedEvent.source, "ai-task-runner");
  assert.equal(completedEvent.payload.jobType, "session_summary");
  assert.equal(completedEvent.payload.attempt, 1);
  assert.equal(Number.isSafeInteger(completedEvent.payload.durationMs), true);

  const failedEvent = events.find(event => event.eventType === "ai_job.failed");
  assert.deepEqual(failedEvent.payload, { jobType: "session_summary", attempt: 1, errorCode: "FAKE_FAILURE" });
  assert.equal(failedEvent.subjectId, failed.id);
  assert.equal(failedEvent.dedupeKey, `ai-job:${failed.id}:failed:1`);
  assert.doesNotMatch(JSON.stringify(failedEvent.payload), /private|stack|prompt|key/i);

  const cancelledEvent = events.find(event => event.eventType === "ai_job.cancelled");
  assert.deepEqual(cancelledEvent.payload, { jobType: "memory_extraction", previousStatus: "queued" });
  assert.equal(cancelledEvent.subjectId, cancelled.id);
  assert.equal(cancelledEvent.dedupeKey, `ai-job:${cancelled.id}:cancelled`);

  for (const job of [completed.job, failed, cancelled]) {
    const queuedEvent = events.find(event => event.dedupeKey === `ai-job:${job.id}:queued`);
    assert.ok(queuedEvent);
    assert.equal(queuedEvent.subjectId, job.id);
    assert.deepEqual(queuedEvent.payload, { jobType: job.jobType, status: "queued" });
  }

  assert.throws(() => f.store.cancelJob(cancelled.id), error => error.code === "AI_JOB_NOT_CANCELLABLE");
  assert.equal(f.realEventStore.list({ limit: 100 }).meta.total, 6);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n), 0);
});

test("duplicate Event attempts do not create duplicate lifecycle Events", async t => {
  const f = await fixture(t);
  const session = sessionWithMessage(f, "dedupe");
  const job = f.store.createJob("session_summary", session.id, 1, "fake", "fake-summary");
  f.store.recordJobEvent({
    eventType: "ai_job.queued",
    subjectType: "ai_job",
    subjectId: job.id,
    payload: { jobType: job.jobType, status: "queued" },
    dedupeKey: `ai-job:${job.id}:queued`
  });
  assert.equal(f.realEventStore.list({ limit: 100 }).meta.total, 1);
  assert.equal(f.store.getJob(job.id).status, "queued");
});

test("Event write failures never roll back or fail AI Job state transitions", async t => {
  const failingEventStore = { create() { throw Object.assign(new Error("event unavailable"), { code: "EVENT_WRITE_FAILED" }); } };
  const f = await fixture(t, { eventStore: failingEventStore });

  const completedSession = sessionWithMessage(f, "event failure completed");
  const completed = await f.runner.run("session_summary", completedSession.id);
  assert.equal(completed.job.status, "completed");

  const failedSession = sessionWithMessage(f, "event failure failed");
  f.runner.service.generateSummary = async () => { throw Object.assign(new Error("fake"), { code: "FAKE_FAILURE" }); };
  await assert.rejects(f.runner.run("session_summary", failedSession.id), error => error.code === "FAKE_FAILURE");
  assert.equal(f.store.listJobs({ sessionId: failedSession.id }).items[0].status, "failed");

  const cancelledSession = sessionWithMessage(f, "event failure cancelled");
  const queued = f.store.createJob("memory_extraction", cancelledSession.id, 1, "fake", "fake-memory");
  assert.equal(queued.status, "queued");
  assert.equal(f.store.cancelJob(queued.id).status, "cancelled");
  assert.equal(f.realEventStore.list({ limit: 100 }).meta.total, 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n), 0);
});
