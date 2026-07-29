"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DrawGameService } = require("../draw-game-service");
const {
  GAME_TOOL_NAMES,
  GameTools,
  buildDrawGameChatContext,
  detectDrawGameIntent
} = require("../game-tools");

test("game tools expose only draw_start, draw_status and draw_guess", () => {
  const tools = new GameTools({ service: new DrawGameService() });
  assert.deepEqual(GAME_TOOL_NAMES, ["draw_start", "draw_status", "draw_guess"]);
  assert.deepEqual(tools.list().map(tool => tool.name), GAME_TOOL_NAMES);
});

test("draw_start delegates to the existing DrawGameService method", () => {
  let received = null;
  const service = {
    drawStart(input) { received = input; return { round_id: "round-1" }; },
    drawStatus() {},
    drawGuess() {}
  };
  const result = new GameTools({ service }).execute("draw_start", { artist: "chen" });
  assert.deepEqual(received, { artist: "chen", answer: undefined, aliases: undefined, strokes: undefined });
  assert.deepEqual(result, { ok: true, roundId: "round-1", message: "沉画好了，可以开始猜了。" });
});

test("draw_status returns only public drawing fields and never answer or aliases", () => {
  const service = new DrawGameService({ random: () => 0 });
  const tools = new GameTools({ service });
  const started = tools.execute("draw_start", { artist: "chen" });
  const status = tools.execute("draw_status", { roundId: started.roundId });
  assert.equal(status.ok, true);
  assert.equal(Object.hasOwn(status, "answer"), false);
  assert.equal(Object.hasOwn(status, "aliases"), false);
  assert.deepEqual(
    Object.keys(status),
    ["ok", "canvas", "artist", "created_at", "drawing_svg", "ascii_grid", "ascii_grid_note"]
  );
});

test("draw_guess accepts aliases but a wrong guess never leaks the answer", () => {
  const service = new DrawGameService({ random: () => 0 });
  const tools = new GameTools({ service });
  const started = tools.execute("draw_start", { artist: "chen" });
  assert.deepEqual(tools.execute("draw_guess", {
    roundId: started.roundId, content: "猫咪", guesser: "chen"
  }), { ok: true, result: "猜对了" });
  const wrong = tools.execute("draw_guess", {
    target: started.roundId, content: "雨伞", guesser: "chen"
  });
  assert.deepEqual(wrong, { ok: true, result: "没猜中" });
  assert.equal(JSON.stringify(wrong).includes("猫"), false);
});

test("game tool names are whitelisted and invalid inputs return safe errors", () => {
  const tools = new GameTools({ service: new DrawGameService() });
  assert.deepEqual(tools.execute("memory_read", {}), {
    ok: false,
    error: { code: "GAME_TOOL_NOT_ALLOWED", message: "游戏工具不在白名单中" }
  });
  assert.deepEqual(tools.execute("draw_guess", { content: "" }), {
    ok: false,
    error: { code: "GAME_TOOL_INPUT_INVALID", message: "游戏工具参数无效" }
  });
  const serialized = JSON.stringify(tools.execute("draw_status", {}));
  assert.doesNotMatch(serialized, /stack|api.?key|bearer|server path/i);
});

test("draw-game intent distinguishes who draws and ignores ordinary chat", () => {
  assert.deepEqual(detectDrawGameIntent("我画你猜"), { type: "user_draw", toolName: null });
  assert.deepEqual(detectDrawGameIntent("你来猜我画的"), { type: "user_draw", toolName: null });
  assert.deepEqual(detectDrawGameIntent("沉你画我猜"), { type: "chen_draw", toolName: "draw_start" });
  assert.deepEqual(detectDrawGameIntent("你画我猜"), { type: "chen_draw", toolName: "draw_start" });
  assert.equal(detectDrawGameIntent("今天有点累，陪我聊聊"), null);
  assert.equal(detectDrawGameIntent("帮我看看这张图片"), null);
  assert.equal(detectDrawGameIntent("你记得我的专业吗"), null);
});

test("chat guidance keeps Chen identity and the game link without exposing implementation", () => {
  const userContext = buildDrawGameChatContext({ type: "user_draw", toolName: null });
  assert.match(userContext.content, /\/game\/#draw/);
  assert.match(userContext.content, /沉的口吻/);
  const chenContext = buildDrawGameChatContext(
    { type: "chen_draw", toolName: "draw_start" },
    { ok: true, roundId: "round-1" }
  );
  assert.match(chenContext.content, /我画好啦，去游戏页猜猜看/);
  assert.match(chenContext.content, /\/game\/#draw/);
});

test("Gateway registers only the game intent context on the explicit path", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /detectDrawGameIntent\(latestUserContent\)/);
  assert.match(server, /gameTools\.execute\("draw_start", \{ artist: "chen" \}\)/);
  assert.match(server, /buildDrawGameChatContext\(drawGameIntent, drawGameToolResult\)/);
});

test("MCP plan documents all four stages and Chen remains the player", () => {
  const plan = fs.readFileSync(path.join(
    __dirname, "..", "ai-companion-frontend", "game", "MCP_PLAN.md"
  ), "utf8");
  assert.match(plan, /网页游戏与临时回合服务已完成。✅/);
  assert.match(plan, /内部 game tools 已完成/);
  assert.match(plan, /接入真实 MCP server/);
  assert.match(plan, /主动发起和继续游戏/);
  assert.match(plan, /用户可见玩家身份始终是沉/);
});
