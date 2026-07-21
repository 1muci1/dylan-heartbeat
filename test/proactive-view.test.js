"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { openDatabase } = require("../database");
const { DeliveryStore } = require("../delivery-store");
const { EventStore } = require("../event-store");
const { StateStore } = require("../state-store");
const { ProactiveView } = require("../proactive-view");
const { registerProactiveDeliveryRoutes } = require("../proactive-delivery-routes");
const { createMemoryMcpRuntime, readMemoryMcpConfig } = require("../memory-mcp-server");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proactive-view-"));
  const connection = openDatabase(path.join(dir, "db.sqlite"));
  connection.db.prepare("INSERT INTO ai_jobs (id,job_type,status,created_at) VALUES ('job-1','proactive_response','completed','2026-07-20T00:00:00Z')").run();
  let hour = 0;
  const deliveries = new DeliveryStore({ database: connection.db, clock: () => new Date(`2026-07-20T${String(++hour).padStart(2, "0")}:00:00Z`) });
  const states = new StateStore({ database: connection.db });
  const events = new EventStore({ database: connection.db });
  const relationshipView = { calls: 0, get() { this.calls++; return { proactiveContact: { enabled: true, quietHours: { start: "23:00", end: "08:00" } } }; } };
  const view = new ProactiveView({ deliveryStore: deliveries, stateStore: states, relationshipView, eventStore: events });
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { db: connection.db, deliveries, states, events, relationshipView, view };
}

test("empty overview is bounded, safe, and reads all four sources", async t => {
  const calls = [];
  const view = new ProactiveView({
    deliveryStore: { list(query) { calls.push(query); return { items: [], meta: { total: 0 } }; } },
    stateStore: { list(type, id) { calls.push({ type, id }); return []; } },
    relationshipView: { get() { calls.push("relationship"); return {}; } },
    eventStore: { list(query) { calls.push({ events: query }); return { items: [], meta: { total: 0 } }; } }
  });
  assert.deepEqual(view.getOverview(), {
    enabled: true, quietHours: { start: "23:00", end: "08:00" }, recentDeliveries: [],
    pendingCount: 0, failedCount: 0, lastContactAt: null, lastReasonCode: null, feedbackSummary: {}
  });
  assert.deepEqual(calls.slice(0, 3), [
    { page: 1, limit: 5, sort: "newest" },
    { page: 1, limit: 1, status: "pending" },
    { page: 1, limit: 1, status: "failed" }
  ]);
});

test("overview aggregates Delivery, State, Relationship, and allowed Event timeline without database writes", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 7; i++) f.deliveries.create({ jobId: "job-1", channel: "bark", text: `secret-${i}`, reasonCode: `REASON_${i}`, dedupeKey: `d-${i}` });
  const claimed = f.deliveries.claimPending(2);
  f.deliveries.markSent(claimed[0].id);
  f.deliveries.markFailed(claimed[1].id, "PRIVATE_PROVIDER_FAILURE");
  f.states.set({ scopeType: "companion", scopeId: "default", stateKey: "proactive_contact.enabled", value: false, sourceKind: "user" });
  f.states.set({ scopeType: "companion", scopeId: "default", stateKey: "proactive_contact.quiet_hours", value: { start: "22:00", end: "07:00" }, sourceKind: "user" });
  f.events.create({ eventType: "delivery.sent", subjectType: "delivery", subjectId: claimed[0].id,
    payload: { deliveryId: claimed[0].id }, occurredAt: "2026-07-20T18:00:00Z" }, { source: "proactive-delivery-worker" });
  f.events.create({ eventType: "delivery.failed", subjectType: "delivery", subjectId: claimed[1].id,
    payload: { deliveryId: claimed[1].id, reasonCode: "PUSH_FAILED" }, occurredAt: "2026-07-20T19:00:00Z" }, { source: "proactive-delivery-worker" });
  const before = f.db.prepare("SELECT total_changes() n").get().n;
  const result = f.view.getOverview();
  const after = f.db.prepare("SELECT total_changes() n").get().n;
  assert.equal(after, before);
  assert.equal(f.relationshipView.calls, 1);
  assert.equal(result.enabled, false);
  assert.deepEqual(result.quietHours, { start: "22:00", end: "07:00" });
  assert.equal(result.recentDeliveries.length, 5);
  assert.equal(result.pendingCount, 5); assert.equal(result.failedCount, 1);
  assert.equal(result.lastContactAt, "2026-07-20T18:00:00.000Z");
  assert.equal(result.lastReasonCode, "PUSH_FAILED");
  assert.deepEqual(Object.keys(result.recentDeliveries[0]), ["id", "channel", "status", "reasonCode", "createdAt", "sentAt"]);
  assert.doesNotMatch(JSON.stringify(result), /secret-|PRIVATE_PROVIDER_FAILURE|text|provider|token|stack|lock/i);
});

test("HTTP overview requires Bearer authentication and remains GET-only", async t => {
  const f = await fixture(t);
  const app = Fastify({ logger: false });
  registerProactiveDeliveryRoutes(app, {
    deliveryStore: f.deliveries,
    settings: { getSettings() {}, updateSettings() {} },
    proactiveView: f.view,
    apiKey: "overview-token"
  });
  await app.ready(); t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/proactive/overview" })).statusCode, 401);
  const response = await app.inject({ method: "GET", url: "/api/v1/proactive/overview", headers: { authorization: "Bearer overview-token" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().recentDeliveries, []);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/proactive/overview", headers: { authorization: "Bearer overview-token" } })).statusCode, 404);
});

test("MCP discovers proactive_overview_get with empty schema, readonly annotations, and filtered output", async t => {
  let calls = 0;
  const apiClient = { async proactiveOverview() { calls++; return {
    enabled: true, quietHours: { start: "23:00", end: "08:00", token: "hidden" },
    recentDeliveries: [{ id: "d1", channel: "bark", status: "failed", reasonCode: "PUSH_FAILED",
      createdAt: "2026-07-20T00:00:00Z", sentAt: null, text: "hidden", provider: "hidden" }],
    pendingCount: 2, failedCount: 1, lastContactAt: null, lastReasonCode: "PUSH_FAILED", stack: "hidden"
  }; } };
  const config = readMemoryMcpConfig({ MEMORY_API_BASE_URL: "http://127.0.0.1:3000", MEMORY_API_TOKEN: "mcp-token" });
  const runtime = createMemoryMcpRuntime({ config, apiClient, signalSource: new EventEmitter() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "proactive-view-test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await runtime.close(); });
  const listed = await client.listTools();
  const tool = listed.tools.find(item => item.name === "proactive_overview_get");
  assert.ok(tool); assert.deepEqual(tool.inputSchema.properties, {});
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.equal(listed.tools.some(item => /proactive_send|delivery_retry|delivery_cancel/.test(item.name)), false);
  const result = await client.callTool({ name: "proactive_overview_get", arguments: {} });
  assert.equal(calls, 1); assert.equal(result.structuredContent.recentDeliveries.length, 1);
  assert.doesNotMatch(JSON.stringify(result.structuredContent), /hidden|text|provider|token|stack/i);
});

test("Proactive View has no model, Bark sender, or mutation dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-view.js"), "utf8");
  assert.doesNotMatch(source, /model|Bark|fetch\(|\.create\(|\.set\(|markSent|markFailed|scheduleRetry|claimPending/i);
});
