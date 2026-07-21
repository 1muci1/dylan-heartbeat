"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createMemoryMcpRuntime, readMemoryMcpConfig } = require("../memory-mcp-server");

const config = () => readMemoryMcpConfig({
  MEMORY_API_BASE_URL: "http://127.0.0.1:3000/",
  MEMORY_API_TOKEN: "state-mcp-token"
});

test("MCP discovers companion_state_get with a bounded read-only schema and safe output", async t => {
  const calls = [];
  const forbiddenModel = { calls: 0, async generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const apiClient = {
    async state(scope) {
      calls.push(scope);
      return { items: [{
        stateKey: "last_user_interaction_at",
        value: { timestamp: "2026-07-18T12:00:00Z" },
        valueType: "object",
        confidence: 1,
        sourceKind: "event",
        sourceEventId: "event-1",
        updatedAt: "2026-07-18T12:00:01Z",
        expiresAt: null,
        id: "hidden",
        version: 7,
        sourceMemoryId: "hidden"
      }] };
    }
  };
  const runtime = createMemoryMcpRuntime({ config: config(), apiClient, signalSource: new EventEmitter() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "state-mcp-test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await runtime.close(); });

  const listed = await client.listTools();
  const tool = listed.tools.find(item => item.name === "companion_state_get");
  assert.ok(tool);
  assert.equal(tool.inputSchema.properties.scope.default, "default");
  assert.deepEqual(tool.inputSchema.properties.scope.enum, ["default"]);
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });

  const result = await client.callTool({ name: "companion_state_get", arguments: {} });
  assert.deepEqual(calls, ["default"]);
  assert.deepEqual(result.structuredContent, {
    states: [{ key: "last_user_interaction_at", value: { timestamp: "2026-07-18T12:00:00Z" }, updatedAt: "2026-07-18T12:00:01Z" }]
  });
  assert.doesNotMatch(JSON.stringify(result), /hidden|sourceMemoryId|version|value_json/);
  const denied = await client.callTool({ name: "companion_state_get", arguments: { scope: "internal-test" } });
  assert.equal(denied.isError, true);
  assert.equal(forbiddenModel.calls, 0);
});
