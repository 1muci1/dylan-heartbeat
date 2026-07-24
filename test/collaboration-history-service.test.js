"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { CollaborationHistoryService } = require("../collaboration-history-service");

function fixture() {
  let sequence = 0;
  return new CollaborationHistoryService({
    idFactory: () => `history-${++sequence}`,
    now: () => "2026-07-24T22:00:00.000Z"
  });
}

function record(overrides = {}) {
  return {
    roomId: "room-1",
    topic: "如何建设议事厅",
    participants: ["chen", "chatgpt"],
    summary: "双方完成了一轮讨论，并形成结构化议事记录。",
    ...overrides
  };
}

test("creates an in-memory Council history record with a timestamp", () => {
  const service = fixture();
  const saved = service.save(record());

  assert.deepEqual(saved, {
    id: "history-1",
    roomId: "room-1",
    topic: "如何建设议事厅",
    participants: ["chen", "chatgpt"],
    summary: "双方完成了一轮讨论，并形成结构化议事记录。",
    createdAt: "2026-07-24T22:00:00.000Z"
  });
});

test("lists history and gets one record by id", () => {
  const service = fixture();
  const first = service.save(record());
  const second = service.save(record({
    roomId: "room-2",
    topic: "第二个议题",
    summary: "第二份记录。"
  }));

  assert.deepEqual(service.list().map(item => item.id), [first.id, second.id]);
  assert.deepEqual(service.get(second.id), second);
  assert.equal(service.get("missing-history"), null);
});

test("room-filtered history remains isolated across multiple rooms", () => {
  const service = fixture();
  service.save(record({ summary: "房间一的第一份记录。" }));
  service.save(record({ summary: "房间一的第二份记录。" }));
  service.save(record({
    roomId: "room-2",
    topic: "独立房间",
    participants: ["chatgpt"],
    summary: "房间二的记录。"
  }));

  const firstRoom = service.list({ roomId: "room-1" });
  const secondRoom = service.list({ roomId: "room-2" });
  assert.equal(firstRoom.length, 2);
  assert.ok(firstRoom.every(item => item.roomId === "room-1"));
  assert.deepEqual(secondRoom.map(item => item.roomId), ["room-2"]);
});

test("rejects Memory and Identity Context instead of storing leaked content", () => {
  const service = fixture();
  const secret = "private-memory-value";

  assert.throws(
    () => service.save(record({
      summary: `<memory_reference_data>${secret}</memory_reference_data>`
    })),
    error => error.code === "COLLABORATION_HISTORY_CONTEXT_FORBIDDEN"
  );
  assert.throws(
    () => service.save(record({
      topic: `<identity_reference_data>${secret}</identity_reference_data>`
    })),
    error => error.code === "COLLABORATION_HISTORY_CONTEXT_FORBIDDEN"
  );
  assert.deepEqual(service.list(), []);
});

test("save, get, and list return isolated copies", () => {
  const service = fixture();
  const saved = service.save(record());
  saved.topic = "changed";
  saved.participants.push("changed");
  const fetched = service.get(saved.id);
  fetched.summary = "changed";
  const listed = service.list();
  listed[0].participants.length = 0;
  listed.length = 0;

  assert.equal(service.get(saved.id).topic, "如何建设议事厅");
  assert.deepEqual(service.get(saved.id).participants, ["chen", "chatgpt"]);
  assert.equal(
    service.get(saved.id).summary,
    "双方完成了一轮讨论，并形成结构化议事记录。"
  );
  assert.equal(service.list().length, 1);
});

test("History Service has no Memory, chat history, Runtime, network, or database integration", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "collaboration-history-service.js"),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /StructuredMemoryStore|MemoryWriter|SessionStore|ChatHistory|CollaborationRuntime|EventStore|fetch\s*\(|database|migration/i
  );
  assert.doesNotMatch(source, /\.(?:create|update|delete|archive)\s*\(/);
});
