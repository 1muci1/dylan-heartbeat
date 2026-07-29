"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { DrawGameService } = require("../draw-game-service");
const { registerDrawGameRoutes } = require("../draw-game-routes");
const {
  DEFAULT_DRAW_ROUND_TTL_MS,
  DrawRoundStore
} = require("../draw-round-store");

const strokes = [{
  tool: "polyline",
  points: [[10, 10], [100, 100]],
  color: "#51475a",
  width: 6
}];

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "draw-round-store-"));
  const filePath = path.join(directory, "draw-rounds.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    filePath,
    store: new DrawRoundStore({ filePath, ...options })
  };
}

test("shared JSON round store is atomic, private and defaults to a two-hour TTL", t => {
  const { filePath, store } = fixture(t);
  assert.equal(DEFAULT_DRAW_ROUND_TTL_MS, 2 * 60 * 60 * 1000);
  store.createRound({
    id: "round-1",
    answer: "雨伞",
    aliases: ["伞"],
    artist: "user",
    canvas: { width: 600, height: 420 },
    strokes,
    createdAt: "2026-07-29T00:00:00.000Z"
  });
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith(".tmp")),
    []
  );
  assert.equal(store.getRound("round-1").answer, "雨伞");
});

test("two service instances share rounds through the same JSON file", t => {
  const { filePath } = fixture(t);
  const mcpService = new DrawGameService({
    store: new DrawRoundStore({ filePath }),
    random: () => 3 / 7
  });
  const gatewayService = new DrawGameService({
    store: new DrawRoundStore({ filePath })
  });
  const started = mcpService.drawStart({ artist: "chen" });
  const status = gatewayService.drawStatus(started.round_id);
  assert.equal(typeof status.drawing_svg, "string");
  assert.equal(status.ascii_grid.split("\n").length, 42);
  assert.equal(Object.hasOwn(status, "answer"), false);
  assert.equal(Object.hasOwn(status, "aliases"), false);
  assert.deepEqual(gatewayService.drawGuess(started.round_id, {
    guesser: "user",
    content: "猫"
  }), { result: "没猜中" });
  assert.doesNotMatch(
    JSON.stringify(gatewayService.drawGuess(started.round_id, { content: "猫" })),
    /雨伞|answer|aliases/i
  );
});

test("a round created through the MCP tool is readable from the Gateway status route", async t => {
  const { filePath } = fixture(t);
  const resultPath = path.join(path.dirname(filePath), "mcp-result.json");
  const gatewayService = new DrawGameService({
    store: new DrawRoundStore({ filePath })
  });
  const child = spawnSync(process.execPath, [
    "-e",
    [
      'const { DrawRoundStore } = require("./draw-round-store");',
      'const { DrawGameService } = require("./draw-game-service");',
      'const { GameTools } = require("./game-tools");',
      'const { callGameTool } = require("./mcp-draw-server");',
      'const fs = require("node:fs");',
      "const filePath = process.argv[1];",
      "const resultPath = process.argv[2];",
      "const service = new DrawGameService({",
      "  store: new DrawRoundStore({ filePath }),",
      "  random: () => 3 / 7",
      "});",
      'const result = callGameTool(new GameTools({ service }), "draw_start", {',
      '  artist: "chen", answer: "雨伞"',
      "}).structuredContent;",
      "fs.writeFileSync(resultPath, JSON.stringify(result));"
    ].join("\n"),
    filePath,
    resultPath
  ], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== "NODE_TEST_CONTEXT")
    )
  });
  assert.equal(child.status, 0, child.stderr);
  const started = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(started.ok, true);
  assert.equal(
    started.gameUrl,
    `/game/#draw?roundId=${encodeURIComponent(started.roundId)}`
  );
  assert.doesNotMatch(started.gameUrl, /雨伞|answer|aliases/i);

  const app = Fastify({ logger: false });
  t.after(() => app.close());
  registerDrawGameRoutes(app, { service: gatewayService, apiKey: "test-key" });
  const response = await app.inject({
    method: "GET",
    url: `/api/game/draw/status/${encodeURIComponent(started.roundId)}`,
    headers: { authorization: "Bearer test-key" }
  });
  assert.equal(response.statusCode, 200);
  const status = response.json();
  assert.equal(typeof status.drawing_svg, "string");
  assert.equal(typeof status.ascii_grid, "string");
  assert.equal(Object.hasOwn(status, "answer"), false);
  assert.equal(Object.hasOwn(status, "aliases"), false);
});

test("expired rounds are removed and return DRAW_ROUND_NOT_FOUND", t => {
  let now = Date.parse("2026-07-29T00:00:00.000Z");
  const { store } = fixture(t, { ttlMs: 1000, now: () => now });
  const service = new DrawGameService({ store });
  const started = service.drawStart({ artist: "user", answer: "山", strokes });
  now += 1001;
  assert.throws(
    () => service.drawStatus(started.round_id),
    error => error.code === "DRAW_ROUND_NOT_FOUND" && error.statusCode === 404
  );
  assert.equal(store.deleteExpiredRounds(), 0);
});

test("round store supports safe updates without changing the round id", t => {
  const { store } = fixture(t);
  store.createRound({
    id: "round-1",
    answer: "花",
    aliases: [],
    artist: "chen",
    canvas: { width: 600, height: 420 },
    strokes,
    createdAt: "2026-07-29T00:00:00.000Z"
  });
  const updated = store.updateRound("round-1", { outcome: "guessed_correct", id: "other" });
  assert.equal(updated.id, "round-1");
  assert.equal(store.getRound("round-1").outcome, "guessed_correct");
});

test("active chat rounds are session-scoped and expire with their drawing", t => {
  let now = Date.parse("2026-07-29T00:00:00.000Z");
  const { store } = fixture(t, { ttlMs: 1000, now: () => now });
  store.createRound({
    id: "round-active",
    answer: "花",
    aliases: ["花朵"],
    artist: "chen",
    canvas: { width: 600, height: 420 },
    strokes,
    createdAt: "2026-07-29T00:00:00.000Z"
  });
  const active = store.setActiveRound("session:one", {
    roundId: "round-active",
    mode: "chen_draw_user_guess",
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    source: "chat"
  });
  assert.equal(active.mode, "chen_draw_user_guess");
  assert.equal(active.source, "chat");
  assert.equal(store.getActiveRound("session:two"), null);
  now += 1001;
  assert.equal(store.getActiveRound("session:one").expired, true);
  assert.equal(store.getActiveRound("session:one"), null);
  assert.equal(store.getRound("round-active"), null);
});

test("runtime draw store file is gitignored", () => {
  const ignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  assert.match(ignore, /runtime-data\/draw-rounds\.json\*/);
});
