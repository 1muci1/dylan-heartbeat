"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  emptyBoard,
  isWin,
  chooseAiMove,
  pointToCell,
  scheduleChenMove
} = require("../ai-companion-frontend/game/gomoku");

const root = path.join(__dirname, "..", "ai-companion-frontend", "game");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("game lobby exposes playable and extensible game cards", () => {
  const html = read("index.html");
  assert.match(html, /小窝游戏厅/);
  for (const title of ["五子棋", "你画我猜", "记忆问答"]) assert.match(html, new RegExp(title));
  assert.match(html, /和沉下一局/);
  assert.match(html, /你画给沉猜，或者沉画给你猜/);
  assert.match(html, /即将开放/);
  for (const file of ["game.css", "identity.css", "gomoku-board.css", "gomoku.js", "game.js"]) {
    assert.ok(fs.existsSync(path.join(root, file)));
  }
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
  assert.deepEqual(chooseAiMove(winning, () => 0), { row: 4, column: 1, reason: "win" });

  const blocking = emptyBoard();
  for (let column = 3; column < 7; column++) blocking[8][column] = 1;
  const block = chooseAiMove(blocking, () => 0);
  assert.ok((block.row === 8 && block.column === 2) || (block.row === 8 && block.column === 7));

  const board = emptyBoard();
  board[7][7] = 1;
  const move = chooseAiMove(board, () => 0);
  assert.equal(board[move.row][move.column], 0);
});

test("Chen blocks immediate four in every direction", () => {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const board = emptyBoard();
    const start = dc < 0 ? [4, 10] : [4, 4];
    for (let step = 0; step < 4; step++) {
      board[start[0] + dr * step][start[1] + dc * step] = 1;
    }
    const move = chooseAiMove(board, () => 0);
    assert.equal(move.reason, "block");
    board[move.row][move.column] = 1;
    assert.equal(isWin(board, move.row, move.column, 1), true);
  }
});

test("Chen blocks every broken-four shape at its winning gap", () => {
  for (const [columns, gap] of [
    [[3, 4, 6, 7], 5],
    [[3, 4, 5, 7], 6],
    [[3, 5, 6, 7], 4]
  ]) {
    const board = emptyBoard();
    columns.forEach(column => { board[7][column] = 1; });
    assert.deepEqual(chooseAiMove(board, () => 0), { row: 7, column: gap, reason: "block" });
  }
});

test("Chen prioritizes its own win over blocking the user", () => {
  const board = emptyBoard();
  for (let column = 2; column < 6; column++) board[3][column] = 2;
  for (let row = 7; row < 11; row++) board[row][9] = 1;
  const move = chooseAiMove(board, () => 0);
  assert.equal(move.reason, "win");
  assert.deepEqual({ row: move.row, column: move.column }, { row: 3, column: 1 });
});

test("board coordinates map taps near a visible intersection to the correct cell", () => {
  const rect = { left: 20, top: 40, width: 320, height: 320 };
  const edge = 20;
  const cell = 20;
  const row = 9;
  const column = 6;
  assert.deepEqual(
    pointToCell(rect.left + edge + column * cell + 4, rect.top + edge + row * cell - 4, rect),
    { row, column }
  );
});

test("board draws fifteen-by-fifteen intersections with half-cell edge padding", () => {
  const html = read("index.html");
  const css = read("gomoku-board.css");
  const js = read("game.js");
  assert.match(html, /gomoku-board\.css/);
  assert.match(css, /--board-edge:\s*6\.25%/);
  assert.match(css, /background-size:\s*calc\(100% \/ 14\) 100%,\s*100% calc\(100% \/ 14\)/);
  assert.match(css, /inset -1px 0/);
  assert.match(css, /inset 0 -1px/);
  assert.match(css, /transform:\s*translate\(-50%, -50%\)/);
  assert.match(js, /gomoku-board__lines/);
  assert.match(js, /button\.style\.top/);
  assert.match(js, /button\.style\.left/);
  assert.match(js, /pointToCell\(event\.clientX, event\.clientY/);
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
  assert.match(js, /result\.textContent = "沉正在看你的画……"/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
});

test("user drawing validates the hidden answer and real strokes before any request", () => {
  const html = read("index.html");
  const js = read("game.js");
  assert.match(html, /画作答案（只给系统判定，沉看不到）/);
  assert.match(html, /placeholder="例如：雨伞"/);
  assert.match(html, /data-draw-answer[^>]+required/);
  assert.match(html, /答案只用于系统判定，提交给沉看的只有线条结构/);
  assert.match(js, /if \(!String\(answer \|\| ""\)\.trim\(\)\)/);
  assert.match(js, /stroke\.points\.length >= 2/);
  assert.match(js, /先告诉系统你画的是什么，沉不会看到这个答案/);
  assert.match(js, /先画几笔再提交给沉猜/);
  const submitHandler = js.slice(js.indexOf('$("[data-draw-submit]")'), js.indexOf('$("[data-chen-guess]")'));
  assert.ok(submitHandler.indexOf("validateUserDrawing") < submitHandler.indexOf("gameFetch"));
  assert.match(submitHandler, /if \(!validation\.ok\)[\s\S]*return;/);
});

test("draw errors map to fixed safe messages and never expose raw non-JSON text", () => {
  const js = read("game.js");
  for (const code of [
    "DRAW_ANSWER_INVALID",
    "DRAWING_EMPTY",
    "DRAW_AUTH_REQUIRED",
    "FORBIDDEN",
    "DRAW_ROUND_NOT_FOUND",
    "DRAW_MODEL_FAILED"
  ]) assert.match(js, new RegExp(code));
  assert.match(js, /这一局暂时提交失败，稍后再试/);
  assert.match(js, /await response\.text\(\)\.then\(\(\) => null\)/);
  assert.doesNotMatch(js, /Unexpected token/);
});

test("Chen drawing prompt receives public structure but never the private answer", () => {
  const js = read("game.js");
  const askChen = js.slice(js.indexOf("async function askChen"), js.indexOf('$("[data-draw-submit]")'));
  assert.match(askChen, /status\.drawing_svg/);
  assert.match(askChen, /status\.ascii_grid/);
  assert.match(askChen, /你是沉，在和辞辞玩你画我猜/);
  assert.doesNotMatch(askChen, /\banswer\b/);
});

test("guess result actions are tappable buttons with visible in-card feedback", () => {
  const html = read("index.html");
  const js = read("game.js");
  const css = read("identity.css");
  for (const action of ["correct", "wrong", "hint"]) {
    assert.match(html, new RegExp(`<button type="button" data-chen-feedback="${action}"`));
  }
  const actionMarkup = html.slice(html.indexOf("guess-result__actions"), html.indexOf("data-chen-feedback-text"));
  assert.doesNotMatch(actionMarkup, /disabled/);
  assert.match(js, /太好了，沉猜对了！/);
  assert.match(js, /state\.roundOutcome = "guessed_correct"/);
  assert.match(js, /没关系，可以给沉一点提示，或者再让她猜一次/);
  assert.match(css, /\.guess-result[\s\S]*z-index:\s*3/);
  assert.match(css, /\.guess-result[\s\S]*pointer-events:\s*auto/);
  assert.doesNotMatch(css, /\.guess-result[^}]*pointer-events:\s*none/);
  assert.match(css, /\.drawing-wrap,[\s\S]*z-index:\s*0/);
});

test("hint action reveals an input and submits only the user hint for another Chen guess", () => {
  const html = read("index.html");
  const js = read("game.js");
  assert.match(html, /data-chen-hint-form hidden/);
  assert.match(html, /name="hint"[^>]+maxlength="120"/);
  assert.match(html, /提交提示后再猜/);
  assert.match(js, /data-chen-hint-form]"\)\.addEventListener\("submit"/);
  assert.match(js, /askChen\(state\.drawingStatus, hint\)/);
  assert.match(js, /用户给了一个提示/);
  assert.match(js, /沉再猜：/);
  assert.doesNotMatch(js.slice(js.indexOf("async function askChen"), js.indexOf('$("[data-draw-submit]")')), /\banswer\b/);
});

test("feedback loading always restores the result buttons after success or failure", () => {
  const js = read("game.js");
  const hintHandler = js.slice(
    js.indexOf('$("[data-chen-hint-form]").addEventListener'),
    js.indexOf('$$("[data-draw-mode]")', js.indexOf('$("[data-chen-hint-form]").addEventListener'))
  );
  assert.match(hintHandler, /buttons\.forEach\(button => \{ button\.disabled = true; \}\)/);
  assert.match(hintHandler, /catch \(error\)[\s\S]*drawErrorMessage\(error\)/);
  assert.match(hintHandler, /finally[\s\S]*button\.disabled = false/);
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
  assert.match(js, /if \(state\.over \|\| state\.locked\) return/);
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

test("shared MCP round links restore Chen drawing mode without exposing answers", () => {
  const js = read("game.js");
  assert.match(js, /roundIdFromLocation/);
  assert.match(js, /new URLSearchParams\(query\)\.get\("roundId"\)/);
  assert.match(js, /showView\("drawing"\)/);
  assert.match(js, /selectDrawMode\("chen"\)/);
  assert.match(js, /api\/game\/draw\/status\/\$\{encodeURIComponent\(roundId\)\}/);
  assert.match(js, /这一局画作已经失效，重新开始一局吧。/);
});
