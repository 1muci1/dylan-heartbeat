"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS, applyMigrations, configureDatabase, openDatabase } = require("../database");
const { StructuredMemoryStore } = require("../structured-memory-store");
const { AiMemoryStore } = require("../ai-memory-store");
const { AiTaskRunner } = require("../ai-task-runner");
const { EventStore } = require("../event-store");
const { DeliveryStore } = require("../delivery-store");

async function temporaryPath(t, prefix) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "database.sqlite");
}

test("migration 9 upgrades v8, preserves jobs, and is idempotent", async t => {
  const filename = await temporaryPath(t, "heartbeat-proactive-migration-");
  const db = new DatabaseSync(filename);
  configureDatabase(db);
  applyMigrations(db, { migrations: MIGRATIONS.slice(0, 8) });
  db.prepare(`INSERT INTO ai_jobs
    (id,job_type,status,input_message_count,attempt_count,provider,model,created_at,total_tokens)
    VALUES ('existing-job','session_summary','completed',4,1,'fake','old-model','2026-07-18T00:00:00.000Z',12)`).run();

  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 9) }), [9]);
  assert.deepEqual({ ...db.prepare("SELECT id,job_type,status,input_message_count,total_tokens FROM ai_jobs WHERE id='existing-job'").get() }, {
    id: "existing-job", job_type: "session_summary", status: "completed", input_message_count: 4, total_tokens: 12
  });
  db.prepare(`INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('proactive','proactive_response','queued','2026-07-18T00:01:00.000Z')`).run();
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 9) }), []);
  assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n), 2);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});

async function fixture(t) {
  const filename = await temporaryPath(t, "heartbeat-proactive-job-");
  const connection = openDatabase(filename);
  const memories = new StructuredMemoryStore({ database: connection.db, filename });
  const eventStore = new EventStore({ database: connection.db });
  const store = new AiMemoryStore({ database: connection.db, memoryStore: memories, eventStore });
  const deliveryStore = new DeliveryStore({ database: connection.db });
  let modelCalls = 0;
  const service = {
    provider: "fake",
    async generateSummary() { modelCalls++; throw new Error("MODEL_MUST_NOT_RUN"); },
    async extractCandidates() { modelCalls++; throw new Error("MODEL_MUST_NOT_RUN"); }
  };
  const runner = new AiTaskRunner({ store, service, eventStore, deliveryStore, config: {
    maxAttempts: 1, timeoutMs: 1000, concurrency: 1,
    summaryModel: "fake-summary", extractionModel: "fake-memory",
    automationEnabled: false, summaryEnabled: false, extractionEnabled: false
  }, proactiveResponseAdapter: { async generate() {
    modelCalls++;
    return { action: "proactive_contact", text: "Safe proactive response", reasonCode: "FOLLOW_UP" };
  }} });
  t.after(() => { runner.stop(); connection.db.close(); });
  return { db: connection.db, memories, eventStore, deliveryStore, store, runner, modelCalls: () => modelCalls };
}

test("createProactiveJob creates a bounded queued job and proactive Event", async t => {
  const f = await fixture(t);
  const job = f.store.createProactiveJob({ eventId: "event-1", reasonCode: "PROJECT_MILESTONE", candidateType: "project_milestone" });

  assert.equal(job.jobType, "proactive_response");
  assert.equal(job.status, "queued");
  assert.equal(job.sessionId, null);
  assert.deepEqual(job.payload, { eventId: "event-1", reasonCode: "PROJECT_MILESTONE", candidateType: "project_milestone" });
  const events = f.eventStore.list({ limit: 20 }).items;
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "ai_job.proactive_queued");
  assert.equal(events[0].subjectId, job.id);
  assert.deepEqual(events[0].payload, { jobType: "proactive_response", reasonCode: "PROJECT_MILESTONE" });
  assert.doesNotMatch(JSON.stringify(events[0]), /prompt|content|message|token|password/i);
  assert.equal(f.modelCalls(), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
});

test("proactive runner generates a validated result and completes without delivery", async t => {
  const f = await fixture(t);
  const output = await f.runner.run("proactive_response", null, {
    eventId: "event-2", reasonCode: "FOLLOW_UP", candidateType: "follow_up",
    context: { event: { id: "event-2", eventType: "follow_up", reasonCode: "FOLLOW_UP" }, memories: [] }
  });

  assert.equal(output.result.status, "delivery_created");
  assert.deepEqual({
    jobId: output.result.delivery.jobId,
    eventId: output.result.delivery.eventId,
    channel: output.result.delivery.channel,
    status: output.result.delivery.status,
    text: output.result.delivery.text,
    reasonCode: output.result.delivery.reasonCode
  }, { jobId: output.job.id, eventId: "event-2", channel: "push", status: "pending", text: "Safe proactive response", reasonCode: "FOLLOW_UP" });
  assert.equal(output.job.status, "completed");
  assert.equal(output.job.errorCode, null);
  assert.equal(f.modelCalls(), 1);
  const events = f.eventStore.list({ limit: 20, sort: "oldest" }).items;
  assert.deepEqual(events.map(event => event.eventType), ["ai_job.proactive_queued", "ai_job.completed"]);
  assert.equal(events[1].payload.jobType, "proactive_response");
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n), 0);
});

test("proactive input rejects content fields and old job types remain accepted", async t => {
  const f = await fixture(t);
  assert.throws(() => f.store.createProactiveJob({ eventId: "event-3", reasonCode: "TEST", candidateType: "test", prompt: "secret" }),
    error => error.code === "AI_JOB_INPUT_INVALID");

  f.db.prepare("INSERT INTO chat_sessions (id,title,created_at,updated_at) VALUES ('session-1','test',?,?)")
    .run("2026-07-18T00:00:00.000Z", "2026-07-18T00:00:00.000Z");
  assert.equal(f.store.createJob("session_summary", "session-1", 0, "fake", "fake-summary").jobType, "session_summary");
  assert.equal(f.store.createJob("memory_extraction", "session-1", 0, "fake", "fake-memory").jobType, "memory_extraction");
  assert.equal(f.modelCalls(), 0);
});
