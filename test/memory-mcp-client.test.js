"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ReadBuffer, serializeMessage } = require("@modelcontextprotocol/sdk/shared/stdio.js");
const { createMemoryMcpRuntime, readMemoryMcpConfig } = require("../memory-mcp-server");

class LocalStdioClientTransport {
  constructor(serverInput, serverOutput) {
    this.serverInput = serverInput;
    this.serverOutput = serverOutput;
    this.buffer = new ReadBuffer();
    this.onData = chunk => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) this.onmessage?.(message);
    };
  }

  async start() {
    this.serverOutput.on("data", this.onData);
  }

  async send(message) {
    this.serverInput.write(serializeMessage(message));
  }

  async close() {
    this.serverOutput.off("data", this.onData);
    this.buffer.clear();
    this.onclose?.();
  }
}

test("local MCP client discovers tools and calls memory_search over stdio", async t => {
  const token = "local-mcp-integration-secret";
  const rawProtocolOutput = [];
  const fetch = async (url, options) => {
    const requestUrl = new URL(url);
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(requestUrl.pathname, "/api/v1/memories");
    assert.equal(requestUrl.searchParams.get("keyword"), "rain");
    assert.equal(requestUrl.searchParams.get("status"), "active");
    assert.equal(requestUrl.searchParams.get("limit"), "10");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return { ok: true, status: 200, json: async () => ({ data: [], meta: {}, error: null }) };
  };
  const serverInput = new PassThrough();
  const serverOutput = new PassThrough();
  serverOutput.on("data", chunk => rawProtocolOutput.push(chunk.toString()));
  const serverTransport = new StdioServerTransport(serverInput, serverOutput);
  const runtime = createMemoryMcpRuntime({
    config: readMemoryMcpConfig({ MEMORY_API_BASE_URL: "http://mock.memory.invalid", MEMORY_API_TOKEN: token }),
    fetch,
    transport: serverTransport,
    signalSource: new EventEmitter()
  });
  const clientTransport = new LocalStdioClientTransport(serverInput, serverOutput);
  const client = new Client({ name: "local-memory-mcp-client", version: "1.0.0" });
  await Promise.all([runtime.start(), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await runtime.close(); });

  const discovered = await client.listTools();
  assert.deepEqual(discovered.tools.map(tool => tool.name), [
    "memory_search", "memory_get", "memory_list", "memory_stats", "companion_state_get", "relationship_view_get", "proactive_overview_get", "proactive_explanation_get", "tool_audit_get"
  ]);
  const search = discovered.tools.find(tool => tool.name === "memory_search");
  assert.match(search.description, /Search active long-term Memory by keyword/);
  assert.deepEqual(search.inputSchema.required, ["query"]);
  assert.equal(search.inputSchema.properties.query.type, "string");
  assert.equal(search.inputSchema.properties.limit.maximum, 20);
  assert.equal(search.inputSchema.properties.status.default, "active");

  const result = await client.callTool({ name: "memory_search", arguments: { query: "rain" } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { items: [], meta: {} });
  assert.deepEqual(JSON.parse(result.content[0].text), { items: [], meta: {} });
  const raw = rawProtocolOutput.join("");
  for (const line of raw.split("\n").filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  assert.doesNotMatch(JSON.stringify(discovered), new RegExp(token));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
  assert.doesNotMatch(raw, new RegExp(token));
});
