"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { emptyBoard, isWin, chooseAiMove, scheduleChenMove } = require("../ai-companion-frontend/game/gomoku");

const root = path.join(__dirname, "..", "ai-companion-frontend", "game");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("game lobby exposes playable and extensible game cards", () => {
  const html = read("index.html");
  assert.match(html, /小窝游戏厅/);
  for (const title of ["五子棋", "你画我猜", "记忆问答"]) assert.match(html, new RegExp(title));
  assert.match(html, /和沉下一局/);
  assert.match(html, /你画给沉猜，或者沉画给你猜/);
  assert.match(html, /即将开放/);
  for (const file of ["game.css", "identity.css", "gomoku.js", "game.js"]) assert.ok(fs.existsSync(path.join(root, file)));
});

test("gomoku detects horizontal, vertical and both diagonal wins without false positives", () => {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const board = emptyBoard();
    for (let step = 0; step < 4; step++) board[5 + dr * step][7 + dc * step] = 1;
    assert.equal(isWin(board, 5, 7, 1), false);
    board[5 + dr * 4][7 + dc * 4] = 1;
    assert.equal(isWin(board, 5, 7, 1), true);
  }
});

test("gomoku AI wins first, blocks second, and never selects an occupied point", () => {
  const winning = emptyBoard();
  for (let column = 2; column < 6; column++) winning[4][column] = 2;
  assert.deepEqual(chooseAiMove(winning, () => 0), { row: 4, column: 1 });

  const blocking = emptyBoard();
  for (let column = 3; column < 7; column++) blocking[8][column] = 1;
  const block = chooseAiMove(blocking, () => 0);
  assert.ok((block.row === 8 && block.column === 2) || (block.row === 8 && block.column === 7));

  const board = emptyBoard();
  board[7][7] = 1;
  const move = chooseAiMove(board, () => 0);
  assert.equal(board[move.row][move.column], 0);
});

test("Chen move is delayed and does not appear before the thinking timer fires", () => {
  const board = emptyBoard();
  board[7][7] = 1;
  let scheduledCallback;
  let scheduledDelay;
  let move = null;
  const scheduled = scheduleChenMove(board, {
    random: () => 0,
    setTimer(callback, delay) {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return 42;
    },
    onMove(value) { move = value; }
  });
  assert.equal(move, null);
  assert.equal(scheduled.timer, 42);
  assert.equal(scheduled.delay, 600);
  assert.equal(scheduledDelay, 600);
  scheduledCallback();
  assert.ok(move);
  assert.equal(board[move.row][move.column], 0);
});

test("drawing canvas supports pointer and touch input without bottom navigation overlap", () => {
  const html = read("index.html");
  const js = read("game.js");
  const css = read("game.css");
  assert.match(html, /<canvas[^>]+data-drawing-canvas/);
  assert.match(js, /pointerdown/);
  assert.match(js, /pointermove/);
  assert.match(js, /setPointerCapture/);
  assert.match(css, /touch-action:none/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /padding:[^}]*var\(--nav-height\)/);
  assert.match(html, /data-draw-undo/);
  assert.match(html, /data-draw-clear/);
  assert.match(html, /data-draw-submit/);
});

test("drawing frontend sends structured strokes and uses public draw status", () => {
  const html = read("index.html");
  const js = read("game.js");
  assert.match(html, /\/shared\/drawing-protocol\.js/);
  assert.match(js, /\/api\/game\/draw\/start/);
  assert.match(js, /\/api\/game\/draw\/status/);
  assert.match(js, /\/api\/game\/draw\/guess/);
  assert.match(js, /drawing_svg/);
  assert.match(js, /ascii_grid/);
  assert.match(js, /headers\.get\("content-type"\)/);
  assert.match(js, /contentType\.includes\("application\/json"\)/);
  assert.match(js, /await response\.text\(\)\.then\(\(\) => null\)/);
  assert.match(js, /沉暂时连接不上游戏服务/);
  assert.match(js, /submitButton\.disabled = true/);
  assert.match(js, /沉暂时没看清，稍后再试/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
});

test("Gateway lets game requests reach their JSON Bearer route instead of the plain Forbidden fallback", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const allowIndex = server.indexOf('req.url.startsWith("/api/game/")');
  const forbiddenIndex = server.indexOf('reply.code(403).send("Forbidden")');
  assert.ok(allowIndex > -1);
  assert.ok(forbiddenIndex > allowIndex);
});

test("all visible players are Chen and the game reuses both preference avatars", () => {
  const html = read("index.html");
  const js = read("game.js");
  assert.match(html, /我画，沉猜/);
  assert.match(html, /沉画，我猜/);
  assert.match(html, /data-game-chen-avatar/);
  assert.match(html, /data-game-user-avatar/);
  assert.match(html, /\/storage\/user-preference-store\.js/);
  assert.match(js, /getChenAvatarImage/);
  assert.match(js, /getUserAvatarImage/);
  assert.match(js, /轮到沉，沉正在想/);
  assert.match(js, /沉落子了/);
  assert.match(js, /state\.locked/);
  assert.match(js, /if \(!cell \|\| state\.over \|\| state\.locked\) return/);
  assert.match(js, /你赢了。沉认真记下这一局。/);
  assert.match(js, /沉赢了。沉认真记下这一局。/);
  assert.match(js, /沉正在看你的画/);
  assert.match(js, /你是沉，在和辞辞玩你画我猜/);
  assert.doesNotMatch(html, /规则 AI|电脑玩家|AI 落子|bot/i);
});

test("MCP plan keeps Chen as the player identity", () => {
  const plan = read("MCP_PLAN.md");
  assert.match(plan, /draw_start.*沉开始画/);
  assert.match(plan, /draw_status.*沉查看/);
  assert.match(plan, /draw_guess.*沉提交猜测/);
  assert.match(plan, /玩家身份始终是沉/);
});
