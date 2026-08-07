"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  MemorySuggestionStore,
  buildGameSuggestion,
  isMemorySuggestionApproval,
  isMemorySuggestionRejection
} = require("../memory-suggestion-store");

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-suggestions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = new Date("2026-08-07T00:00:00.000Z");
  const memories = [], events = [];
  const store = new MemorySuggestionStore({
    filename: path.join(dir, "memory-suggestions.json"),
    writer: overrides.writer || { create(proposal) { memories.push(proposal); return { id: `memory-${memories.length}` }; } },
    eventStore: { create(input, context) { events.push({ input, context }); return input; } },
    clock: () => now,
    idFactory: (() => { let id = 0; return () => String(++id); })(),
    maxSuggestions: overrides.maxSuggestions || 100
  });
  return { store, memories, events, advance(ms) { now = new Date(now.getTime() + ms); }, filename: store.filename };
}

function game(overrides = {}) {
  return { game: "gomoku", winner: "user", moves: 23, chenSourceCount: 8,
    fallbackCount: 3, fallbackReasons: ["MODEL_TIMEOUT"], ...overrides };
}

test("game_result creates a safe pending suggestion and a bounded Event", t => {
  const f = fixture(t);
  const result = f.store.suggestGameResult(game());
  assert.equal(result.created, true);
  assert.equal(result.suggestion.status, "pending");
  assert.equal(fs.statSync(f.filename).mode & 0o777, 0o600);
  const serialized = fs.readFileSync(f.filename, "utf8");
  assert.doesNotMatch(serialized, /board|moveHistory|prompt|rawResponse|apiKey|authorization|Bearer/i);
  assert.equal(f.events[0].input.eventType, "memory_candidate.created");
  assert.equal(f.events[0].context.source, "memory-candidate");
});

test("suggestions deduplicate matching game outcomes for 24 hours", t => {
  const f = fixture(t);
  assert.equal(f.store.suggestGameResult(game({ moves: 23 })).created, true);
  f.advance(60 * 60 * 1000);
  assert.equal(f.store.suggestGameResult(game({ moves: 31 })).created, false);
  assert.equal(f.store.list().length, 1);
  f.advance(24 * 60 * 60 * 1000);
  assert.equal(f.store.suggestGameResult(game({ moves: 31 })).created, true);
});

test("store retains only its configured maximum up to 100", t => {
  const f = fixture(t, { maxSuggestions: 3 });
  for (let index = 0; index < 5; index++) {
    f.store.suggestGameResult(game({ winner: index % 2 ? "chen" : "user", game: index % 3 ? "gomoku" : "draw" }));
    f.advance(25 * 60 * 60 * 1000);
  }
  assert.equal(f.store.list().length, 3);
});

test("question claim observes cooldown and approve writes through existing Writer", t => {
  const f = fixture(t);
  const pending = f.store.suggestGameResult(game()).suggestion;
  assert.equal(f.store.claimQuestion().id, pending.id);
  assert.equal(f.store.claimQuestion(), null);
  const approved = f.store.approve(pending.id);
  assert.equal(approved.status, "approved");
  assert.equal(f.memories.length, 1);
  assert.equal(f.memories[0].content.length <= 500, true);
  assert.equal(f.events.at(-1).input.eventType, "memory_candidate.approved");
});

test("reject never writes Memory and Writer failure leaves suggestion pending", t => {
  const rejectedFixture = fixture(t);
  const rejectedId = rejectedFixture.store.suggestGameResult(game()).suggestion.id;
  assert.equal(rejectedFixture.store.reject(rejectedId).status, "rejected");
  assert.equal(rejectedFixture.memories.length, 0);

  const failing = fixture(t, { writer: { create() { throw new Error("private failure"); } } });
  const failingId = failing.store.suggestGameResult(game()).suggestion.id;
  assert.throws(() => failing.store.approve(failingId), error => error.code === "MEMORY_WRITE_FAILED");
  assert.equal(failing.store.latestPending().id, failingId);
});

test("proposal sanitizer and approval intents are strict", () => {
  const suggestion = buildGameSuggestion({ ...game(), board: [[0]], moveHistory: [{ row: 1, col: 1 }], prompt: "hidden" });
  assert.doesNotMatch(JSON.stringify(suggestion), /board|moveHistory|prompt|hidden/i);
  assert.equal(isMemorySuggestionApproval("嗯记住"), true);
  for (const phrase of ["那局记下来", "这局记下来", "把刚刚那局记下来", "记下来", "记住这个", "可以记", "对，这个要记", "加到记忆里"]) {
    assert.equal(isMemorySuggestionApproval(phrase), true, phrase);
  }
  assert.equal(isMemorySuggestionApproval("你还记得吗"), false);
  assert.equal(isMemorySuggestionRejection("删掉这条建议"), true);
});
