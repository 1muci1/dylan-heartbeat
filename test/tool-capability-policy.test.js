"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PERMISSIONS, RISK_LEVELS, evaluateToolCapability } = require("../tool-capability-policy");

function input(overrides = {}) {
  return { toolName: "fake.action.run", permission: "automatic", riskLevel: "low", context: {}, ...overrides };
}

test("low-risk automatic Tool is allowed", () => {
  assert.deepEqual(evaluateToolCapability(input()), {
    allowed: true,
    decision: "automatic",
    reasonCode: "TOOL_AUTOMATIC_ALLOWED"
  });
});

test("medium risk always requires user confirmation", () => {
  for (const permission of ["automatic", "user_confirm"]) {
    assert.deepEqual(evaluateToolCapability(input({ permission, riskLevel: "medium" })), {
      allowed: false,
      decision: "user_confirm",
      reasonCode: "TOOL_USER_CONFIRM_REQUIRED"
    });
  }
});

test("high risk and blocked permission are always blocked", () => {
  for (const permission of PERMISSIONS) {
    assert.deepEqual(evaluateToolCapability(input({ permission, riskLevel: "high" })), {
      allowed: false,
      decision: "blocked",
      reasonCode: "TOOL_CAPABILITY_BLOCKED"
    });
  }
  for (const riskLevel of RISK_LEVELS) {
    assert.equal(evaluateToolCapability(input({ permission: "blocked", riskLevel })).decision, "blocked");
  }
});

test("user_confirm permission cannot be weakened by low risk", () => {
  assert.deepEqual(evaluateToolCapability(input({ permission: "user_confirm", riskLevel: "low" })), {
    allowed: false,
    decision: "user_confirm",
    reasonCode: "TOOL_USER_CONFIRM_REQUIRED"
  });
});

test("Policy validates exact metadata and supported values", () => {
  const invalid = [
    null,
    {},
    input({ toolName: "bad name" }),
    input({ permission: "allow" }),
    input({ riskLevel: "critical" }),
    input({ context: [] }),
    { ...input(), debug: true }
  ];
  for (const value of invalid) assert.throws(() => evaluateToolCapability(value), error => error.code === "TOOL_CAPABILITY_POLICY_INVALID");
  assert.deepEqual([...PERMISSIONS], ["automatic", "user_confirm", "blocked"]);
  assert.deepEqual([...RISK_LEVELS], ["low", "medium", "high"]);
});

test("Policy is deterministic, does not mutate input, and ignores context content", () => {
  const value = input({ context: { deviceOnline: false, arbitrary: { nested: true } } });
  const before = structuredClone(value);
  const first = evaluateToolCapability(value);
  const second = evaluateToolCapability(value);
  assert.deepEqual(value, before);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { allowed: true, decision: "automatic", reasonCode: "TOOL_AUTOMATIC_ALLOWED" });
});

test("Policy has no database, model, network, Tool execution, Registry mutation, phone, or migration dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-capability-policy.js"), "utf8");
  assert.doesNotMatch(source, /database|model|fetch\(|https?:|executor|execute\(|\.register\(|mobile|phone|device|MCP|migration/i);
  assert.doesNotMatch(source, /require\([^)]*(gateway|database|model|mcp|device)/i);
});
