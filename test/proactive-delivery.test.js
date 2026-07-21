"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS, applyMigrations, configureDatabase, openDatabase } = require("../database");
const { DeliveryStore } = require("../delivery-store");
const { StructuredMemoryStore } = require("../structured-memory-store");
const { AiMemoryStore } = require("../ai-memory-store");
const { AiTaskRunner } = require("../ai-task-runner");
const { EventStore } = require("../event-store");

async function tempFile(t, prefix) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "database.sqlite");
}

test("migration 10 upgrades v9 and is idempotent without changing jobs", async t => {
  const filename = await tempFile(t, "heartbeat-delivery-migration-");
  const db = new DatabaseSync(filename);
  configureDatabase(db);
  applyMigrations(db, { migrations: MIGRATIONS.slice(0, 9) });
  db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-18T00:00:00Z')").run();
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 10) }), [10]);
  assert.equal(db.prepare("SELECT status FROM ai_jobs WHERE id='job-1'").get().status, "completed");
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deliveries'").get());
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 10) }), []);
  db.close();
});

async function storeFixture(t) {
  const filename = await tempFile(t, "heartbeat-delivery-store-");
  const connection = openDatabase(filename);
  connection.db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-18T00:00:00Z')").run();
  const store = new DeliveryStore({ database: connection.db, clock: () => new Date("2026-07-18T12:00:00Z"), idFactory: (() => { let n = 0; return () => `delivery-${++n}`; })() });
  t.after(() => connection.db.close());
  return { db: connection.db, store };
}

test("DeliveryStore creates only bounded pending records and does not mutate input", async t => {
  const f = await storeFixture(t);
  const input = { jobId: "job-1", eventId: "event-1", channel: "push", text: "Safe response", reasonCode: "FOLLOW_UP", dedupeKey: "job-1:delivery" };
  const before = structuredClone(input);
  const delivery = f.store.create(input);
  assert.deepEqual(input, before);
  assert.deepEqual(delivery, {
    id: "delivery-1", jobId: "job-1", eventId: "event-1", channel: "push", status: "pending",
    text: "Safe response", reasonCode: "FOLLOW_UP", dedupeKey: "job-1:delivery",
    createdAt: "2026-07-18T12:00:00.000Z", sentAt: null, failedAt: null,
    attemptCount: 0, lockedAt: null, lockOwner: null,
    maxAttemptCount: 3, nextRetryAt: null, lastErrorCode: null
  });
  assert.deepEqual(f.store.get(delivery.id), delivery);
  assert.deepEqual(f.store.list({ status: "pending" }).meta, { page: 1, limit: 20, total: 1, totalPages: 1 });
  const columns = Object.keys(f.db.prepare("SELECT * FROM deliveries WHERE id=?").get(delivery.id));
  assert.doesNotMatch(columns.join(" "), /prompt|context|memory|token|model|raw/i);
});

test("dedupe, text length, protected fields, and missing ids are rejected", async t => {
  const f = await storeFixture(t);
  const input = { jobId: "job-1", channel: "push", text: "Safe", reasonCode: "FOLLOW_UP", dedupeKey: "same" };
  f.store.create(input);
  assert.throws(() => f.store.create(input), error => error.code === "DELIVERY_DUPLICATE");
  assert.throws(() => f.store.create({ ...input, dedupeKey: "long", text: "x".repeat(501) }), error => error.code === "DELIVERY_INVALID");
  for (const forbidden of ["id", "createdAt", "prompt", "content", "context", "token"]) {
    assert.throws(() => f.store.create({ ...input, dedupeKey: forbidden, [forbidden]: "secret" }), error => error.code === "DELIVERY_INVALID");
  }
  assert.throws(() => f.store.get("missing"), error => error.code === "DELIVERY_NOT_FOUND");
});

test("markSent and markFailed enforce pending-only state transitions", async t => {
  const f = await storeFixture(t);
  const sent = f.store.create({ jobId: "job-1", channel: "push", text: "one", reasonCode: "FOLLOW_UP", dedupeKey: "one" });
  const failed = f.store.create({ jobId: "job-1", channel: "push", text: "two", reasonCode: "FOLLOW_UP", dedupeKey: "two" });
  f.store.claimPending(2);
  assert.equal(f.store.markSent(sent.id).status, "sent");
  assert.ok(f.store.get(sent.id).sentAt);
  assert.equal(f.store.markFailed(failed.id).status, "failed");
  assert.ok(f.store.get(failed.id).failedAt);
  assert.throws(() => f.store.markFailed(sent.id), error => error.code === "DELIVERY_ALREADY_SENT");
});

async function runnerFixture(t, generated) {
  const filename = await tempFile(t, "heartbeat-delivery-runner-");
  const connection = openDatabase(filename);
  const memories = new StructuredMemoryStore({ database: connection.db, filename });
  const eventStore = new EventStore({ database: connection.db });
  const aiStore = new AiMemoryStore({ database: connection.db, memoryStore: memories, eventStore });
  const deliveryStore = new DeliveryStore({ database: connection.db });
  const runner = new AiTaskRunner({ store: aiStore, service: { provider: "fake" }, eventStore, deliveryStore,
    proactiveResponseAdapter: { async generate() { if (generated instanceof Error) throw generated; return generated; } },
    config: { concurrency: 1, timeoutMs: 1000, maxAttempts: 1 } });
  t.after(() => { runner.stop(); connection.db.close(); });
  return { db: connection.db, runner, deliveryStore };
}

test("suppressed and failed proactive jobs never create Delivery records", async t => {
  const suppressed = await runnerFixture(t, { action: "no_action", text: "", reasonCode: "MODEL_NO_ACTION" });
  const output = await suppressed.runner.run("proactive_response", null, {
    eventId: "event-s", reasonCode: "FOLLOW_UP", candidateType: "follow_up", context: {}
  });
  assert.deepEqual(output.result, { status: "suppressed", reasonCode: "NO_CONTACT_ACTION" });
  assert.equal(suppressed.deliveryStore.list().meta.total, 0);

  const failed = await runnerFixture(t, Object.assign(new Error("model unavailable"), { code: "MODEL_UNAVAILABLE" }));
  await assert.rejects(failed.runner.run("proactive_response", null, {
    eventId: "event-f", reasonCode: "FOLLOW_UP", candidateType: "follow_up", context: {}
  }), error => error.code === "MODEL_UNAVAILABLE");
  assert.equal(failed.deliveryStore.list().meta.total, 0);
  assert.equal(Number(failed.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(Number(failed.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 0);
});

test("Delivery layer contains no network, Bark, model, Memory, State, or MCP dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "delivery-store.js"), "utf8");
  assert.doesNotMatch(source, /fetch\(|https?:|Bark|model|memoryStore|stateStore|MCP/i);
});
