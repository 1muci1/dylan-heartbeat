"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { MIGRATIONS, applyMigrations, configureDatabase, openDatabase } = require("../database");
const { DeliveryStore } = require("../delivery-store");
const { EventStore } = require("../event-store");
const { ProactiveDeliveryWorker } = require("../proactive-delivery-worker");
const { ProactivePushAdapter } = require("../proactive-push-adapter");

async function tempFile(t, prefix) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "database.sqlite");
}

test("migration 11 upgrades v10 with sending lease fields and preserves deliveries", async t => {
  const filename = await tempFile(t, "heartbeat-delivery-worker-migration-");
  const db = new DatabaseSync(filename);
  configureDatabase(db);
  applyMigrations(db, { migrations: MIGRATIONS.slice(0, 10) });
  db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-18T00:00:00Z')").run();
  db.prepare(`INSERT INTO deliveries (id,job_id,channel,status,text,reason_code,created_at)
    VALUES ('delivery-1','job-1','push','pending','safe','FOLLOW_UP','2026-07-18T00:01:00Z')`).run();
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 11) }), [11]);
  assert.deepEqual({ ...db.prepare("SELECT status,attempt_count,locked_at,lock_owner FROM deliveries WHERE id='delivery-1'").get() },
    { status: "pending", attempt_count: 0, locked_at: null, lock_owner: null });
  assert.deepEqual(applyMigrations(db, { migrations: MIGRATIONS.slice(0, 11) }), []);
  db.close();
});

async function fixture(t, options = {}) {
  const filename = await tempFile(t, "heartbeat-delivery-worker-");
  const connection = openDatabase(filename);
  connection.db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-18T00:00:00Z')").run();
  let now = new Date("2026-07-18T12:00:00Z");
  const clock = () => new Date(now.getTime());
  const store = new DeliveryStore({ database: connection.db, clock, workerId: options.workerId || "worker-1", lockTimeoutMinutes: 10 });
  const eventStore = new EventStore({ database: connection.db, clock });
  t.after(() => connection.db.close());
  return { db: connection.db, store, eventStore, clock, setNow(value) { now = new Date(value); } };
}

function create(store, suffix = "1") {
  return store.create({ jobId: "job-1", eventId: `event-${suffix}`, channel: "push", text: `safe-${suffix}`,
    reasonCode: "FOLLOW_UP", dedupeKey: `delivery-${suffix}` });
}

test("claimPending atomically moves pending to sending and prevents a second worker claim", async t => {
  const f = await fixture(t);
  const pending = create(f.store);
  const secondStore = new DeliveryStore({ database: f.db, clock: f.clock, workerId: "worker-2", lockTimeoutMinutes: 10 });
  const claimed = f.store.claimPending(10);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, pending.id);
  assert.equal(claimed[0].status, "sending");
  assert.equal(claimed[0].attemptCount, 1);
  assert.equal(claimed[0].lockOwner, "worker-1");
  assert.deepEqual(secondStore.claimPending(10), []);
});

test("expired sending locks can be reclaimed with an incremented attempt", async t => {
  const f = await fixture(t);
  create(f.store);
  assert.equal(f.store.claimPending(1)[0].attemptCount, 1);
  f.setNow("2026-07-18T12:11:00Z");
  const secondStore = new DeliveryStore({ database: f.db, clock: f.clock, workerId: "worker-2", lockTimeoutMinutes: 10 });
  const reclaimed = secondStore.claimPending(1);
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].attemptCount, 2);
  assert.equal(reclaimed[0].lockOwner, "worker-2");
});

test("worker marks successful sends and emits bounded created/sent Events", async t => {
  const f = await fixture(t);
  const delivery = create(f.store);
  let calls = 0;
  const worker = new ProactiveDeliveryWorker({ deliveryStore: f.store, eventStore: f.eventStore,
    pushAdapter: { async send(value) { calls++; assert.equal(value.id, delivery.id); return { success: true, providerResponse: "must not persist" }; } } });
  const [result] = await worker.runOnce();
  assert.equal(calls, 1);
  assert.equal(result.delivery.status, "sent");
  assert.equal(result.delivery.attemptCount, 1);
  const events = f.eventStore.list({ limit: 20, sort: "oldest" }).items;
  assert.deepEqual(events.map(event => event.eventType).sort(), ["delivery.created", "delivery.sent"]);
  assert.deepEqual(events.find(event => event.eventType === "delivery.sent").payload,
    { deliveryId: delivery.id, channel: "push", attemptCount: 1 });
  assert.doesNotMatch(JSON.stringify(events), /safe-1|providerResponse|token|prompt/i);
  await assert.rejects(worker.process(result.delivery), error => error.code === "DELIVERY_ALREADY_SENT");
  assert.equal(calls, 1);
});

test("adapter failures and exceptions mark failed with safe Events", async t => {
  const f = await fixture(t);
  create(f.store, "failure");
  const failedWorker = new ProactiveDeliveryWorker({ deliveryStore: f.store, eventStore: f.eventStore,
    pushAdapter: { async send() { return { success: false, reasonCode: "PUSH_FAILED", response: "private" }; } } });
  const [failed] = await failedWorker.runOnce();
  assert.equal(failed.delivery.status, "failed");
  assert.equal(failed.reasonCode, "PUSH_FAILED");

  create(f.store, "exception");
  const exceptionWorker = new ProactiveDeliveryWorker({ deliveryStore: f.store, eventStore: f.eventStore,
    pushAdapter: { async send() { throw new Error("private provider failure and token"); } } });
  const [exception] = await exceptionWorker.runOnce();
  assert.equal(exception.delivery.status, "failed");
  assert.equal(exception.reasonCode, "PUSH_FAILED");
  const events = f.eventStore.list({ limit: 20 }).items.filter(event => event.eventType === "delivery.failed");
  assert.equal(events.length, 2);
  assert.doesNotMatch(JSON.stringify(events), /private|token|response/i);
});

test("default adapter and Worker layer perform no network, Bark, model, Memory, State, or MCP access", async t => {
  const f = await fixture(t);
  create(f.store);
  const adapter = new ProactivePushAdapter();
  assert.deepEqual(await adapter.send({}), { success: false, reasonCode: "PUSH_NOT_CONFIGURED" });
  const worker = new ProactiveDeliveryWorker({ deliveryStore: f.store, pushAdapter: adapter });
  assert.equal((await worker.runOnce())[0].delivery.status, "failed");
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 0);
  for (const file of ["proactive-delivery-worker.js", "proactive-push-adapter.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(source, /fetch\(|https?:|model|memoryStore|stateStore|MCP/i);
  }
});
