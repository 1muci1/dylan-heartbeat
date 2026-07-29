"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DrawGameService } = require("../draw-game-service");
const {
  ACTIVE_DRAW_MODE,
  GameTools,
  activeDrawScopeId,
  detectDrawGameIntent,
  extractActiveDrawGuess,
  resolveActiveDrawGameTurn,
  resolveDrawGameIntentTool
} = require("../game-tools");
const { createMemoryDrawRoundStore } = require("./support/draw-round-store");

function fixture() {
  const store = createMemoryDrawRoundStore();
  const service = new DrawGameService({ store, random: () => 0 });
  const internalTools = new GameTools({ service });
  const calls = [];
  const callMcpTool = async (name, input) => {
    calls.push({ name, input });
    if (name === "draw_start") {
      const result = internalTools.execute(name, {
        artist: input.artist,
        answer: input.answer
      });
      return {
        ...result,
        gameUrl: `/game/#draw?roundId=${encodeURIComponent(result.roundId)}`
      };
    }
    if (name === "draw_guess") {
      const result = internalTools.execute(name, {
        roundId: input.roundId,
        content: input.guess,
        guesser: input.guesser
      });
      return result.ok
        ? { ok: true, guessed: result.result === "猜对了", message: result.result }
        : result;
    }
    throw new Error("unexpected tool");
  };
  return { calls, callMcpTool, internalTools, service, store };
}

async function startRound(f, sessionId = "session-1") {
  const result = await resolveDrawGameIntentTool({
    intent: detectDrawGameIntent("沉你画我猜"),
    sessionId,
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  return result;
}

test("chat draw_start saves a session-scoped active round with safe runtime metadata", async () => {
  const f = fixture();
  const started = await startRound(f);
  const active = f.store.getActiveRound(activeDrawScopeId("session-1"));
  assert.equal(active.roundId, started.roundId);
  assert.equal(active.mode, ACTIVE_DRAW_MODE);
  assert.equal(active.source, "chat");
  assert.equal(typeof active.created_at, "string");
  assert.equal(typeof active.updated_at, "string");
  assert.equal(typeof active.expires_at, "string");
  assert.equal(Object.hasOwn(active, "answer"), false);
  assert.equal(Object.hasOwn(active, "aliases"), false);
});

test("active round extracts explicit guesses and sends draw_guess through MCP", async () => {
  const f = fixture();
  const started = await startRound(f);
  assert.equal(extractActiveDrawGuess("我猜是猫"), "猫");
  assert.equal(extractActiveDrawGuess("是猫吗"), "猫");
  assert.equal(extractActiveDrawGuess("应该是小狗吧"), "小狗");

  const turn = await resolveActiveDrawGameTurn({
    content: "我猜是雨伞",
    sessionId: "session-1",
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  assert.equal(turn.response, "还不是这个。要不要再猜一次？");
  assert.deepEqual(f.calls.at(-1), {
    name: "draw_guess",
    input: { roundId: started.roundId, guess: "雨伞", guesser: "user" }
  });
  assert.doesNotMatch(JSON.stringify(turn), /小猫|猫咪|answer|aliases/i);
});

test("a correct chat guess clears the active round", async () => {
  const f = fixture();
  const started = await startRound(f);
  const turn = await resolveActiveDrawGameTurn({
    content: "答案是猫",
    sessionId: "session-1",
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  assert.equal(turn.response, "猜对啦，就是这个。沉认真记下这一局。");
  assert.equal(f.store.getActiveRound(activeDrawScopeId("session-1")), null);
  assert.equal(f.store.getRecentRound(activeDrawScopeId("session-1")).roundId, started.roundId);
});

test("hints disclose only answer length and never the private answer", async () => {
  const f = fixture();
  await startRound(f);
  const turn = await resolveActiveDrawGameTurn({
    content: "给我提示",
    sessionId: "session-1",
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  assert.match(turn.response, /答案是 1 个字/);
  assert.doesNotMatch(turn.response, /猫|小猫|猫咪/);
  assert.equal(f.calls.filter(call => call.name === "draw_guess").length, 0);
});

test("restart creates a new MCP round and replaces the active pointer", async () => {
  const f = fixture();
  const first = await startRound(f);
  const turn = await resolveActiveDrawGameTurn({
    content: "再来一局",
    sessionId: "session-1",
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  const active = f.store.getActiveRound(activeDrawScopeId("session-1"));
  assert.equal(turn.toolName, "draw_start");
  assert.notEqual(active.roundId, first.roundId);
  assert.match(turn.response, new RegExp(encodeURIComponent(active.roundId)));
});

test("restart remains available briefly after a correct guess", async () => {
  const f = fixture();
  await startRound(f);
  await resolveActiveDrawGameTurn({
    content: "猫",
    sessionId: "session-1",
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  assert.equal(f.store.getActiveRound(activeDrawScopeId("session-1")), null);
  const restarted = await resolveActiveDrawGameTurn({
    content: "换一个",
    sessionId: "session-1",
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  assert.equal(restarted.toolName, "draw_start");
  assert.ok(f.store.getActiveRound(activeDrawScopeId("session-1")));
});

test("ordinary, memory and image chat do not trigger draw_guess", async () => {
  const f = fixture();
  for (const content of ["今天好累", "你还记得我什么", "陪我说说话", "我想睡觉了"]) {
    assert.equal(await resolveActiveDrawGameTurn({
      content,
      sessionId: "session-1",
      store: f.store,
      service: f.service,
      callMcpTool: f.callMcpTool,
      internalTools: f.internalTools
    }), null);
  }
  await startRound(f);
  assert.equal(await resolveActiveDrawGameTurn({
    content: "猫",
    sessionId: "session-1",
    hasImages: true,
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  }), null);
});

test("an expired active pointer is cleared and receives a friendly reply", async () => {
  const f = fixture();
  const scopeId = activeDrawScopeId("session-1");
  f.store.getActiveRound = scope => scope === scopeId
    ? { roundId: "expired", mode: ACTIVE_DRAW_MODE, expired: true }
    : null;
  const turn = await resolveActiveDrawGameTurn({
    content: "我猜是猫",
    sessionId: "session-1",
    store: f.store,
    service: f.service,
    callMcpTool: f.callMcpTool,
    internalTools: f.internalTools
  });
  assert.equal(turn.response, "这一局画作已经失效了，我们重新开一局吧。");
});

test("without an active round, a bare noun or ordinary sentence stays normal chat", async () => {
  const f = fixture();
  for (const content of ["猫", "猫真可爱", "今天好累", "再来一局", "换一个"]) {
    assert.equal(await resolveActiveDrawGameTurn({
      content,
      sessionId: "session-1",
      store: f.store,
      service: f.service,
      callMcpTool: f.callMcpTool,
      internalTools: f.internalTools
    }), null);
  }
  assert.equal(f.calls.length, 0);
});

test("Gateway wires Session, image safety and local completion into draw continuation", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /await resolveActiveDrawGameTurn\(\{/);
  assert.match(server, /sessionId,/);
  assert.match(server, /hasImages: hasImageContent\(originalMessages\)/);
  assert.match(server, /store: drawGameService\.store/);
  assert.match(server, /callMcpTool: callDrawMcpTool/);
  assert.match(server, /if \(activeDrawTurn\?\.handled\)/);
  assert.match(server, /sendLocalAssistantCompletion\(\{/);
});
