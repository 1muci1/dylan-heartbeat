"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ToolRegistry } = require("../tool-registry");
const { ToolExecutionGateway } = require("../tool-execution-gateway");
const { ToolApprovalStore } = require("../tool-approval-store");

function definition(overrides = {}) {
  return {
    name: "fake.math.add",
    description: "Add two fake numbers.",
    inputSchema: {
      type: "object",
      properties: {
        left: { type: "integer", minimum: 0, maximum: 100 },
        right: { type: "integer", minimum: 0, maximum: 100 },
        mode: { type: "string", enum: ["safe"] }
      },
      required: ["left", "right"],
      additionalProperties: false
    },
    permissionLevel: "automatic",
    executionType: "local",
    ...overrides
  };
}

function registry(...definitions) {
  return new ToolRegistry({ definitions });
}

test("Gateway validates request, resolves Registry Tool, calls fake executor, and returns unified output", async () => {
  const calls = [];
  const gateway = new ToolExecutionGateway({
    registry: registry(definition()),
    executor: async request => {
      calls.push(request);
      return { total: request.input.left + request.input.right };
    }
  });
  const result = await gateway.execute({ toolName: "fake.math.add", input: { left: 2, right: 3, mode: "safe" } });
  assert.deepEqual(result, { success: true, toolName: "fake.math.add", output: { total: 5 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool.name, "fake.math.add");
  assert.deepEqual(calls[0].input, { left: 2, right: 3, mode: "safe" });
});

test("missing and malformed Tool names return TOOL_NOT_FOUND without executor calls", async () => {
  let calls = 0;
  const gateway = new ToolExecutionGateway({ registry: registry(), executor: async () => { calls++; } });
  await assert.rejects(gateway.execute({ toolName: "fake.missing.get", input: {} }), error => error.code === "TOOL_NOT_FOUND");
  await assert.rejects(gateway.execute({ toolName: "bad name", input: {} }), error => error.code === "TOOL_NOT_FOUND");
  assert.equal(calls, 0);
});

test("user_confirm Tool creates approval requirement and executes only after matching approval", async () => {
  let calls = 0;
  const approvals = new ToolApprovalStore({ clock: () => new Date("2026-07-20T12:00:00Z"), idFactory: () => "approval-1" });
  const gateway = new ToolExecutionGateway({
    registry: registry(definition({ name: "fake.permission.confirm", permissionLevel: "user_confirm" })),
    approvalStore: approvals,
    executor: async ({ input }) => { calls++; return { total: input.left + input.right }; }
  });
  const required = await gateway.execute({ toolName: "fake.permission.confirm", input: { left: 1, right: 2 } });
  assert.equal(required.errorCode, "TOOL_APPROVAL_REQUIRED");
  assert.deepEqual(required.approval, {
    id: "approval-1", toolName: "fake.permission.confirm", riskLevel: "medium",
    reasonCode: "TOOL_USER_CONFIRM_REQUIRED", summary: "Add two fake numbers.",
    inputHash: required.approval.inputHash, expiresAt: "2026-07-20T12:05:00.000Z"
  });
  assert.equal(calls, 0);
  assert.deepEqual(await gateway.execute({ toolName: "fake.permission.confirm", input: { right: 2, left: 1 }, approvalId: "approval-1" }), required);
  approvals.approve("approval-1");
  const result = await gateway.execute({ toolName: "fake.permission.confirm", input: { right: 2, left: 1 }, approvalId: "approval-1" });
  assert.deepEqual(result, { success: true, toolName: "fake.permission.confirm", output: { total: 3 } });
  assert.equal(calls, 1);
});

test("approval cannot be reused for a different Tool/input and rejected or expired approvals are denied", async () => {
  let now = new Date("2026-07-20T12:00:00Z"), id = 0, calls = 0;
  const approvals = new ToolApprovalStore({ clock: () => new Date(now), idFactory: () => `approval-${++id}`, ttlMs: 1000 });
  const gateway = new ToolExecutionGateway({
    registry: registry(
      definition({ name: "fake.permission.one", permissionLevel: "user_confirm" }),
      definition({ name: "fake.permission.two", permissionLevel: "user_confirm" })
    ), approvalStore: approvals, executor: async () => { calls++; }
  });
  const one = await gateway.execute({ toolName: "fake.permission.one", input: { left: 1, right: 1 } });
  approvals.approve(one.approval.id);
  await assert.rejects(gateway.execute({ toolName: "fake.permission.one", input: { left: 2, right: 1 }, approvalId: one.approval.id }), error => error.code === "TOOL_PERMISSION_DENIED");
  await assert.rejects(gateway.execute({ toolName: "fake.permission.two", input: { left: 1, right: 1 }, approvalId: one.approval.id }), error => error.code === "TOOL_PERMISSION_DENIED");
  const rejected = await gateway.execute({ toolName: "fake.permission.one", input: { left: 3, right: 1 } });
  approvals.reject(rejected.approval.id);
  await assert.rejects(gateway.execute({ toolName: "fake.permission.one", input: { left: 3, right: 1 }, approvalId: rejected.approval.id }), error => error.code === "TOOL_PERMISSION_DENIED");
  const expired = await gateway.execute({ toolName: "fake.permission.two", input: { left: 4, right: 1 } });
  now = new Date("2026-07-20T12:00:01Z");
  await assert.rejects(gateway.execute({ toolName: "fake.permission.two", input: { left: 4, right: 1 }, approvalId: expired.approval.id }), error => error.code === "TOOL_PERMISSION_DENIED");
  assert.equal(calls, 0);
});

test("blocked Tools remain denied by Policy", async () => {
  let calls = 0;
  const gateway = new ToolExecutionGateway({
    registry: registry(definition({ name: "fake.permission.blocked", permissionLevel: "blocked" })),
    executor: async () => { calls++; }
  });
  await assert.rejects(gateway.execute({ toolName: "fake.permission.blocked", input: { left: 1, right: 1 } }), error => error.code === "TOOL_POLICY_BLOCKED");
  assert.equal(calls, 0);
});

test("input schema rejects missing, unknown, wrong-type, range, enum, and request fields", async () => {
  let calls = 0;
  const gateway = new ToolExecutionGateway({ registry: registry(definition()), executor: async () => { calls++; } });
  const invalid = [
    { toolName: "fake.math.add", input: { left: 1 } },
    { toolName: "fake.math.add", input: { left: 1, right: 2, unknown: true } },
    { toolName: "fake.math.add", input: { left: "1", right: 2 } },
    { toolName: "fake.math.add", input: { left: -1, right: 2 } },
    { toolName: "fake.math.add", input: { left: 1, right: 101 } },
    { toolName: "fake.math.add", input: { left: 1, right: 2, mode: "unsafe" } },
    { toolName: "fake.math.add", input: { left: 1, right: 2 }, debug: true },
    { toolName: "fake.math.add" },
    null
  ];
  for (const request of invalid) {
    await assert.rejects(gateway.execute(request), error => error.code === "TOOL_INPUT_INVALID");
  }
  assert.equal(calls, 0);
});

test("nested object, arrays, strings, booleans, and numbers use bounded fake schema validation", async () => {
  const tool = definition({
    name: "fake.schema.check",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", minLength: 2, maxLength: 5, pattern: "^[a-z]+$" },
        active: { type: "boolean" },
        ratio: { type: "number", minimum: 0, maximum: 1 },
        tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", maxLength: 3 } },
        config: { type: "object", properties: { mode: { type: "string", enum: ["a"] } }, required: ["mode"], additionalProperties: false }
      },
      required: ["label", "active", "ratio", "tags", "config"],
      additionalProperties: false
    }
  });
  const gateway = new ToolExecutionGateway({ registry: registry(tool), executor: { async execute({ input }) { return input; } } });
  const input = { label: "abc", active: true, ratio: 0.5, tags: ["one"], config: { mode: "a" } };
  assert.deepEqual((await gateway.execute({ toolName: tool.name, input })).output, input);
  await assert.rejects(gateway.execute({ toolName: tool.name, input: { ...input, tags: [] } }), error => error.code === "TOOL_INPUT_INVALID");
});

test("fake executor errors are sanitized as TOOL_EXECUTION_FAILED", async () => {
  const secret = "provider secret stack";
  const gateway = new ToolExecutionGateway({
    registry: registry(definition()),
    executor: async () => { throw Object.assign(new Error(secret), { stack: secret, response: secret }); }
  });
  await assert.rejects(gateway.execute({ toolName: "fake.math.add", input: { left: 1, right: 2 } }), error => {
    assert.equal(error.code, "TOOL_EXECUTION_FAILED");
    assert.equal(error.message, "Tool 执行失败");
    assert.doesNotMatch(error.message, /provider|secret|stack/i);
    return true;
  });
});

test("Gateway has no logging, network, model, mobile, MCP, Event, or migration dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-execution-gateway.js"), "utf8");
  assert.doesNotMatch(source, /console\.|logger|\.log\(|fetch\(|https?:|require\([^)]*(model|mcp|device|bark|database|event-store)/i);
  assert.doesNotMatch(source, /stack|migration|mobile|EventStore/i);
});
