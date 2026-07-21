"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { approvalRequestFromRecord, createToolApprovalRequest } = require("../tool-approval-request");
const { ToolApprovalStore } = require("../tool-approval-store");
const { ToolExecutionGateway } = require("../tool-execution-gateway");
const { ToolRegistry } = require("../tool-registry");

const HASH = "a".repeat(64);

function request(overrides = {}) {
  return {
    id: "approval-1", toolName: "fake.action.run", riskLevel: "medium",
    reasonCode: "TOOL_USER_CONFIRM_REQUIRED", summary: "Run a safe fake action.",
    inputHash: HASH, expiresAt: "2026-07-20T12:05:00Z", ...overrides
  };
}

test("Approval Request contains exactly seven safe, normalized fields", () => {
  const result = createToolApprovalRequest(request());
  assert.deepEqual(result, { ...request(), expiresAt: "2026-07-20T12:05:00.000Z" });
  assert.deepEqual(Object.keys(result), ["id", "toolName", "riskLevel", "reasonCode", "summary", "inputHash", "expiresAt"]);
  assert.ok(Object.isFrozen(result));
});

test("Approval Request rejects missing, unknown, malformed, and sensitive fields", () => {
  const invalid = [
    null,
    { ...request(), riskLevel: "critical" },
    { ...request(), reasonCode: "raw reason" },
    { ...request(), inputHash: "raw input" },
    { ...request(), expiresAt: "invalid" },
    { ...request(), summary: "" },
    { ...request(), input: { secret: true } },
    { ...request(), output: "hidden" },
    { ...request(), token: "hidden" },
    { ...request(), stack: "hidden" }
  ];
  for (const value of invalid) assert.throws(() => createToolApprovalRequest(value));
});

test("Approval Store retains safe request metadata while lifecycle fields remain separate", () => {
  const store = new ToolApprovalStore({ clock: () => new Date("2026-07-20T12:00:00Z"), idFactory: () => "approval-1" });
  const record = store.create({ toolName: "fake.action.run", riskLevel: "medium", reasonCode: "CONFIRM_REQUIRED", summary: "Confirm fake action.", inputHash: HASH });
  assert.deepEqual(approvalRequestFromRecord(record), {
    id: "approval-1", toolName: "fake.action.run", riskLevel: "medium", reasonCode: "CONFIRM_REQUIRED",
    summary: "Confirm fake action.", inputHash: HASH, expiresAt: "2026-07-20T12:05:00.000Z"
  });
  assert.equal(record.status, "pending");
  assert.equal(record.createdAt, "2026-07-20T12:00:00.000Z");
});

test("Gateway returns safe Approval Request and approved request continues existing fake flow", async () => {
  const registry = new ToolRegistry({ definitions: [{
    name: "fake.action.run", description: "Run the approved fake action.",
    inputSchema: { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false },
    permissionLevel: "user_confirm", executionType: "local"
  }] });
  const approvals = new ToolApprovalStore({ clock: () => new Date("2026-07-20T12:00:00Z"), idFactory: () => "approval-1" });
  let calls = 0;
  const gateway = new ToolExecutionGateway({ registry, approvalStore: approvals, executor: async ({ input }) => { calls++; return { value: input.value }; } });
  const pending = await gateway.execute({ toolName: "fake.action.run", input: { value: 7 } });
  assert.deepEqual(Object.keys(pending), ["errorCode", "approval"]);
  assert.equal(pending.errorCode, "TOOL_APPROVAL_REQUIRED");
  assert.deepEqual(pending.approval, {
    id: "approval-1", toolName: "fake.action.run", riskLevel: "medium",
    reasonCode: "TOOL_USER_CONFIRM_REQUIRED", summary: "Run the approved fake action.",
    inputHash: pending.approval.inputHash, expiresAt: "2026-07-20T12:05:00.000Z"
  });
  assert.match(pending.approval.inputHash, /^[a-f0-9]{64}$/);
  assert.equal(calls, 0);
  approvals.approve(pending.approval.id);
  assert.deepEqual(await gateway.execute({ toolName: "fake.action.run", input: { value: 7 }, approvalId: pending.approval.id }),
    { success: true, toolName: "fake.action.run", output: { value: 7 } });
  assert.equal(calls, 1);
});

test("Approval Request layer has no input/output content, model, real Tool, mobile, migration, or Audit dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-approval-request.js"), "utf8");
  assert.doesNotMatch(source, /model|executor|mobile|phone|device|migration|audit|EventStore|fetch\(/i);
  assert.doesNotMatch(source, /inputJson|outputJson|fileContent|messageContent|token|stack/i);
});
