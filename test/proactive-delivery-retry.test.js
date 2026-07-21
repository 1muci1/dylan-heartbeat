"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS, applyMigrations, configureDatabase, openDatabase } = require("../database");
const { DeliveryStore } = require("../delivery-store");
const { DeliveryRetryPolicy } = require("../delivery-retry-policy");
const { EventStore } = require("../event-store");
const { ProactiveDeliveryWorker } = require("../proactive-delivery-worker");

async function databaseFile(t, prefix) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "database.sqlite");
}

test("migration 12 upgrades v11, preserves rows, and is idempotent", async t => {
  const db = new DatabaseSync(await databaseFile(t, "heartbeat-retry-migration-"));
  configureDatabase(db);
  applyMigrations(db, { migrations: MIGRATIONS.slice(0, 11) });
  db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-18T00:00:00Z')").run();
  db.prepare(`INSERT INTO deliveries (id,job_id,channel,status,text,reason_code,created_at,attempt_count)
    VALUES ('delivery-1','job-1','push','failed','safe','FOLLOW_UP','2026-07-18T00:01:00Z',2)`).run();
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 12) }), [12]);
  assert.deepEqual({ ...db.prepare(`SELECT status,attempt_count,max_attempt_count,next_retry_at,last_error_code
    FROM deliveries WHERE id='delivery-1'`).get() }, {
    status: "failed", attempt_count: 2, max_attempt_count: 3, next_retry_at: null, last_error_code: null
  });
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 12) }), []);
  db.close();
});

async function fixture(t) {
  const connection = openDatabase(await databaseFile(t, "heartbeat-delivery-retry-"));
  connection.db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-18T00:00:00Z')").run();
  let now = new Date("2026-07-18T12:00:00.000Z");
  const clock = () => new Date(now.getTime());
  const store = new DeliveryStore({ database: connection.db, clock, workerId: "retry-worker" });
  const eventStore = new EventStore({ database: connection.db, clock });
  const policy = new DeliveryRetryPolicy({ clock });
  t.after(() => connection.db.close());
  return { db: connection.db, store, eventStore, policy, clock, setNow(value) { now = new Date(value); } };
}

function create(store, suffix) {
  return store.create({ jobId: "job-1", channel: "push", text: `safe-${suffix}`, reasonCode: "FOLLOW_UP", dedupeKey: `retry-${suffix}` });
}

async function failOnce(f, suffix, reasonCode) {
  create(f.store, suffix);
  const worker = new ProactiveDeliveryWorker({ deliveryStore: f.store, eventStore: f.eventStore, retryPolicy: f.policy,
    pushAdapter: { async send() { return { success: false, reasonCode }; } } });
  return (await worker.runOnce(1))[0];
}

test("retryable Bark errors schedule retry and emit safe Events", async t => {
  for (const [index, code] of ["BARK_NETWORK_ERROR", "BARK_TIMEOUT", "BARK_PROVIDER_ERROR"].entries()) {
    const f = await fixture(t);
    const result = await failOnce(f, index, code);
    assert.equal(result.delivery.status, "pending");
    assert.equal(result.delivery.attemptCount, 1);
    assert.equal(result.delivery.lastErrorCode, code);
    assert.equal(result.delivery.nextRetryAt, "2026-07-18T12:01:00.000Z");
    const retryEvent = f.eventStore.list({ eventType: "delivery.retry_scheduled" }).items[0];
    assert.deepEqual(retryEvent.payload, { deliveryId: result.delivery.id, attemptCount: 1,
      nextRetryAt: "2026-07-18T12:01:00.000Z", reasonCode: code });
    assert.doesNotMatch(JSON.stringify(retryEvent.payload), /safe-|stack|provider response|token/i);
  }
});

test("configuration failures do not retry", async t => {
  for (const [index, code] of ["BARK_AUTH_FAILED", "BARK_DISABLED"].entries()) {
    const f = await fixture(t);
    const result = await failOnce(f, `config-${index}`, code);
    assert.equal(result.delivery.status, "failed");
    assert.equal(result.retryScheduled, undefined);
    assert.equal(f.eventStore.list({ eventType: "delivery.retry_scheduled" }).meta.total, 0);
  }
});

test("policy applies attempt limits, fixed backoff, and terminal status checks", () => {
  const policy = new DeliveryRetryPolicy({ clock: () => new Date("2026-07-18T12:00:00Z") });
  const base = { status: "failed", maxAttemptCount: 4, lastErrorCode: "BARK_RATE_LIMITED" };
  assert.equal(policy.evaluate({ ...base, attemptCount: 1 }).nextRetryAt, "2026-07-18T12:01:00.000Z");
  assert.equal(policy.evaluate({ ...base, attemptCount: 2 }).nextRetryAt, "2026-07-18T12:05:00.000Z");
  assert.equal(policy.evaluate({ ...base, attemptCount: 3 }).nextRetryAt, "2026-07-18T12:30:00.000Z");
  assert.deepEqual(policy.evaluate({ ...base, attemptCount: 3, maxAttemptCount: 3 }), { retry: false, reasonCode: "MAX_ATTEMPTS_REACHED" });
  assert.deepEqual(policy.evaluate({ status: "sent" }), { retry: false, reasonCode: "ALREADY_SENT" });
  assert.deepEqual(policy.evaluate({ status: "cancelled" }), { retry: false, reasonCode: "CANCELLED" });
});

test("scheduled retries are invisible until due and preserve attempt count", async t => {
  const f = await fixture(t);
  const result = await failOnce(f, "due", "BARK_NETWORK_ERROR");
  assert.deepEqual(f.store.claimPending(1), []);
  f.setNow("2026-07-18T12:01:00.000Z");
  const claimed = f.store.claimPending(1);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, result.delivery.id);
  assert.equal(claimed[0].attemptCount, 2);
  assert.equal(claimed[0].nextRetryAt, null);
});

test("scheduleRetry rejects sent and cancelled deliveries without model, network, Memory, or State access", async t => {
  const f = await fixture(t);
  create(f.store, "sent");
  const sent = f.store.markSent(f.store.claimPending(1)[0].id);
  assert.throws(() => f.store.scheduleRetry(sent.id, { nextRetryAt: "2026-07-18T12:01:00Z", lastErrorCode: "BARK_NETWORK_ERROR" }),
    error => error.code === "DELIVERY_ALREADY_SENT");
  create(f.store, "cancelled");
  const cancelledId = f.store.list({ sort: "newest" }).items[0].id;
  f.db.prepare("UPDATE deliveries SET status='cancelled' WHERE id=?").run(cancelledId);
  assert.throws(() => f.store.scheduleRetry(cancelledId, { nextRetryAt: "2026-07-18T12:01:00Z", lastErrorCode: "BARK_NETWORK_ERROR" }),
    error => error.code === "DELIVERY_STATUS_INVALID");
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 0);
  const sources = ["delivery-retry-policy.js", "proactive-delivery-worker.js"].map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /\bfetch\s*\(|model|memoryStore|stateStore/i);
});
