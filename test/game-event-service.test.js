"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { applyMigrations } = require("../database");
const { EventStore } = require("../event-store");
const {
  GAME_EVENT_SOURCE,
  GAME_EVENT_TYPES,
  GameEventService
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

  for (const eventType of GAME_EVENT_TYPES) {
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
