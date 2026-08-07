"use strict";

const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { test } = require("node:test");
const { emptyBoard } = require("../ai-companion-frontend/game/gomoku");
const { GomokuChenError, GomokuChenService } = require("../gomoku-chen-service");
const { registerGomokuChenRoutes } = require("../gomoku-chen-routes");

const playingBoard = () => {
  const board = emptyBoard();
  board[7][7] = 1;
  return board;
};

test("gomoku chen route requires Bearer auth and returns a model-selected legal move", async t => {
  const service = new GomokuChenService({
    generate: async () => ({ content: '{"row":7,"col":8,"message":"我先走这里。"}' })
  });
  const app = Fastify({ logger: false });
  registerGomokuChenRoutes(app, { service, apiKey: "test-only" });
  t.after(() => app.close());

  const unauthorized = await app.inject({
    method: "POST",
    url: "/api/game/gomoku/chen-move",
    payload: { board: playingBoard(), gameState: "playing" }
  });
  assert.equal(unauthorized.statusCode, 401);

  const response = await app.inject({
    method: "POST",
    url: "/api/game/gomoku/chen-move",
    headers: { authorization: "Bearer test-only" },
    payload: {
      board: playingBoard(),
      userMove: { row: 7, col: 7 },
      moveHistory: [{ player: "user", row: 7, col: 7 }],
      gameState: "playing"
    }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    move: { row: 7, col: 8 },
    message: "我先走这里。",
    source: "chen"
  });
});

test("illegal or occupied model moves safely use the existing rule fallback", async () => {
  for (const content of [
    '{"row":99,"col":8,"message":"越界"}',
    '{"row":7,"col":7,"message":"占用"}',
    '{"row":"6","col":8,"message":"字符串坐标"}'
  ]) {
    const board = playingBoard();
    const service = new GomokuChenService({ generate: async () => ({ content }) });
    const result = await service.chenMove({ board, gameState: "playing" });
    assert.equal(result.ok, true);
    assert.equal(result.source, "fallback");
    assert.equal(result.message, "沉想了一下，落在这里。");
    assert.equal(board[result.move.row][result.move.col], 0);
  }
});

test("a finished board is rejected before asking Chen for another move", async () => {
  const board = playingBoard();
  for (let col = 1; col <= 5; col += 1) board[3][col] = 1;
  let calls = 0;
  const service = new GomokuChenService({ generate: async () => { calls += 1; } });
  await assert.rejects(
    service.chenMove({ board, gameState: "playing" }),
    error => error instanceof GomokuChenError && error.code === "GOMOKU_GAME_FINISHED"
  );
  assert.equal(calls, 0);
});

test("nested move JSON is accepted when the model uses the API response shape", async () => {
  const service = new GomokuChenService({
    generate: async () => ({ content: '{"move":{"row":6,"col":7},"message":"我走这儿。"}' })
  });
  const result = await service.chenMove({ board: playingBoard(), gameState: "playing" });
  assert.equal(result.source, "chen");
  assert.deepEqual(result.move, { row: 6, col: 7 });
});

test("model timeout falls back without failing the game request", async () => {
  const service = new GomokuChenService({
    timeoutMs: 5,
    generate: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })));
    })
  });
  const board = playingBoard();
  const result = await service.chenMove({ board, gameState: "playing" });
  assert.equal(result.ok, true);
  assert.equal(result.source, "fallback");
  assert.equal(board[result.move.row][result.move.col], 0);
});

test("gomoku model prompt asks Chen to choose a move without role scripting", async () => {
  let messages;
  const service = new GomokuChenService({
    generate: async input => {
      messages = input.messages;
      return { content: '{"row":6,"col":7,"message":"辞辞这步有点凶。"}' };
    }
  });
  await service.chenMove({ board: playingBoard(), gameState: "playing" });
  const system = messages[0].content;
  assert.match(system, /你是沉，正在陪辞辞下五子棋/);
  assert.match(system, /你能看到棋盘，请选择一个合法落子，并简短回应/);
  assert.match(system, /只返回 JSON/);
  assert.doesNotMatch(system, /必须说|固定回复|禁止词|minimax|Codex/);
});
