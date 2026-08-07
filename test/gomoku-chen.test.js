"use strict";

const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { test } = require("node:test");
const { emptyBoard } = require("../ai-companion-frontend/game/gomoku");
const {
  GomokuChenError,
  GomokuChenService,
  candidateMoves
} = require("../gomoku-chen-service");
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

test("invalid model moves use fallback with a safe precise reason", async () => {
  for (const [content, reason] of [
    ['{"row":99,"col":8,"message":"越界"}', "MODEL_MOVE_OUT_OF_RANGE"],
    ['{"row":7,"col":7,"message":"占用"}', "MODEL_MOVE_OCCUPIED"],
    ['{"row":"七","col":8}', "MODEL_MOVE_NOT_NUMERIC"],
    ['{"message":"只有消息"}', "MODEL_MOVE_MISSING"],
    ['不是 JSON', "MODEL_JSON_PARSE_FAILED"],
    ['{"row":0,"col":0}', "MODEL_MOVE_NOT_IN_CANDIDATES"]
  ]) {
    const board = playingBoard();
    const service = new GomokuChenService({ generate: async () => ({ content }) });
    const result = await service.chenMove({ board, gameState: "playing" });
    assert.equal(result.ok, true);
    assert.equal(result.source, "fallback");
    assert.equal(result.reason, reason);
    assert.equal(result.message, "沉想了一下，落在这里。");
    assert.doesNotMatch(result.message, /本地\s*AI|Codex|算法/i);
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
    error => error instanceof GomokuChenError && error.code === "GAME_ALREADY_OVER"
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

test("fenced, embedded and numeric-string JSON moves are accepted", async () => {
  for (const content of [
    '```json\n{"row":6,"col":7,"message":"我落这里。"}\n```',
    '我选好了：{"row":6,"col":7,"message":"看这里。"} 就这样。',
    '{"row":"6","col":"7","message":"这一步。"}'
  ]) {
    const service = new GomokuChenService({ generate: async () => ({ content }) });
    const result = await service.chenMove({ board: playingBoard(), gameState: "playing" });
    assert.equal(result.source, "chen");
    assert.deepEqual(result.move, { row: 6, col: 7 });
  }
});

test("candidate list is bounded, unique and contains only empty positions", () => {
  const board = playingBoard();
  const candidates = candidateMoves(board);
  assert.ok(candidates.length >= 8 && candidates.length <= 20);
  assert.equal(new Set(candidates.map(move => `${move.row}:${move.col}`)).size, candidates.length);
  assert.ok(candidates.every(move => board[move.row][move.col] === 0));
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
  assert.equal(result.reason, "MODEL_TIMEOUT");
  assert.equal(result.statusCode, 504);
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
  assert.match(system, /你是沉，正在和辞辞下五子棋/);
  assert.match(system, /只能从 candidates 中选择一个空位/);
  assert.match(system, /只返回 JSON/);
  assert.doesNotMatch(system, /必须说|固定回复|禁止词|minimax|Codex/);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.lastMoves.length, 0);
  assert.ok(payload.candidates.length <= 20);
  assert.equal(payload.board.length, 15);
});

test("route logging is limited to safe operational metadata", () => {
  const route = require("node:fs").readFileSync(require.resolve("../gomoku-chen-routes"), "utf8");
  assert.match(route, /source: result\.source/);
  assert.match(route, /reason: result\.reason/);
  assert.match(route, /latencyMs/);
  assert.match(route, /occupiedCount/);
  assert.match(route, /moveHistoryLength/);
  assert.doesNotMatch(route, /req\.log\.(?:info|warn|error)\([^\n]*(?:authorization|apiKey|messages|board:|prompt)/i);
});
