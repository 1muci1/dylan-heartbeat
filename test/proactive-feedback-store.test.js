"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { MIGRATIONS, applyMigrations, configureDatabase, openDatabase } = require("../database");
const { DatabaseSync } = require("node:sqlite");
const { DeliveryStore } = require("../delivery-store");
const { EventStore } = require("../event-store");
const { StateStore } = require("../state-store");
const { StateProjector } = require("../state-projector");
const { ProactiveFeedbackStore } = require("../proactive-feedback-store");
const { ProactiveView } = require("../proactive-view");
const { registerProactiveDeliveryRoutes } = require("../proactive-delivery-routes");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proactive-feedback-"));
  const connection = openDatabase(path.join(dir, "db.sqlite"));
  connection.db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-20T00:00:00Z')").run();
  let deliveryN = 0, feedbackN = 0;
  const deliveries = new DeliveryStore({ database: connection.db, clock: () => new Date("2026-07-20T10:00:00Z"), idFactory: () => `delivery-${++deliveryN}` });
  const states = new StateStore({ database: connection.db, clock: () => new Date("2026-07-20T12:00:00Z") });
  const projector = new StateProjector({ stateStore: states });
  const events = new EventStore({ database: connection.db, stateProjector: projector, clock: () => new Date("2026-07-20T12:00:00Z"), idFactory: () => `event-${feedbackN + 1}` });
  const feedback = new ProactiveFeedbackStore({ database: connection.db, deliveryStore: deliveries, eventStore: events,
    clock: () => new Date("2026-07-20T12:00:00Z"), idFactory: () => `feedback-${++feedbackN}` });
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { db: connection.db, deliveries, states, events, feedback };
}

test("migration v13 creates constrained feedback storage and preserves v12 Delivery", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "feedback-v13-"));
  const db = new DatabaseSync(path.join(dir, "db.sqlite")); configureDatabase(db);
  t.after(async () => { db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  applyMigrations(db, { migrations: MIGRATIONS.slice(0, 12) });
  db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job','proactive_response','completed','2026-07-20')").run();
  db.prepare("INSERT INTO deliveries (id,job_id,channel,text,reason_code,created_at) VALUES ('delivery','job','bark','keep','FOLLOW_UP','2026-07-20')").run();
  assert.deepEqual(applyMigrations(db), [13]);
  assert.equal(db.prepare("SELECT text FROM deliveries WHERE id='delivery'").get().text, "keep");
  const columns = db.prepare("PRAGMA table_info(delivery_feedback)").all().map(row => row.name);
  assert.deepEqual(columns, ["id", "delivery_id", "feedback_type", "created_at"]);
  const indexes = new Set(db.prepare("PRAGMA index_list(delivery_feedback)").all().map(row => row.name));
  assert.ok(indexes.has("idx_delivery_feedback_delivery")); assert.ok(indexes.has("idx_delivery_feedback_type"));
});

test("feedback creation is idempotent, immutable, validated, and emits one minimal Event", async t => {
  const f = await fixture(t);
  const delivery = f.deliveries.create({ jobId: "job-1", channel: "bark", text: "private message", reasonCode: "FOLLOW_UP", dedupeKey: "one" });
  const first = f.feedback.record({ deliveryId: delivery.id, feedbackType: "liked" });
  const again = f.feedback.record({ deliveryId: delivery.id, feedbackType: "liked" });
  assert.deepEqual(again, first);
  assert.deepEqual(f.feedback.getForDelivery(delivery.id), first);
  assert.equal(f.feedback.list({ feedbackType: "liked" }).meta.total, 1);
  assert.throws(() => f.feedback.record({ deliveryId: delivery.id, feedbackType: "dismissed" }), error => error.code === "PROACTIVE_FEEDBACK_CONFLICT");
  assert.throws(() => f.feedback.record({ deliveryId: delivery.id, feedbackType: "custom" }), error => error.code === "PROACTIVE_FEEDBACK_INVALID");
  assert.throws(() => f.feedback.record({ deliveryId: "missing", feedbackType: "liked" }), error => error.code === "DELIVERY_NOT_FOUND");
  assert.throws(() => f.feedback.record({ deliveryId: delivery.id, feedbackType: "liked", comment: "no" }));
  const events = f.events.list({ eventType: "proactive.feedback_received" }).items;
  assert.equal(events.length, 1);
  assert.equal(events[0].category, "proactive");
  assert.deepEqual(events[0].payload, { deliveryId: delivery.id, feedbackType: "liked" });
  assert.doesNotMatch(JSON.stringify(events[0].payload), /private message|text|comment|mood|personality/i);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
});

test("disable_future alone projects proactive enabled=false without Memory or relationship mutation", async t => {
  const f = await fixture(t);
  const delivery = f.deliveries.create({ jobId: "job-1", channel: "bark", text: "private", reasonCode: "FOLLOW_UP", dedupeKey: "disable" });
  f.feedback.record({ deliveryId: delivery.id, feedbackType: "disable_future" });
  const state = f.states.get("companion", "default", "proactive_contact.enabled");
  assert.equal(state.value, false); assert.equal(state.sourceKind, "event");
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM companion_state").get().n), 1);
  assert.equal(Number(f.db.prepare("SELECT COUNT(*) n FROM memory_items").get().n), 0);
});

test("HTTP accepts only whitelisted feedback and Overview returns aggregate counts", async t => {
  const f = await fixture(t);
  const liked = f.deliveries.create({ jobId: "job-1", channel: "bark", text: "one", reasonCode: "ONE", dedupeKey: "liked" });
  const dismissed = f.deliveries.create({ jobId: "job-1", channel: "bark", text: "two", reasonCode: "TWO", dedupeKey: "dismissed" });
  const view = new ProactiveView({ deliveryStore: f.deliveries, stateStore: f.states,
    relationshipView: { get: () => ({}) }, eventStore: f.events, feedbackStore: f.feedback });
  const app = Fastify({ logger: false });
  registerProactiveDeliveryRoutes(app, { deliveryStore: f.deliveries, settings: { getSettings() {}, updateSettings() {} },
    proactiveView: view, feedbackStore: f.feedback, apiKey: "feedback-token" });
  await app.ready(); t.after(() => app.close());
  const url = id => `/api/v1/proactive/deliveries/${id}/feedback`;
  assert.equal((await app.inject({ method: "POST", url: url(liked.id), payload: { feedbackType: "liked" } })).statusCode, 401);
  const headers = { authorization: "Bearer feedback-token" };
  assert.equal((await app.inject({ method: "POST", url: url(liked.id), headers, payload: { feedbackType: "liked" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: url(dismissed.id), headers, payload: { feedbackType: "dismissed" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: url(liked.id), headers, payload: { feedbackType: "anything" } })).statusCode, 400);
  const overview = await app.inject({ method: "GET", url: "/api/v1/proactive/overview", headers });
  assert.deepEqual(overview.json().feedbackSummary, { liked: 1, dismissed: 1 });
  assert.doesNotMatch(JSON.stringify(overview.json().feedbackSummary), /delivery|text|user/i);
});

test("feedback path has no model, Bark, Memory, personality, or policy mutation dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-feedback-store.js"), "utf8");
  assert.doesNotMatch(source, /model|Bark|memoryStore|behavior-policy|relationship|personality|mood|fetch\(/i);
});
