"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const Fastify = require("fastify");
const { applyMigrations } = require("../database");
const { EventStore } = require("../event-store");
const { registerGameEventRoutes } = require("../game-event-routes");
const { GameEventService } = require("../game-event-service");

function fixture(t, options = {}) {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  const eventStore = new EventStore({ database });
  const app = Fastify({ logger: false });
  registerGameEventRoutes(app, {
    service: new GameEventService({ eventStore }),
    suggestionStore: options.suggestionStore || null,
    apiKey: "game-token"
  });
  t.after(async () => {
    await app.close();
    database.close();
  });
  return { app, database };
}

test("POST /api/game/events creates a game Event only", async t => {
  const { app, database } = fixture(t);
  const response = await app.inject({
    method: "POST",
    url: "/api/game/events",
    headers: { authorization: "Bearer game-token" },
    payload: {
      eventType: "mood_selected",
      title: "选择今日心情",
      metadata: { mood: "平静" }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().event.eventType, "mood_selected");
  assert.equal(response.json().event.source, "game-event-service");
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM events").get().count), 1);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), 0);
});

test("game Event API requires auth and cannot accept source or Memory writes", async t => {
  const { app, database } = fixture(t);
  const unauthorized = await app.inject({
    method: "POST",
    url: "/api/game/events",
    payload: { eventType: "room_interaction", title: "整理小屋", metadata: {} }
  });
  assert.equal(unauthorized.statusCode, 401);

  for (const forbidden of [
    { source: "gateway" },
    { memory: { content: "not allowed" } }
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/game/events",
      headers: { authorization: "Bearer game-token" },
      payload: {
        eventType: "room_interaction",
        title: "整理小屋",
        metadata: {},
        ...forbidden
      }
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM events").get().count), 0);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), 0);
});

test("POST /api/game/events accepts only a safe game_result summary", async t => {
  const suggestions = [];
  const { app, database } = fixture(t, { suggestionStore: {
    suggestGameResult(metadata) {
      suggestions.push(metadata);
      return { suggestion: { id: "suggestion-1", status: "pending", title: "辞辞和沉玩了一局五子棋" } };
    }
  } });
  const response = await app.inject({
    method: "POST",
    url: "/api/game/events",
    headers: { authorization: "Bearer game-token" },
    payload: {
      eventType: "game_result",
      title: "五子棋结果",
      metadata: {
        game: "gomoku", winner: "user", moves: 23, chenMoveCount: 11,
        chenSourceCount: 8, fallbackCount: 3, fallbackReasons: ["MODEL_TIMEOUT"],
        endedAt: "2026-08-07T00:00:00.000Z",
        summary: "辞辞和沉下了一局五子棋，辞辞赢了。"
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().event.eventType, "game_result");
  assert.equal(response.json().memorySuggestion.status, "pending");
  assert.equal(suggestions.length, 1);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), 0);
  assert.doesNotMatch(JSON.stringify(response.json()), /board|moveHistory|prompt|rawResponse|apiKey|authorization/i);
});
