"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { DeliveryStore } = require("../delivery-store");
const { EventStore } = require("../event-store");
const { ProactiveDeliveryWorker } = require("../proactive-delivery-worker");
const { BarkPushAdapter } = require("../bark-push-adapter");

const delivery = overrides => ({ id: "delivery-1", channel: "push", text: "Safe proactive message", reasonCode: "FOLLOW_UP", ...overrides });

function adapter(fetchImpl, options = {}) {
  return new BarkPushAdapter({ enabled: true, serverUrl: "https://bark.example.test", deviceToken: "device-secret", fetch: fetchImpl, timeoutMs: 50, ...options });
}

test("Bark is disabled by default and missing configuration fails without network", async () => {
  let calls = 0;
  const fetch = async () => { calls++; throw new Error("NETWORK_MUST_NOT_RUN"); };
  assert.deepEqual(await new BarkPushAdapter({ fetch }).send(delivery()), { success: false, reasonCode: "BARK_DISABLED" });
  assert.deepEqual(await new BarkPushAdapter({ enabled: true, serverUrl: "https://bark.example.test", fetch }).send(delivery()),
    { success: false, reasonCode: "BARK_NOT_CONFIGURED" });
  assert.equal(calls, 0);
});

test("2xx sends only the fixed title and Delivery text", async () => {
  const calls = [];
  const bark = adapter(async (url, options) => { calls.push({ url, options }); return { status: 204 }; });
  const input = delivery({ prompt: "hidden", context: { secret: true }, memory: "private", token: "private" });
  const before = structuredClone(input);
  const result = await bark.send(input);
  assert.deepEqual(result, { success: true, provider: "bark" });
  assert.deepEqual(input, before);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { title: "AI Companion", body: "Safe proactive message" });
  assert.doesNotMatch(calls[0].options.body, /prompt|context|memory|reason|token|secret|private/i);
  assert.doesNotMatch(JSON.stringify(result), /device|url|body|token|stack/i);
});

test("HTTP failures map to fixed safe reason codes without reading response bodies", async () => {
  for (const [status, reasonCode] of [[401, "BARK_AUTH_FAILED"], [403, "BARK_AUTH_FAILED"], [429, "BARK_RATE_LIMITED"], [500, "BARK_PROVIDER_ERROR"]]) {
    let bodyReads = 0;
    const result = await adapter(async () => ({ status, async text() { bodyReads++; return "private provider body"; } })).send(delivery());
    assert.deepEqual(result, { success: false, reasonCode });
    assert.equal(bodyReads, 0);
    assert.doesNotMatch(JSON.stringify(result), /private|stack|token|url/i);
  }
});

test("timeout and network errors are isolated", async () => {
  const timeout = adapter(() => new Promise(() => {}), { timeoutMs: 10 });
  assert.deepEqual(await timeout.send(delivery()), { success: false, reasonCode: "BARK_TIMEOUT" });
  const network = adapter(async () => { throw new Error("private DNS error with token"); });
  assert.deepEqual(await network.send(delivery()), { success: false, reasonCode: "BARK_NETWORK_ERROR" });
});

async function workerFixture(t, fetchImpl, suffix) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `heartbeat-bark-${suffix}-`));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  connection.db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES (?,'proactive_response','completed','2026-07-18T00:00:00Z')").run(`job-${suffix}`);
  const deliveryStore = new DeliveryStore({ database: connection.db, workerId: `worker-${suffix}` });
  deliveryStore.create({ jobId: `job-${suffix}`, channel: "push", text: "Safe message", reasonCode: "FOLLOW_UP", dedupeKey: `delivery-${suffix}` });
  const eventStore = new EventStore({ database: connection.db });
  const worker = new ProactiveDeliveryWorker({ deliveryStore, eventStore, pushAdapter: adapter(fetchImpl) });
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { db: connection.db, deliveryStore, eventStore, worker };
}

test("Worker marks Bark success sent and schedules retryable Bark failure with safe Events", async t => {
  const success = await workerFixture(t, async () => ({ status: 200 }), "success");
  assert.equal((await success.worker.runOnce())[0].delivery.status, "sent");
  assert.equal(success.eventStore.list({ eventType: "delivery.sent" }).meta.total, 1);

  const failure = await workerFixture(t, async () => ({ status: 500 }), "failure");
  const failed = (await failure.worker.runOnce())[0];
  assert.equal(failed.delivery.status, "pending");
  assert.equal(failed.retryScheduled, true);
  assert.equal(failed.reasonCode, "BARK_PROVIDER_ERROR");
  const event = failure.eventStore.list({ eventType: "delivery.failed" }).items[0];
  assert.deepEqual(event.payload, { deliveryId: failed.delivery.id, channel: "push", reasonCode: "BARK_PROVIDER_ERROR" });
  assert.doesNotMatch(Object.keys(event.payload).join(" "), /text|response|stack|token|provider/i);
  assert.equal(Number(failure.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  assert.equal(Number(failure.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 0);
});

test("only Bark Adapter owns network access and has no model, Memory, State, or MCP dependency", () => {
  const barkSource = fs.readFileSync(path.join(__dirname, "..", "bark-push-adapter.js"), "utf8");
  assert.match(barkSource, /this\.fetch\(/);
  assert.doesNotMatch(barkSource, /model|memoryStore|stateStore|MCP/i);
  for (const file of ["proactive-delivery-worker.js", "delivery-store.js", "proactive-push-adapter.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/i);
  }
});
