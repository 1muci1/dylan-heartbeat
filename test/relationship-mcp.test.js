"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createMemoryMcpRuntime, readMemoryMcpConfig } = require("../memory-mcp-server");

test("MCP discovers relationship_view_get with an empty readonly schema and safe output", async t => {
  let calls = 0;
  const apiClient = { async relationship() { calls++; return {
    interactionStyle: { value: "concise", source: "memory", content: "hidden" },
    proactiveContact: { enabled: true, source: "state", token: "hidden" },
    familiarity: { level: 2, basis: "interaction_count", psychologicalLabel: "hidden" },
    recentTopics: ["Events"], importantMemoryIds: ["memory-1"], prompt: "hidden"
  }; } };
  const config = readMemoryMcpConfig({ MEMORY_API_BASE_URL: "http://127.0.0.1:3000", MEMORY_API_TOKEN: "relationship-mcp-token" });
  const runtime = createMemoryMcpRuntime({ config, apiClient, signalSource: new EventEmitter() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "relationship-mcp-test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await runtime.close(); });

  const listed = await client.listTools();
  const tool = listed.tools.find(item => item.name === "relationship_view_get");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.properties, {});
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const result = await client.callTool({ name: "relationship_view_get", arguments: {} });
  assert.equal(calls, 1);
  assert.deepEqual(result.structuredContent, {
    interactionStyle: { value: "concise", source: "memory" },
    proactiveContact: { enabled: true, source: "state" },
    familiarity: { level: 2, basis: "interaction_count" },
    recentTopics: ["Events"], importantMemoryIds: ["memory-1"]
  });
  assert.doesNotMatch(JSON.stringify(result.structuredContent), /hidden|token|prompt|psychologicalLabel/);
  assert.equal("content" in result.structuredContent.interactionStyle, false);
});
