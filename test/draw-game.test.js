"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Fastify = require("fastify");
const { svgEscape, strokesToSvg, makeAsciiGrid } = require("../ai-companion-frontend/shared/drawing-protocol");
const { DrawGameService } = require("../draw-game-service");
const { registerDrawGameRoutes } = require("../draw-game-routes");

const strokes = [{ tool: "polyline", points: [[10, 10], [100, 100], [200, 40]], color: "#51475a", width: 6 }];

test("drawing protocol emits safe SVG and an exact 60 by 42 ASCII grid", () => {
  assert.equal(svgEscape(`<script a="x">&'</script>`), "&lt;script a=&quot;x&quot;&gt;&amp;&#39;&lt;/script&gt;");
  const svg = strokesToSvg([{ ...strokes[0], color: `"><script>alert(1)</script>` }], { width: 600, height: 420 });
  assert.match(svg, /^<svg/);
  assert.doesNotMatch(svg, /<script|alert/);
  const rows = makeAsciiGrid(strokes, { width: 600, height: 420 }).split("\n");
  assert.equal(rows.length, 42);
  assert.ok(rows.every(row => row.length === 60));
});

test("draw_status uses a public whitelist and draw_guess never leaks a wrong answer", () => {
  const service = new DrawGameService({ now: () => new Date("2026-07-29T00:00:00Z") });
  const started = service.drawStart({ artist: "user", answer: "雨伞", aliases: ["伞"], strokes });
  const status = service.drawStatus(started.round_id);
  assert.deepEqual(Object.keys(status), ["canvas", "artist", "created_at", "drawing_svg", "ascii_grid", "ascii_grid_note"]);
  assert.equal(JSON.stringify(status).includes("雨伞"), false);
  assert.deepEqual(service.drawGuess(started.round_id, { guesser: "chen", content: "云" }), { result: "没猜中" });
  assert.equal(JSON.stringify(service.drawGuess(started.round_id, { content: "云" })).includes("雨伞"), false);
  assert.deepEqual(service.drawGuess(started.round_id, { content: "伞" }), { result: "猜对了" });
});

test("chen preset status hides answer and aliases", () => {
  const service = new DrawGameService({ random: () => 0 });
  const started = service.drawStart({ artist: "chen" });
  const serialized = JSON.stringify(service.drawStatus(started.round_id));
  assert.equal(serialized.includes('"answer"'), false);
  assert.equal(serialized.includes('"aliases"'), false);
  assert.deepEqual(service.drawGuess(started.round_id, { content: "猫咪" }), { result: "猜对了" });
});

test("draw routes require Bearer auth and expose MCP-ready start/status/guess semantics", async t => {
  const app = Fastify({ logger: false });
  registerDrawGameRoutes(app, { service: new DrawGameService(), apiKey: "test-only" });
  t.after(() => app.close());
  const unauthorized = await app.inject({ method: "POST", url: "/api/game/draw/start", payload: {} });
  assert.equal(unauthorized.statusCode, 401);
  assert.match(unauthorized.headers["content-type"], /application\/json/);
  assert.deepEqual(unauthorized.json(), {
    ok: false,
    error: { code: "UNAUTHORIZED", message: "游戏访问凭据无效" }
  });
  const start = await app.inject({
    method: "POST", url: "/api/game/draw/start",
    headers: { authorization: "Bearer test-only" },
    payload: { artist: "user", answer: "山", strokes }
  });
  assert.equal(start.statusCode, 200, start.body);
  const id = start.json().round_id;
  const status = await app.inject({
    method: "GET", url: `/api/game/draw/status/${id}`,
    headers: { authorization: "Bearer test-only" }
  });
  assert.equal(status.statusCode, 200);
  assert.equal(Object.hasOwn(status.json(), "answer"), false);
  const guess = await app.inject({
    method: "POST", url: `/api/game/draw/guess/${id}`,
    headers: { authorization: "Bearer test-only" },
    payload: { guesser: "chen", content: "山" }
  });
  assert.deepEqual(guess.json(), { result: "猜对了" });
});

test("draw route validation errors always use the safe JSON envelope", async t => {
  const app = Fastify({ logger: false });
  registerDrawGameRoutes(app, { service: new DrawGameService(), apiKey: "test-only" });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/game/draw/start",
    headers: { authorization: "Bearer test-only" },
    payload: { artist: "user", answer: "", strokes: [] }
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, "DRAW_ANSWER_INVALID");
  assert.doesNotMatch(response.body, /stack|aliases|provider response|bearer/i);
});

test("a tap without a drawn line is rejected as an empty drawing", () => {
  const service = new DrawGameService();
  assert.throws(
    () => service.drawStart({
      artist: "user",
      answer: "圆",
      strokes: [{ tool: "polyline", points: [[10, 10]], color: "#51475a", width: 6 }]
    }),
    error => error.code === "DRAWING_EMPTY" && error.statusCode === 400
  );
});
