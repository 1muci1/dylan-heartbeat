"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { applyMigrations } = require("../database");
const { EventStore } = require("../event-store");
const {
  GAME_EVENT_SOURCE,
  GAME_EVENT_TYPES,
  GameEventService,
  answerRecentGameQuestion,
  buildRecentGameContext,
  isRecentGameQuestion
} = require("../game-event-service");

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  t.after(() => database.close());
  const eventStore = new EventStore({ database });
  return { database, eventStore, service: new GameEventService({ eventStore }) };
}

test("supported game events are written through EventStore without creating Memory", t => {
  const { database, service } = fixture(t);
  const beforeMemories = Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count);

  for (const eventType of GAME_EVENT_TYPES.filter(type => type !== "game_result")) {
    const event = service.create({
      eventType,
      title: `game-${eventType}`,
      metadata: { value: "safe", attemptCount: 1 }
    });
    assert.equal(event.eventType, eventType);
    assert.equal(event.category, "game");
    assert.equal(event.source, GAME_EVENT_SOURCE);
    assert.deepEqual(event.payload.metadata, { value: "safe", attemptCount: 1 });
  }

  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM events WHERE category='game'").get().count), 3);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), beforeMemories);
});

test("non-game sources remain forbidden", t => {
  const { eventStore, service } = fixture(t);
  assert.throws(
    () => service.create({ eventType: "mood_selected", title: "mood", metadata: {} }, { source: "gateway" }),
    error => error.code === "GAME_EVENT_SOURCE_FORBIDDEN"
  );
  assert.throws(
    () => eventStore.create({ eventType: "mood_selected", payload: {} }, { source: "gateway" }),
    error => error.code === "EVENT_SOURCE_FORBIDDEN"
  );
});

test("game event input is strict and rejects Memory or sensitive metadata fields", t => {
  const { service } = fixture(t);
  assert.throws(
    () => service.create({ eventType: "unknown", title: "invalid", metadata: {} }),
    error => error.code === "GAME_EVENT_INVALID"
  );
  assert.throws(
    () => service.create({ eventType: "mood_selected", title: "mood", metadata: {}, memory: "write" }),
    /不允许传入字段/
  );
  assert.throws(
    () => service.create({ eventType: "mood_selected", title: "mood", metadata: { token: "hidden" } }),
    error => error.code === "GAME_EVENT_METADATA_FORBIDDEN"
  );
});

function gameResult(index = 1) {
  return {
    eventType: "game_result",
    title: "五子棋结果",
    metadata: {
      game: "gomoku",
      winner: index % 2 ? "user" : "chen",
      moves: 20 + index,
      chenMoveCount: 10,
      chenSourceCount: 8,
      fallbackCount: 2,
      fallbackReasons: ["MODEL_TIMEOUT"],
      endedAt: new Date(Date.UTC(2026, 7, 7, 0, 0, index)).toISOString(),
      summary: `第 ${index} 局五子棋摘要`
    }
  };
}

test("game_result is stored through EventStore and recent context is capped at 20", t => {
  const { database, service } = fixture(t);
  for (let index = 1; index <= 25; index += 1) service.create(gameResult(index));
  const recent = service.recentResults(20);
  assert.equal(recent.length, 20);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM events WHERE event_type='game_result'").get().count), 25);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), 0);
  assert.equal(recent[0].game, "gomoku");
  assert.equal(recent[0].fallbackReasons[0], "MODEL_TIMEOUT");
});

test("game_result rejects board, history, prompt, raw response and credential fields", t => {
  const { service } = fixture(t);
  for (const [field, value] of [
    ["board", [[0]]], ["moveHistory", []], ["prompt", "hidden"],
    ["rawResponse", "hidden"], ["apiKey", "hidden"], ["authorization", "hidden"]
  ]) {
    const input = gameResult();
    input.metadata[field] = value;
    assert.throws(() => service.create(input), error => error.code === "GAME_RESULT_FIELD_FORBIDDEN");
  }
});

test("recent game questions use saved facts and never invent a missing result", () => {
  assert.equal(isRecentGameQuestion("刚刚那局有记忆吗"), true);
  assert.equal(isRecentGameQuestion("刚刚谁赢了"), true);
  assert.equal(isRecentGameQuestion("今天吃什么"), false);
  const result = gameResult().metadata;
  assert.match(answerRecentGameQuestion([result]), /五子棋/);
  assert.match(answerRecentGameQuestion([result]), /辞辞赢了/);
  assert.match(answerRecentGameQuestion([result]), /21 步/);
  assert.match(buildRecentGameContext([result]).content, /MODEL_TIMEOUT/);
  assert.match(answerRecentGameQuestion([]), /没有保存到结果记录里/);
  assert.doesNotMatch(answerRecentGameQuestion([]), /辞辞赢了|我赢了|平局/);
});
