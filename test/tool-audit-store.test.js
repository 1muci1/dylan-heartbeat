"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { EventStore } = require("../event-store");
const { ToolAuditStore } = require("../tool-audit-store");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tool-audit-"));
  const connection = openDatabase(path.join(dir, "db.sqlite"));
  let id = 0;
  const events = new EventStore({ database: connection.db, clock: () => new Date("2026-07-20T12:00:00Z"), idFactory: () => `event-${++id}` });
  const audit = new ToolAuditStore({ eventStore: events });
  t.after(async () => { connection.db.close(); await fs.promises.rm(dir, { recursive: true, force: true }); });
  return { audit, db: connection.db, events };
}

test("Tool Audit records requested, approved, completed, and failed facts through EventStore", async t => {
  const f = await fixture(t);
  f.audit.recordRequested({ toolName: "fake.action.run", approvalStatus: "pending" });
  f.audit.recordApproved({ toolName: "fake.action.run" });
  f.audit.recordCompleted({ toolName: "fake.action.run" });
  f.audit.recordFailed({ toolName: "fake.other.run", errorCode: "TOOL_EXECUTION_FAILED" });
  const events = f.events.list({ category: "tool", sort: "oldest", limit: 20 }).items;
  assert.deepEqual(events.map(event => ({ type: event.eventType, category: event.category, source: event.source, payload: event.payload })), [
    { type: "tool.requested", category: "tool", source: "tool-audit-store", payload: { toolName: "fake.action.run", approvalStatus: "pending" } },
    { type: "tool.approved", category: "tool", source: "tool-audit-store", payload: { toolName: "fake.action.run", approvalStatus: "approved" } },
    { type: "tool.completed", category: "tool", source: "tool-audit-store", payload: { toolName: "fake.action.run", success: true } },
    { type: "tool.failed", category: "tool", source: "tool-audit-store", payload: { toolName: "fake.other.run", success: false, errorCode: "TOOL_EXECUTION_FAILED" } }
  ]);
  assert.ok(events.every(event => event.subjectType === "tool" && event.subjectId === event.payload.toolName));
});

test("requested approval status is optional and only known lifecycle values are accepted", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.audit.recordRequested({ toolName: "fake.action.run" }).payload, { toolName: "fake.action.run" });
  for (const status of ["pending", "approved", "rejected", "expired"]) {
    assert.equal(f.audit.recordRequested({ toolName: `fake.status.${status}`, approvalStatus: status }).payload.approvalStatus, status);
  }
  assert.throws(() => f.audit.recordRequested({ toolName: "fake.action.run", approvalStatus: "unknown" }));
  assert.throws(() => f.audit.recordApproved({ toolName: "fake.action.run", approvalStatus: "rejected" }));
});

test("Audit input is strict and rejects sensitive or unbounded metadata before EventStore", async t => {
  const f = await fixture(t);
  const invalid = [
    () => f.audit.recordRequested({ toolName: "bad name" }),
    () => f.audit.recordRequested({ toolName: "fake.action.run", input: { secret: true } }),
    () => f.audit.recordCompleted({ toolName: "fake.action.run", output: "full result" }),
    () => f.audit.recordFailed({ toolName: "fake.action.run", errorCode: "raw failure message" }),
    () => f.audit.recordFailed({ toolName: "fake.action.run", errorCode: "TOOL_FAILED", stack: "hidden" }),
    () => f.audit.recordApproved({ toolName: "fake.action.run", token: "hidden" })
  ];
  for (const run of invalid) assert.throws(run);
  assert.equal(f.events.list({ category: "tool" }).meta.total, 0);
});

test("persisted Tool Event payload contains no input, output, content, token, or stack columns/data", async t => {
  const f = await fixture(t);
  f.audit.recordFailed({ toolName: "fake.action.run", errorCode: "SAFE_FAILURE" });
  const row = f.db.prepare("SELECT event_type,payload_json FROM events WHERE event_type='tool.failed'").get();
  assert.deepEqual(JSON.parse(row.payload_json), { toolName: "fake.action.run", success: false, errorCode: "SAFE_FAILURE" });
  assert.doesNotMatch(row.payload_json, /input|output|file|message|content|token|stack/i);
});

test("Tool Audit layer has no executor, model, mobile, MCP, network, or migration dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-audit-store.js"), "utf8");
  assert.doesNotMatch(source, /executor|model|mobile|device|MCP|fetch\(|https?:|migration/i);
  assert.doesNotMatch(source, /inputJson|outputJson|stack/);
});
