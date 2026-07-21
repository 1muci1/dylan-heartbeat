"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { EXECUTION_TYPES, PERMISSION_LEVELS, TOOL_DEFINITIONS } = require("../tool-definitions");
const { ToolRegistry, validateToolDefinition } = require("../tool-registry");

function fakeTool(overrides = {}) {
  return {
    name: "runtime.status.get",
    description: "Read a fake local runtime status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    permissionLevel: "automatic",
    executionType: "local",
    ...overrides
  };
}

test("registry registers, lists, and queries validated fake Tool metadata", () => {
  const registry = new ToolRegistry();
  const input = fakeTool();
  const before = structuredClone(input);
  const registered = registry.register(input);
  assert.deepEqual(input, before);
  assert.deepEqual(registered, input);
  assert.deepEqual(registry.get(input.name), input);
  assert.deepEqual(registry.list(), [input]);
  assert.equal(registry.get("runtime.missing.get"), null);
});

test("constructor accepts static definitions and rejects duplicate names", () => {
  const one = fakeTool();
  const two = fakeTool({ name: "device.reminder.create", permissionLevel: "user_confirm", executionType: "device_bridge" });
  const registry = new ToolRegistry({ definitions: [one, two] });
  assert.deepEqual(registry.list().map(item => item.name), [one.name, two.name]);
  assert.throws(() => registry.register(one), error => error.code === "TOOL_ALREADY_REGISTERED");
});

test("all supported permission levels are accepted and other values are rejected", () => {
  assert.deepEqual(PERMISSION_LEVELS, ["automatic", "user_confirm", "blocked"]);
  for (const permissionLevel of PERMISSION_LEVELS) {
    assert.equal(validateToolDefinition(fakeTool({ permissionLevel })).permissionLevel, permissionLevel);
  }
  for (const permissionLevel of ["allow", "admin", "write", "", null, true]) {
    assert.throws(() => validateToolDefinition(fakeTool({ permissionLevel })), error => error.code === "TOOL_PERMISSION_LEVEL_INVALID");
  }
});

test("Tool metadata is strict and JSON-safe", () => {
  const invalid = [
    fakeTool({ name: "Invalid Tool" }),
    fakeTool({ name: "single" }),
    fakeTool({ description: "" }),
    fakeTool({ executionType: "shell" }),
    fakeTool({ inputSchema: [] }),
    fakeTool({ inputSchema: { type: "string", additionalProperties: false } }),
    fakeTool({ inputSchema: { type: "object", additionalProperties: true } }),
    fakeTool({ inputSchema: { type: "object", additionalProperties: false, required: [1] } }),
    { ...fakeTool(), prompt: "forbidden" }
  ];
  for (const definition of invalid) assert.throws(() => validateToolDefinition(definition));
  assert.throws(() => validateToolDefinition(fakeTool({ inputSchema: {
    type: "object", properties: { value: { default: 1n } }, additionalProperties: false
  } })));
  assert.deepEqual(EXECUTION_TYPES, ["local", "device_bridge", "vps_relay"]);
});

test("returned metadata cannot mutate Registry state", () => {
  const registry = new ToolRegistry({ definitions: [fakeTool()] });
  const fetched = registry.get("runtime.status.get");
  fetched.description = "changed";
  fetched.inputSchema.properties.injected = { type: "string" };
  const listed = registry.list();
  listed.length = 0;
  assert.deepEqual(registry.get("runtime.status.get"), fakeTool());
  assert.equal(registry.list().length, 1);
});

test("default definitions are static and empty until tools are explicitly approved", () => {
  assert.ok(Object.isFrozen(TOOL_DEFINITIONS));
  assert.deepEqual(TOOL_DEFINITIONS, []);
  assert.deepEqual(new ToolRegistry().list(), []);
});

test("Registry layer has no execution, mobile, MCP, model, network, or database dependency", () => {
  const source = ["tool-registry.js", "tool-definitions.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /require\([^)]*(mcp|model|database|device|bark|http|https|net)/i);
  assert.doesNotMatch(source, /fetch\(|\.execute\(|\.send\(|EventStore|Migration/i);
});
