"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { MemoryApiClient } = require("../memory-api-client");
const { createMemoryMcpRuntime, readMemoryMcpConfig, registerMemoryTools } = require("../memory-mcp-server");

const config = () => readMemoryMcpConfig({
  MEMORY_API_BASE_URL: "http://127.0.0.1:3000/",
  MEMORY_API_TOKEN: "test-memory-token"
});

test("Memory MCP runtime starts its transport and closes gracefully", async () => {
  const calls = [];
  const server = {
    registerTool() {},
    async connect(transport) { calls.push(["connect", transport]); },
    async close() { calls.push(["close"]); }
  };
  const transport = { name: "fake-stdio" };
  const signals = new EventEmitter();
  const runtime = createMemoryMcpRuntime({
    config: config(), server, transport, signalSource: signals,
    apiClient: { readOnly: true }
  });
  await runtime.start();
  assert.deepEqual(calls, [["connect", transport]]);
  signals.emit("SIGTERM");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [["connect", transport], ["close"]]);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("Memory MCP entry starts with stdio transport without polluting protocol output", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "memory-mcp-server.js")], {
    encoding: "utf8",
    env: {
      ...process.env,
      MEMORY_API_BASE_URL: "http://127.0.0.1:3000",
      MEMORY_API_TOKEN: "test-memory-token"
    },
    input: ""
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("Memory MCP configuration rejects missing or unsafe values", () => {
  assert.throws(() => readMemoryMcpConfig({}), /MEMORY_API_BASE_URL/);
  assert.throws(() => readMemoryMcpConfig({ MEMORY_API_BASE_URL: "http://localhost" }), /MEMORY_API_TOKEN/);
  assert.throws(() => readMemoryMcpConfig({ MEMORY_API_BASE_URL: "not-a-url", MEMORY_API_TOKEN: "x" }), /格式无效/);
  assert.throws(() => readMemoryMcpConfig({ MEMORY_API_BASE_URL: "file:///tmp/db", MEMORY_API_TOKEN: "x" }), /http 或 https/);
});

test("Memory API client only issues allowlisted GET requests", async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ data: [], meta: {}, error: null }) };
  };
  const client = new MemoryApiClient({ baseUrl: config().baseUrl, token: config().token, fetch });
  await client.list({ page: 1, keyword: "rain" });
  await client.get("memory-1");
  await client.stats();
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), [
    "/api/v1/memories", "/api/v1/memories/memory-1", "/api/v1/memories/stats"
  ]);
  assert.equal(requests.every(request => request.options.method === "GET"), true);
  assert.equal(requests.every(request => request.options.body === undefined), true);
  assert.equal(requests.every(request => request.options.headers.Authorization === "Bearer test-memory-token"), true);
  await assert.rejects(client.request("/api/v1/memories/memory-1/comments"), /路径不允许/);
  await assert.rejects(client.request("/admin/memory/export"), /路径不允许/);
});

function registeredTools(apiClient) {
  const tools = new Map();
  registerMemoryTools({ registerTool(name, definition, handler) { tools.set(name, { definition, handler }); } }, apiClient);
  return tools;
}

test("Memory MCP registers exactly four read-only tools", () => {
  const tools = registeredTools({});
  assert.deepEqual([...tools.keys()], ["memory_search", "memory_get", "memory_list", "memory_stats"]);
  for (const { definition } of tools.values()) {
    assert.deepEqual(definition.annotations, {
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
    });
  }
});

test("tool schemas enforce required arguments, enums, and limit 20", async t => {
  const apiClient = { list: async query => ({ data: [], meta: { query } }), get: async id => ({ data: { id }, meta: {} }), stats: async () => ({ data: {}, meta: {} }) };
  const runtime = createMemoryMcpRuntime({ config: config(), apiClient, signalSource: new EventEmitter() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "memory-mcp-test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await runtime.close(); });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), ["memory_search", "memory_get", "memory_list", "memory_stats"]);
  for (const args of [{}, { query: "rain", limit: 21 }, { query: "rain", type: "UNKNOWN" }]) {
    const result = await client.callTool({ name: "memory_search", arguments: args });
    assert.equal(result.isError, true);
  }
  const valid = await client.callTool({ name: "memory_search", arguments: { query: "rain" } });
  assert.equal(valid.isError, undefined);
  assert.equal(valid.structuredContent.meta.query.status, "active");
  assert.equal(valid.structuredContent.meta.query.limit, 10);
  assert.deepEqual(valid.structuredContent.items, []);
  const tooLarge = await client.callTool({ name: "memory_list", arguments: { limit: 21 } });
  assert.equal(tooLarge.isError, true);
});

test("four tools call the Memory API client with bounded read-only arguments", async () => {
  const calls = [];
  const apiClient = {
    async list(query) { calls.push(["list", query]); return { data: [{ id: "one" }], meta: { total: 1 } }; },
    async get(id) { calls.push(["get", id]); return { data: { id, status: "active", deletedAt: null }, meta: {} }; },
    async stats() { calls.push(["stats"]); return { data: { total: 1 }, meta: {} }; }
  };
  const tools = registeredTools(apiClient);
  const search = await tools.get("memory_search").handler({ query: "rain", type: "MOMENT", status: "active", limit: 20 });
  const get = await tools.get("memory_get").handler({ id: "one" });
  const list = await tools.get("memory_list").handler({ page: 2, limit: 20, type: "NOTE", sort: "updated" });
  const stats = await tools.get("memory_stats").handler({});
  assert.deepEqual(calls, [
    ["list", { keyword: "rain", type: "MOMENT", status: "active", limit: 20, page: 1 }],
    ["get", "one"],
    ["list", { page: 2, limit: 20, type: "NOTE", sort: "updated", status: "active" }],
    ["stats"]
  ]);
  for (const result of [search, get, list, stats]) {
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  }
});

test("tools use HTTP GET only and leave mocked Memory data unchanged", async () => {
  const memories = [{ id: "memory-1", type: "MEMORY", status: "active", content: "quiet rain" }];
  const before = JSON.stringify(memories);
  const methods = [];
  const fetch = async (url, options) => {
    methods.push(options.method);
    const pathname = new URL(url).pathname;
    const data = pathname.endsWith("/stats") ? { total: memories.length, byType: { MEMORY: 1 } }
      : pathname.endsWith("/memory-1") ? memories[0] : memories;
    return { ok: true, status: 200, json: async () => ({ data, meta: {}, error: null }) };
  };
  const client = new MemoryApiClient({ baseUrl: config().baseUrl, token: config().token, fetch });
  const tools = registeredTools(client);
  await tools.get("memory_search").handler({ query: "rain", status: "active", limit: 10 });
  await tools.get("memory_get").handler({ id: "memory-1" });
  await tools.get("memory_list").handler({ page: 1, limit: 20, sort: "newest" });
  await tools.get("memory_stats").handler({});
  assert.deepEqual(methods, ["GET", "GET", "GET", "GET"]);
  assert.equal(JSON.stringify(memories), before);
});

test("tools map API failures to stable errors without leaking credentials or stacks", async () => {
  const secret = "never-expose-memory-token";
  const failure = Object.assign(new Error(`upstream failed ${secret}`), { statusCode: 500, stack: `stack ${secret}` });
  const tools = registeredTools({ list: async () => { throw failure; }, get: async () => ({ data: { id: "x", status: "deleted" } }), stats: async () => { throw Object.assign(new Error(secret), { statusCode: 401 }); } });
  const upstream = await tools.get("memory_search").handler({ query: "x", status: "active", limit: 10 });
  const deleted = await tools.get("memory_get").handler({ id: "x" });
  const unauthorized = await tools.get("memory_stats").handler({});
  assert.equal(upstream.structuredContent.error.code, "UPSTREAM_ERROR");
  assert.equal(deleted.structuredContent.error.code, "MEMORY_NOT_FOUND");
  assert.equal(unauthorized.structuredContent.error.code, "UNAUTHORIZED");
  assert.doesNotMatch(JSON.stringify([upstream, deleted, unauthorized]), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify([upstream, deleted, unauthorized]), /stack/i);

  const notFoundTools = registeredTools({ get: async () => { throw Object.assign(new Error(secret), { statusCode: 404 }); } });
  const notFound = await notFoundTools.get("memory_get").handler({ id: "missing" });
  assert.deepEqual(notFound.structuredContent, { error: { code: "MEMORY_NOT_FOUND", message: "Memory 不存在" } });
});

test("Memory MCP tools import no database, model, or route modules and contain no writes", () => {
  const root = path.join(__dirname, "..");
  const source = ["memory-mcp-server.js", "memory-api-client.js"]
    .map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|structured-memory-store|memory-routes|model-adapter|ai-task-runner)["']\)/);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE)\b\s+(?:INTO|FROM|memory_items)/i);
  assert.doesNotMatch(source, /setInterval|setTimeout|retry/i);
});
