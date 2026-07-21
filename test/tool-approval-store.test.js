"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { APPROVAL_STATUSES, ToolApprovalStore } = require("../tool-approval-store");

const hash = "a".repeat(64);

function fixture(options = {}) {
  let now = options.now || new Date("2026-07-20T12:00:00Z");
  let id = 0;
  const store = new ToolApprovalStore({ clock: () => new Date(now), idFactory: () => `approval-${++id}`, ttlMs: options.ttlMs || 60000 });
  return { store, setNow(value) { now = new Date(value); } };
}

test("Approval Store creates pending records and supports approved lifecycle", () => {
  const f = fixture();
  const pending = f.store.create({ toolName: "fake.confirm.run", inputHash: hash });
  assert.deepEqual(pending, {
    id: "approval-1", toolName: "fake.confirm.run", inputHash: hash,
    riskLevel: "medium", reasonCode: "TOOL_USER_CONFIRM_REQUIRED", summary: "Confirm execution of fake.confirm.run", status: "pending",
    createdAt: "2026-07-20T12:00:00.000Z", expiresAt: "2026-07-20T12:01:00.000Z", decidedAt: null
  });
  const approved = f.store.approve(pending.id);
  assert.equal(approved.status, "approved");
  assert.equal(approved.decidedAt, "2026-07-20T12:00:00.000Z");
  assert.deepEqual(f.store.approve(pending.id), approved);
});

test("pending Approval can be rejected or explicitly expired but terminal states cannot be overwritten", () => {
  const f = fixture();
  const rejected = f.store.reject(f.store.create({ toolName: "fake.confirm.one", inputHash: hash }).id);
  const expired = f.store.expire(f.store.create({ toolName: "fake.confirm.two", inputHash: "b".repeat(64) }).id);
  assert.equal(rejected.status, "rejected"); assert.equal(expired.status, "expired");
  assert.throws(() => f.store.approve(rejected.id), error => error.code === "TOOL_APPROVAL_STATE_INVALID");
  assert.throws(() => f.store.reject(expired.id), error => error.code === "TOOL_APPROVAL_STATE_INVALID");
});

test("pending and approved records expire by time and list filters all four statuses", () => {
  const f = fixture({ ttlMs: 1000 });
  const pending = f.store.create({ toolName: "fake.confirm.one", inputHash: hash });
  const approved = f.store.approve(f.store.create({ toolName: "fake.confirm.two", inputHash: "b".repeat(64) }).id);
  f.setNow("2026-07-20T12:00:01Z");
  assert.equal(f.store.get(pending.id).status, "expired");
  assert.equal(f.store.get(approved.id).status, "expired");
  assert.deepEqual(APPROVAL_STATUSES, ["pending", "approved", "rejected", "expired"]);
  assert.equal(f.store.list({ status: "expired" }).length, 2);
  assert.throws(() => f.store.list({ status: "unknown" }));
});

test("Approval metadata is strict and Store retains no Tool input or execution result", () => {
  const f = fixture();
  assert.throws(() => f.store.create({ toolName: "", inputHash: hash }));
  assert.throws(() => f.store.create({ toolName: "fake.confirm.run", inputHash: "raw input" }));
  assert.equal(f.store.get("missing"), null);
  assert.throws(() => f.store.approve("missing"), error => error.code === "TOOL_APPROVAL_NOT_FOUND");
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-approval-store.js"), "utf8");
  assert.doesNotMatch(source, /database|fetch\(|model|MCP|mobile|device bridge|executor|executionResult/i);
});
