"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { openDatabase } = require("../database");
const { DeliveryStore } = require("../delivery-store");
const { EventStore } = require("../event-store");
const { StateStore } = require("../state-store");
const { ProactiveContactSettings } = require("../proactive-contact-settings");
const { registerProactiveDeliveryRoutes } = require("../proactive-delivery-routes");
const { ProactiveSendGate } = require("../proactive-send-gate");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proactive-routes-"));
  const connection = openDatabase(path.join(dir, "db.sqlite"));
  connection.db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-20T00:00:00Z')").run();
  let n = 0;
  const deliveries = new DeliveryStore({ database: connection.db, clock: () => new Date(`2026-07-20T${String(++n).padStart(2, "0")}:00:00Z`) });
  const states = new StateStore({ database: connection.db });
  const events = new EventStore({ database: connection.db });
  const settings = new ProactiveContactSettings({ stateStore: states, eventStore: events });
  const app = Fastify({ logger: false });
  registerProactiveDeliveryRoutes(app, { deliveryStore: deliveries, settings, apiKey: "dashboard-token" });
  await app.ready();
  t.after(async () => { await app.close(); connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { app, db: connection.db, deliveries, states };
}

const auth = { authorization: "Bearer dashboard-token" };

test("Delivery list requires authentication, caps limit, filters dates/status, and exposes only its whitelist", async t => {
  const f = await fixture(t);
  const one = f.deliveries.create({ jobId: "job-1", channel: "bark", text: "secret text", reasonCode: "FOLLOW_UP", dedupeKey: "one" });
  f.deliveries.create({ jobId: "job-1", channel: "bark", text: "other secret", reasonCode: "REMINDER", dedupeKey: "two" });
  assert.equal((await f.app.inject({ method: "GET", url: "/api/v1/proactive/deliveries" })).statusCode, 401);
  assert.equal((await f.app.inject({ method: "GET", url: "/api/v1/proactive/deliveries?limit=101", headers: auth })).statusCode, 400);
  const response = await f.app.inject({ method: "GET", url: "/api/v1/proactive/deliveries?limit=1&status=pending&from=2026-07-20T00:30:00Z&to=2026-07-20T01:30:00Z", headers: auth });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 1);
  assert.equal(response.json().items[0].id, one.id);
  assert.deepEqual(Object.keys(response.json().items[0]), ["id", "channel", "status", "reasonCode", "attemptCount", "createdAt", "sentAt", "failedAt"]);
  assert.doesNotMatch(JSON.stringify(response.json()), /secret|provider|token|url|stack|lock/i);
});

test("Delivery detail exposes retry failure code but no content or internals and no retry route", async t => {
  const f = await fixture(t);
  const delivery = f.deliveries.create({ jobId: "job-1", channel: "bark", text: "never expose", reasonCode: "FOLLOW_UP", dedupeKey: "detail" });
  f.deliveries.claimPending();
  f.deliveries.markFailed(delivery.id, "NETWORK_TIMEOUT");
  const response = await f.app.inject({ method: "GET", url: `/api/v1/proactive/deliveries/${delivery.id}`, headers: auth });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().lastErrorCode, "NETWORK_TIMEOUT");
  assert.deepEqual(Object.keys(response.json()), ["id", "status", "channel", "reasonCode", "attemptCount", "createdAt", "sentAt", "failedAt", "lastErrorCode"]);
  assert.doesNotMatch(JSON.stringify(response.json()), /never expose|jobId|eventId|lockOwner|nextRetryAt/i);
  assert.equal((await f.app.inject({ method: "POST", url: `/api/v1/proactive/deliveries/${delivery.id}/retry`, headers: auth })).statusCode, 404);
});

test("settings use defaults, persist user State, and emit only key preference events", async t => {
  const f = await fixture(t);
  const initial = await f.app.inject({ method: "GET", url: "/api/v1/proactive/settings", headers: auth });
  assert.deepEqual(initial.json(), { enabled: true, quietHours: { start: "23:00", end: "08:00" } });

  assert.equal((await f.app.inject({ method: "PUT", url: "/api/v1/proactive/settings", headers: auth, payload: { enabled: false } })).statusCode, 200);
  const updated = await f.app.inject({ method: "PUT", url: "/api/v1/proactive/settings", headers: auth,
    payload: { quietHours: { start: "22:30", end: "07:15" } } });
  assert.deepEqual(updated.json(), { enabled: false, quietHours: { start: "22:30", end: "07:15" } });
  const enabled = f.states.get("companion", "default", "proactive_contact.enabled");
  const quiet = f.states.get("companion", "default", "proactive_contact.quiet_hours");
  assert.equal(enabled.value, false); assert.equal(enabled.sourceKind, "user");
  assert.deepEqual(quiet.value, { start: "22:30", end: "07:15" }); assert.equal(quiet.sourceKind, "user");
  const events = f.db.prepare("SELECT event_type,payload_json FROM events ORDER BY created_at,id").all();
  assert.deepEqual(events.map(row => ({ type: row.event_type, payload: JSON.parse(row.payload_json) })), [
    { type: "preference.changed", payload: { key: "proactive_contact.enabled" } },
    { type: "preference.changed", payload: { key: "proactive_contact.quiet_hours" } }
  ]);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
  const state = f.states.getPublicState("companion", "default");
  const decision = new ProactiveSendGate().evaluate({
    response: { action: "proactive_contact", text: "hello", reasonCode: "FOLLOW_UP" },
    candidate: {}, state, now: new Date("2026-07-20T12:00:00Z")
  });
  assert.deepEqual(decision, { allowed: false, reasonCode: "CONTACT_DISABLED" });
});

test("illegal policy/personality settings and malformed values are rejected without side effects", async t => {
  const f = await fixture(t);
  for (const payload of [
    { dailyBudget: 2 }, { cooldown: 1 }, { priority: 5 }, { rollout: 100 }, { mood: "happy" },
    { enabled: "false" }, { quietHours: { start: "25:00", end: "08:00" } }, {}
  ]) {
    const response = await f.app.inject({ method: "PUT", url: "/api/v1/proactive/settings", headers: auth, payload });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM events").get().n), 0);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
});

test("route and settings modules have no model, Memory, Bark sender, Gate, or retry mutation dependencies", () => {
  const source = ["proactive-delivery-routes.js", "proactive-contact-settings.js"].map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /require\([^)]*(model-adapter|memory|bark-push|send-gate|retry-policy)/i);
  assert.doesNotMatch(source, /scheduleRetry|markSent|markFailed|fetch\(/);
});
