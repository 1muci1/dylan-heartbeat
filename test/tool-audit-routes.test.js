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
const { EventStore } = require("../event-store");
const { ToolAuditStore } = require("../tool-audit-store");
const { registerToolAuditRoutes } = require("../tool-audit-routes");
const { createMemoryMcpRuntime, readMemoryMcpConfig } = require("../memory-mcp-server");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tool-audit-routes-"));
  const connection = openDatabase(path.join(dir, "db.sqlite"));
  let tick = 0, id = 0;
  const events = new EventStore({ database: connection.db,
    clock: () => new Date(`2026-07-20T12:0${tick++}:00Z`), idFactory: () => `event-${++id}` });
  const audit = new ToolAuditStore({ eventStore: events });
  const app = Fastify({ logger: false });
  registerToolAuditRoutes(app, { eventStore: events, apiKey: "audit-token" });
  await app.ready();
  t.after(async () => { await app.close(); connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { app, audit, db: connection.db, events };
}

const auth = { authorization: "Bearer audit-token" };

test("HTTP Tool Audit requires authentication and returns only its field whitelist", async t => {
  const f = await fixture(t);
  f.audit.recordRequested({ toolName: "fake.action.run", approvalStatus: "pending" });
  f.audit.recordFailed({ toolName: "fake.action.run", errorCode: "SAFE_FAILURE" });
  assert.equal((await f.app.inject({ method: "GET", url: "/api/v1/tools/audit" })).statusCode, 401);
  const response = await f.app.inject({ method: "GET", url: "/api/v1/tools/audit", headers: auth });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 2);
  assert.deepEqual(Object.keys(response.json().items[0]), ["eventType", "toolName", "approvalStatus", "success", "errorCode", "createdAt"]);
  assert.deepEqual(response.json().items[0], {
    eventType: "tool.failed", toolName: "fake.action.run", approvalStatus: null,
    success: false, errorCode: "SAFE_FAILURE", createdAt: "2026-07-20T12:01:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(response.json()), /input|output|hash|token|stack|file|message|content/i);
});

test("HTTP filters limit, toolName, eventType, and time through EventStore without database mutation", async t => {
  const f = await fixture(t);
  f.audit.recordRequested({ toolName: "fake.one.run", approvalStatus: "pending" });
  f.audit.recordCompleted({ toolName: "fake.one.run" });
  f.audit.recordFailed({ toolName: "fake.two.run", errorCode: "SAFE_FAILURE" });
  const before = f.db.prepare("SELECT total_changes() n").get().n;
  const response = await f.app.inject({ method: "GET",
    url: "/api/v1/tools/audit?limit=1&toolName=fake.one.run&eventType=tool.completed&from=2026-07-20T12:00:30Z&to=2026-07-20T12:02:00Z",
    headers: auth });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items.map(item => item.eventType), ["tool.completed"]);
  assert.equal(f.db.prepare("SELECT total_changes() n").get().n, before);
  for (const url of [
    "/api/v1/tools/audit?limit=101", "/api/v1/tools/audit?eventType=tool.unknown",
    "/api/v1/tools/audit?toolName=bad%20name", "/api/v1/tools/audit?from=bad",
    "/api/v1/tools/audit?from=2026-07-21T00:00:00Z&to=2026-07-20T00:00:00Z", "/api/v1/tools/audit?debug=true"
  ]) assert.equal((await f.app.inject({ method: "GET", url, headers: auth })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/v1/tools/audit", headers: auth })).statusCode, 404);
});

test("MCP discovers tool_audit_get with bounded schema and readonly annotations", async t => {
  const calls = [];
  const apiClient = { async toolAudit(input) { calls.push(input); return { items: [{
    eventType: "tool.failed", toolName: "fake.action.run", approvalStatus: null, success: false,
    errorCode: "SAFE_FAILURE", createdAt: "2026-07-20T12:00:00Z",
    input: "hidden", output: "hidden", hash: "hidden", token: "hidden", stack: "hidden", content: "hidden"
  }] }; } };
  const config = readMemoryMcpConfig({ MEMORY_API_BASE_URL: "http://127.0.0.1:3000", MEMORY_API_TOKEN: "mcp-token" });
  const runtime = createMemoryMcpRuntime({ config, apiClient, signalSource: new EventEmitter() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-audit-test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await runtime.close(); });
  const listed = await client.listTools();
  const tool = listed.tools.find(item => item.name === "tool_audit_get");
  assert.ok(tool);
  assert.equal(tool.inputSchema.properties.limit.maximum, 100);
  assert.deepEqual(tool.inputSchema.properties.eventType.enum, ["tool.requested", "tool.approved", "tool.completed", "tool.failed"]);
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const result = await client.callTool({ name: "tool_audit_get", arguments: { limit: 5, eventType: "tool.failed" } });
  assert.deepEqual(calls, [{ limit: 5, eventType: "tool.failed" }]);
  assert.deepEqual(result.structuredContent.items, [{
    eventType: "tool.failed", toolName: "fake.action.run", approvalStatus: null,
    success: false, errorCode: "SAFE_FAILURE", createdAt: "2026-07-20T12:00:00Z"
  }]);
  assert.doesNotMatch(JSON.stringify(result.structuredContent), /hidden|input|output|hash|token|stack|content/i);
});

test("Tool Audit route is EventStore-only and has no execution, model, mobile, direct DB, or write MCP dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-audit-routes.js"), "utf8");
  assert.doesNotMatch(source, /database|\.prepare\(|\.exec\(|executor|execute\(|model|mobile|device|MCP|fetch\(/i);
  assert.doesNotMatch(source, /app\.(post|put|patch|delete)\(/i);
});
