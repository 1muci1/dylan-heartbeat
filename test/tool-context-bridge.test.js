"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { CLASSIFICATIONS, bridgeToolContext } = require("../tool-context-bridge");

function input(overrides = {}) {
  return { toolName: "fake.context.get", result: { value: "safe" }, classification: "ephemeral", ...overrides };
}

test("ephemeral result enters only the current safe context", () => {
  assert.deepEqual(bridgeToolContext(input()), {
    allowed: true,
    context: {
      scope: "ephemeral",
      toolName: "fake.context.get",
      result: { data: { value: "safe" }, metadata: { truncated: false } }
    },
    reasonCode: "TOOL_CONTEXT_EPHEMERAL_ALLOWED"
  });
});

test("sensitive result is denied by default and cannot carry an inline approval bypass", () => {
  const sensitive = input({ classification: "sensitive", result: { token: "hidden", value: "private" } });
  assert.deepEqual(bridgeToolContext(sensitive), {
    allowed: false,
    context: null,
    reasonCode: "TOOL_CONTEXT_APPROVAL_REQUIRED"
  });
  assert.throws(() => bridgeToolContext({ ...sensitive, approved: true }), error => error.code === "TOOL_CONTEXT_INPUT_INVALID");
  assert.throws(() => bridgeToolContext({ ...sensitive, approvalId: "inline" }), error => error.code === "TOOL_CONTEXT_INPUT_INVALID");
});

test("persistent_candidate creates only a non-persisted candidate context", () => {
  assert.deepEqual(bridgeToolContext(input({ classification: "persistent_candidate", result: ["one", 2] })), {
    allowed: true,
    context: {
      scope: "persistent_candidate",
      candidate: {
        source: "tool",
        toolName: "fake.context.get",
        result: { data: ["one", 2], metadata: { truncated: false } }
      }
    },
    reasonCode: "TOOL_CONTEXT_CANDIDATE_CREATED"
  });
});

test("allowed classifications recursively normalize and bound Tool results without mutating input", () => {
  const value = input({ result: { safe: true, token: "hidden", nested: { password: "hidden", value: "x".repeat(20000) } } });
  const before = structuredClone(value);
  const output = bridgeToolContext(value);
  assert.deepEqual(value, before);
  assert.equal(output.context.result.metadata.truncated, true);
  assert.doesNotMatch(JSON.stringify(output), /hidden|token|password/i);
  assert.ok(Buffer.byteLength(JSON.stringify(output.context.result), "utf8") <= 10 * 1024);
});

test("Bridge strictly validates input and maps unsafe results to a stable error", () => {
  const invalid = [null, {}, input({ classification: "public" }), { ...input(), debug: true }];
  for (const value of invalid) assert.throws(() => bridgeToolContext(value), error => error.code === "TOOL_CONTEXT_INPUT_INVALID");
  assert.throws(() => bridgeToolContext(input({ result: () => true })), error => error.code === "TOOL_CONTEXT_INPUT_INVALID");
  assert.deepEqual([...CLASSIFICATIONS], ["ephemeral", "sensitive", "persistent_candidate"]);
});

test("Bridge is pure and has no Event, State, Memory write, model, database, network, phone, or migration dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-context-bridge.js"), "utf8");
  assert.doesNotMatch(source, /EventStore|StateStore|memoryStore|model|database|fetch\(|https?:|mobile|phone|device|migration/i);
  assert.doesNotMatch(source, /\.create\(|\.set\(|\.execute\(|\.write\(/i);
});
