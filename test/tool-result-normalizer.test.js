"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { MAX_OUTPUT_BYTES, normalizeToolResult } = require("../tool-result-normalizer");

function normalize(result) {
  return normalizeToolResult({ toolName: "fake.result.get", result });
}

test("normalizes supported JSON object, array, string, number, and boolean values", () => {
  for (const value of [
    { status: "ok", count: 2 },
    ["one", 2, true, null],
    "safe string",
    42,
    0.5,
    true,
    false
  ]) {
    assert.deepEqual(normalize(value), { success: true, data: value, metadata: { truncated: false } });
  }
});

test("recursively removes sensitive keys without modifying input", () => {
  const input = {
    safe: "visible", token: "hidden", apiKey: "hidden", nested: {
      Secret: "hidden", passwordHash: "hidden", credential: "hidden", safeAgain: true,
      values: [{ internalId: "hidden", name: "visible", debug: { raw: "hidden" } }]
    },
    STACK_TRACE: "hidden"
  };
  const before = structuredClone(input);
  const result = normalize(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result, {
    success: true,
    data: { safe: "visible", nested: { safeAgain: true, values: [{ name: "visible" }] } },
    metadata: { truncated: false }
  });
  assert.doesNotMatch(JSON.stringify(result), /hidden|token|secret|password|credential|apiKey|stack|debug|internal/i);
});

test("large UTF-8 strings are safely truncated within the complete 10KB envelope", () => {
  const result = normalize("心".repeat(10000));
  assert.equal(result.success, true);
  assert.equal(result.metadata.truncated, true);
  assert.ok(result.data.length > 0 && result.data.length < 10000);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_OUTPUT_BYTES);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
});

test("large arrays and objects retain only safe entries that fit 10KB", () => {
  const array = Array.from({ length: 500 }, (_, index) => ({ index, value: "x".repeat(100) }));
  const object = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`field${index}`, "y".repeat(100)]));
  for (const value of [array, object]) {
    const result = normalize(value);
    assert.equal(result.metadata.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_OUTPUT_BYTES);
    assert.ok(Array.isArray(value) ? result.data.length < value.length : Object.keys(result.data).length < Object.keys(value).length);
  }
});

test("depth and collection bounds truncate safely without mutating input", () => {
  const many = Array.from({ length: 1100 }, (_, index) => index);
  const result = normalize(many);
  assert.equal(result.metadata.truncated, true);
  assert.ok(result.data.length <= 1000);
  assert.equal(many.length, 1100);
  let deep = { value: true }, cursor = deep;
  for (let index = 0; index < 30; index++) { cursor.next = { value: true }; cursor = cursor.next; }
  const deepResult = normalize(deep);
  assert.equal(deepResult.metadata.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(deepResult), "utf8") <= MAX_OUTPUT_BYTES);
});

test("rejects unsupported, non-JSON, cyclic, and invalid top-level values", () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const result of [null, undefined, NaN, Infinity, 1n, Symbol("x"), () => true, new Date(), cyclic]) {
    assert.throws(() => normalize(result), error => error.code === "TOOL_RESULT_INVALID");
  }
  assert.throws(() => normalizeToolResult({ toolName: "bad name", result: true }));
});

test("Normalizer is pure and has no Event, Memory, model, database, network, phone, or migration dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-result-normalizer.js"), "utf8");
  assert.doesNotMatch(source, /EventStore|memory|model|database|fetch\(|https?:|mobile|phone|device|migration/i);
  assert.doesNotMatch(source, /\.create\(|\.set\(|\.execute\(/i);
});
