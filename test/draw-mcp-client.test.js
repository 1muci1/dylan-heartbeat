"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  DRAW_MCP_TOOL_NAMES,
  DrawMcpClient
} = require("../draw-mcp-client");

function fakeBridge(options = {}) {
  const calls = [];
  let closed = false;
  const client = {
    async connect(transport) {
      calls.push({ operation: "connect", transport });
      if (options.connectError) throw new Error("private path must not escape");
    },
    async listTools() {
      calls.push({ operation: "list" });
      return {
        tools: [
          { name: "draw_start" },
          { name: "draw_status" },
          { name: "draw_guess" },
          { name: "read_env" }
        ]
      };
    },
    async callTool(request) {
      calls.push({ operation: "call", request });
      if (options.callError) throw new Error("private path must not escape");
      if (request.name === "draw_start") {
        return {
          structuredContent: {
            ok: true,
            roundId: "round-1",
            message: "沉画好了，可以开始猜了。",
            gameUrl: "/game/#draw?roundId=round-1"
          }
        };
      }
      if (request.name === "draw_status") {
        return {
          structuredContent: {
            ok: true,
            roundId: "round-1",
            canvas: { width: 600, height: 420 },
            artist: "chen",
            created_at: "2026-07-29T00:00:00.000Z",
            drawing_svg: "<svg></svg>",
            ascii_grid: " ",
            ascii_grid_note: "公开网格"
          }
        };
      }
      return {
        structuredContent: {
          ok: true,
          guessed: false,
          message: "没猜中"
        }
      };
    },
    async close() {
      closed = true;
    }
  };
  const bridge = new DrawMcpClient({
    clientFactory: () => client,
    transportFactory: () => ({ type: "fake-stdio" }),
    timeoutMs: 100
  });
  return { bridge, calls, isClosed: () => closed };
}

test("Draw MCP client lazily lists only the allowlisted tools", async t => {
  const { bridge, calls } = fakeBridge();
  t.after(() => bridge.close());
  assert.deepEqual(DRAW_MCP_TOOL_NAMES, ["draw_start", "draw_status", "draw_guess"]);
  assert.equal(calls.length, 0);
  assert.deepEqual(await bridge.listTools(), {
    ok: true,
    tools: ["draw_start", "draw_status", "draw_guess"]
  });
  assert.equal(calls[0].operation, "connect");
});

test("Draw MCP client calls draw_start and keeps hidden fields out", async t => {
  const { bridge, calls } = fakeBridge();
  t.after(() => bridge.close());
  const result = await bridge.callTool("draw_start", {
    answer: "沉的随机题目",
    artist: "chen"
  });
  assert.equal(result.ok, true);
  assert.equal(result.roundId, "round-1");
  assert.equal(result.gameUrl, "/game/#draw?roundId=round-1");
  assert.equal(Object.hasOwn(result, "answer"), false);
  assert.equal(Object.hasOwn(result, "aliases"), false);
  assert.deepEqual(calls.at(-1).request, {
    name: "draw_start",
    arguments: { answer: "沉的随机题目", artist: "chen" }
  });
});

test("Draw MCP status and wrong guess remain public and safe", async t => {
  const { bridge } = fakeBridge();
  t.after(() => bridge.close());
  const status = await bridge.callTool("draw_status", { roundId: "round-1" });
  assert.equal(status.ok, true);
  assert.equal(Object.hasOwn(status, "answer"), false);
  assert.equal(Object.hasOwn(status, "aliases"), false);
  const guess = await bridge.callTool("draw_guess", {
    roundId: "round-1",
    guess: "雨伞",
    guesser: "chen"
  });
  assert.deepEqual(guess, { ok: true, guessed: false, message: "没猜中" });
  assert.doesNotMatch(JSON.stringify(guess), /answer|aliases|stack|path|token/i);
});

test("Draw MCP client rejects unknown tools before transport", async t => {
  const { bridge, calls } = fakeBridge();
  t.after(() => bridge.close());
  assert.deepEqual(await bridge.callTool("read_env", {}), {
    ok: false,
    error: {
      code: "DRAW_MCP_TOOL_INVALID",
      message: "沉的画画工具暂时没有连上。"
    }
  });
  assert.equal(calls.length, 0);
});

test("Draw MCP client maps connection and call failures without private details", async () => {
  for (const options of [{ connectError: true }, { callError: true }]) {
    const { bridge } = fakeBridge(options);
    const result = await bridge.callTool("draw_start", {
      answer: "沉的随机题目",
      artist: "chen"
    });
    assert.equal(result.ok, false);
    assert.match(result.error.code, /^DRAW_MCP_(UNAVAILABLE|CALL_FAILED)$/);
    assert.doesNotMatch(JSON.stringify(result), /private path|stack|token|authorization|api.?key/i);
    await bridge.close();
  }
});

test("Draw MCP client returns a safe timeout code", async () => {
  const bridge = new DrawMcpClient({
    clientFactory: () => ({
      connect: () => new Promise(() => {}),
      async close() {}
    }),
    transportFactory: () => ({ type: "fake-stdio" }),
    timeoutMs: 10
  });
  const result = await bridge.callTool("draw_start", {
    answer: "沉的随机题目",
    artist: "chen"
  });
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "DRAW_MCP_TIMEOUT",
      message: "沉的画画工具暂时没有连上。"
    }
  });
  await bridge.close();
});

test("Draw MCP client uses local node stdio without network or environment secrets", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "draw-mcp-client.js"), "utf8");
  assert.match(source, /StdioClientTransport/);
  assert.match(source, /command: process\.execPath/);
  assert.match(source, /mcp-draw-server\.js/);
  assert.doesNotMatch(source, /\.listen\s*\(|0\.0\.0\.0|https?:\/\/|dotenv|API_KEY|Authorization/i);
});

test("Gateway prefers MCP only for Chen draw intent and keeps a safe fallback", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const gameTools = fs.readFileSync(path.join(__dirname, "..", "game-tools.js"), "utf8");
  assert.match(server, /await resolveDrawGameIntentTool\(/);
  assert.match(server, /callMcpTool: callDrawMcpTool/);
  assert.match(gameTools, /intent\?\.toolName !== "draw_start"/);
  assert.match(gameTools, /DRAW_MCP_FALLBACK_INTERNAL/);
  assert.match(gameTools, /internalTools\.execute\("draw_start", \{ artist: "chen" \}\)/);
});
