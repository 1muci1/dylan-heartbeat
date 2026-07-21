"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ToolRegistry } = require("../tool-registry");
const { ToolApprovalStore } = require("../tool-approval-store");
const { ToolExecutionGateway } = require("../tool-execution-gateway");

function tool(name, permissionLevel = "automatic") {
  return {
    name,
    description: "Fake Tool for Policy integration.",
    inputSchema: { type: "object", properties: { value: { type: "integer" } }, required: ["value"], additionalProperties: false },
    permissionLevel,
    executionType: "local"
  };
}

function gateway({ permission = "automatic", policy, approvalStore = null, executor } = {}) {
  return new ToolExecutionGateway({
    registry: new ToolRegistry({ definitions: [tool("fake.policy.run", permission)] }),
    policy,
    approvalStore,
    executor: executor || (async ({ input }) => ({ value: input.value }))
  });
}

test("Execution order is Registry lookup, input validation, Policy, then automatic fake executor", async () => {
  const order = [];
  const registry = new ToolRegistry({ definitions: [tool("fake.policy.run")] });
  const originalGet = registry.get.bind(registry);
  registry.get = name => { order.push("registry"); return originalGet(name); };
  const service = new ToolExecutionGateway({
    registry,
    policy(input) {
      order.push("policy");
      assert.deepEqual(input, { toolName: "fake.policy.run", permission: "automatic", riskLevel: "low", context: {} });
      return { allowed: true, decision: "automatic", reasonCode: "ALLOW" };
    },
    executor: async () => { order.push("executor"); return { done: true }; }
  });
  assert.deepEqual(await service.execute({ toolName: "fake.policy.run", input: { value: 1 } }),
    { success: true, toolName: "fake.policy.run", output: { done: true } });
  assert.deepEqual(order, ["registry", "policy", "executor"]);
});

test("Policy blocked decision stops executor with TOOL_POLICY_BLOCKED", async () => {
  let calls = 0;
  const service = gateway({ policy: () => ({ allowed: false, decision: "blocked", reasonCode: "HIGH_RISK" }), executor: async () => { calls++; } });
  await assert.rejects(service.execute({ toolName: "fake.policy.run", input: { value: 1 } }), error => error.code === "TOOL_POLICY_BLOCKED");
  assert.equal(calls, 0);
});

test("Policy user_confirm decision enters Approval Flow and approved request executes", async () => {
  let calls = 0;
  const approvals = new ToolApprovalStore({ clock: () => new Date("2026-07-20T12:00:00Z"), idFactory: () => "approval-policy" });
  const policy = () => ({ allowed: false, decision: "user_confirm", reasonCode: "CONFIRM" });
  const service = gateway({ policy, approvalStore: approvals, executor: async () => { calls++; return { done: true }; } });
  const pending = await service.execute({ toolName: "fake.policy.run", input: { value: 1 } });
  assert.equal(pending.errorCode, "TOOL_APPROVAL_REQUIRED");
  assert.equal(pending.approval.id, "approval-policy");
  assert.equal(calls, 0);
  approvals.approve(pending.approval.id);
  assert.equal((await service.execute({ toolName: "fake.policy.run", input: { value: 1 }, approvalId: pending.approval.id })).success, true);
  assert.equal(calls, 1);
});

test("confirmation without Approval Store fails closed with TOOL_POLICY_CONFIRM_REQUIRED", async () => {
  let calls = 0;
  const service = gateway({ policy: () => ({ allowed: false, decision: "user_confirm", reasonCode: "CONFIRM" }), executor: async () => { calls++; } });
  await assert.rejects(service.execute({ toolName: "fake.policy.run", input: { value: 1 } }), error => error.code === "TOOL_POLICY_CONFIRM_REQUIRED");
  assert.equal(calls, 0);
});

test("Policy errors and malformed decisions fail closed with TOOL_POLICY_UNAVAILABLE", async () => {
  const policies = [
    () => { throw new Error("policy internal stack"); },
    async () => Promise.reject(new Error("unavailable")),
    () => null,
    () => ({ allowed: true, decision: "unknown", reasonCode: "BAD" }),
    () => ({ allowed: true, decision: "automatic", reasonCode: "" }),
    () => ({ allowed: false, decision: "automatic", reasonCode: "CONTRADICTION" })
  ];
  for (const policy of policies) {
    let calls = 0;
    const service = gateway({ policy, executor: async () => { calls++; } });
    await assert.rejects(service.execute({ toolName: "fake.policy.run", input: { value: 1 } }), error => error.code === "TOOL_POLICY_UNAVAILABLE");
    assert.equal(calls, 0);
  }
});

test("injected Policy cannot weaken Registry user_confirm or blocked permission", async () => {
  const allow = () => ({ allowed: true, decision: "automatic", reasonCode: "ALLOW" });
  const approvals = new ToolApprovalStore({ idFactory: () => "approval-registry" });
  const confirmService = gateway({ permission: "user_confirm", policy: allow, approvalStore: approvals });
  assert.equal((await confirmService.execute({ toolName: "fake.policy.run", input: { value: 1 } })).errorCode, "TOOL_APPROVAL_REQUIRED");
  const blockedService = gateway({ permission: "blocked", policy: allow });
  await assert.rejects(blockedService.execute({ toolName: "fake.policy.run", input: { value: 1 } }), error => error.code === "TOOL_POLICY_BLOCKED");
});

test("default Policy preserves safe automatic/confirm/blocked behavior", async () => {
  assert.equal((await gateway().execute({ toolName: "fake.policy.run", input: { value: 1 } })).success, true);
  const approvals = new ToolApprovalStore({ idFactory: () => "approval-default" });
  assert.equal((await gateway({ permission: "user_confirm", approvalStore: approvals }).execute({ toolName: "fake.policy.run", input: { value: 1 } })).errorCode, "TOOL_APPROVAL_REQUIRED");
  await assert.rejects(gateway({ permission: "blocked" }).execute({ toolName: "fake.policy.run", input: { value: 1 } }), error => error.code === "TOOL_POLICY_BLOCKED");
});

test("Policy integration has no real Tool, phone, model, network, or migration dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-execution-gateway.js"), "utf8");
  assert.doesNotMatch(source, /fetch\(|https?:|model|mobile|phone|device bridge|migration/i);
});
