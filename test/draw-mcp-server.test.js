"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { DrawGameService } = require("../draw-game-service");
const { GameTools } = require("../game-tools");
const {
  callGameTool,
  createDrawMcpRuntime
} = require("../mcp-draw-server");

async function connectedRuntime(t) {
  const service = new DrawGameService({ random: () => 0 });
  const runtime = createDrawMcpRuntime({
    gameTools: new GameTools({ service }),
    signalSource: new EventEmitter()
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "draw-mcp-test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await runtime.close();
  });
  return { client, service };
}

test("Draw MCP lists only the three allowlisted game tools", async t => {
  const { client } = await connectedRuntime(t);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), [
    "draw_start",
    "draw_status",
    "draw_guess"
  ]);
});

test("MCP draw_start delegates through GameTools and returns the game URL", async t => {
  let called = null;
  const gameTools = {
    execute(name, input) {
      called = { name, input };
      return { ok: true, roundId: "round-1", message: "沉画好了，可以开始猜了。" };
    }
  };
  const runtime = createDrawMcpRuntime({ gameTools, signalSource: new EventEmitter() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "draw-mcp-delegation-test", version: "1.0.0" });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await runtime.close();
  });
  const result = await client.callTool({
    name: "draw_start",
    arguments: { answer: "猫", artist: "chen" }
  });
  assert.deepEqual(called, {
    name: "draw_start",
    input: { answer: "猫", artist: "chen" }
  });
  assert.deepEqual(result.structuredContent, {
    ok: true,
    roundId: "round-1",
    message: "沉画好了，可以开始猜了。",
    gameUrl: "/game/#draw"
  });
});

test("MCP draw_status exposes public drawing data without answer or aliases", async t => {
  const { client } = await connectedRuntime(t);
  const started = await client.callTool({
    name: "draw_start",
    arguments: { answer: "猫" }
  });
  const status = await client.callTool({
    name: "draw_status",
    arguments: { roundId: started.structuredContent.roundId }
  });
  assert.equal(status.structuredContent.ok, true);
  assert.equal(status.structuredContent.roundId, started.structuredContent.roundId);
  assert.equal(Object.hasOwn(status.structuredContent, "answer"), false);
  assert.equal(Object.hasOwn(status.structuredContent, "aliases"), false);
  assert.equal(typeof status.structuredContent.drawing_svg, "string");
  assert.equal(typeof status.structuredContent.ascii_grid, "string");
  assert.equal(status.structuredContent.ascii_grid.split("\n").length, 42);
});

test("MCP draw_guess maps guesses safely and a miss never leaks the answer", async t => {
  const { client } = await connectedRuntime(t);
  const started = await client.callTool({
    name: "draw_start",
    arguments: { answer: "猫" }
  });
  const missed = await client.callTool({
    name: "draw_guess",
    arguments: {
      roundId: started.structuredContent.roundId,
      guess: "雨伞"
    }
  });
  assert.deepEqual(missed.structuredContent, {
    ok: true,
    guessed: false,
    message: "没猜中"
  });
  assert.doesNotMatch(JSON.stringify(missed), /猫|aliases|answer/i);
});

test("MCP schema and internal whitelist reject invalid tool calls safely", async t => {
  const { client } = await connectedRuntime(t);
  const invalidArguments = await client.callTool({
    name: "draw_guess",
    arguments: { roundId: "round-1", guess: "" }
  });
  assert.equal(invalidArguments.isError, true);
  const unknownTool = await client.callTool({ name: "memory_search", arguments: {} });
  assert.equal(unknownTool.isError, true);
  assert.match(unknownTool.content[0].text, /not found|unknown|tool/i);
  const forbidden = callGameTool({ execute() { throw new Error("must not run"); } }, "memory_search", {});
  assert.deepEqual(forbidden.structuredContent, {
    ok: false,
    error: {
      code: "GAME_TOOL_NOT_ALLOWED",
      message: "游戏工具不在白名单中"
    }
  });
  assert.equal(forbidden.isError, true);
  assert.doesNotMatch(JSON.stringify(forbidden), /stack|api.?key|bearer|server path/i);
});

test("Draw MCP runtime uses stdio and never binds a network listener", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "mcp-draw-server.js"), "utf8");
  assert.match(source, /StdioServerTransport/);
  assert.doesNotMatch(source, /\.listen\s*\(|createServer\s*\(|0\.0\.0\.0|fastify\s*\(/);
  assert.doesNotMatch(source, /dotenv|process\\.env|API_KEY|AUTHORIZATION/i);
});

test("package and MCP plan mark the private stdio transport complete", () => {
  const root = path.join(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const plan = fs.readFileSync(
    path.join(root, "ai-companion-frontend", "game", "MCP_PLAN.md"),
    "utf8"
  );
  assert.equal(pkg.scripts["mcp:draw"], "node mcp-draw-server.js");
  assert.match(plan, /真实 MCP Server stdio transport 已完成。✅/);
  assert.match(plan, /沉参与游戏的工具通道/);
});
