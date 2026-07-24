"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  COLLABORATION_AGENTS,
  CollaborationSessionService
} = require("../collaboration-session-service");

function fixture() {
  let sequence = 0;
  return new CollaborationSessionService({
    idFactory: () => `room-${++sequence}`,
    now: () => "2026-07-24T12:00:00.000Z"
  });
}

test("creates an in-memory room for the supported Agents", () => {
  const service = fixture();
  const room = service.createRoom("如何整理今天的计划？", ["chen", "chatgpt"]);

  assert.equal(room.id, "room-1");
  assert.equal(room.topic, "如何整理今天的计划？");
  assert.deepEqual(room.participants, COLLABORATION_AGENTS);
  assert.deepEqual(room.messages, []);
  assert.equal(room.summary, null);
});

test("adds messages from both room participants with strict input", () => {
  const service = fixture();
  const room = service.createRoom("讨论主题", ["chen", "chatgpt"]);

  service.addMessage(room.id, { agent: "chen", content: "先明确目标。" });
  service.addMessage(room.id, { agent: "chatgpt", content: "再列出行动项。" });

  assert.deepEqual(
    service.getContext(room.id).messages.map(message => [message.agent, message.content]),
    [["chen", "先明确目标。"], ["chatgpt", "再列出行动项。"]]
  );
  assert.throws(
    () => service.addMessage(room.id, { agent: "other", content: "不允许" }),
    error => error.code === "COLLABORATION_AGENT_FORBIDDEN"
  );
  assert.throws(
    () => service.addMessage(room.id, { agent: "chen", content: "内容", memory: true }),
    /不允许字段/
  );
});

test("keeps room contexts isolated and returns defensive copies", () => {
  const service = fixture();
  const first = service.createRoom("第一个主题", ["chen"]);
  const second = service.createRoom("第二个主题", ["chatgpt"]);
  service.addMessage(first.id, { agent: "chen", content: "仅属于第一个房间" });

  const firstContext = service.getContext(first.id);
  firstContext.messages[0].content = "外部修改";
  firstContext.participants.push("chatgpt");

  assert.equal(service.getContext(first.id).messages[0].content, "仅属于第一个房间");
  assert.deepEqual(service.getContext(first.id).participants, ["chen"]);
  assert.deepEqual(service.getContext(second.id).messages, []);
});

test("generates a deterministic local summary without a model call", () => {
  const service = fixture();
  const room = service.createRoom("圆桌总结", ["chen", "chatgpt"]);
  service.addMessage(room.id, { agent: "chen", content: "观点一" });
  service.addMessage(room.id, { agent: "chatgpt", content: "观点二" });

  const summary = service.generateSummary(room.id);

  assert.equal(summary.roomId, room.id);
  assert.equal(summary.messageCount, 2);
  assert.deepEqual(summary.participantMessageCounts, { chen: 1, chatgpt: 1 });
  assert.match(summary.summary, /已完成 2 条讨论消息/);
  assert.equal(service.getContext(room.id).summary, summary.summary);
});

test("service has no chat runtime or Memory write integration", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "collaboration-session-service.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /StructuredMemoryStore|MemoryWriter|EventStore|fetch\s*\(/);
  assert.doesNotMatch(source, /\.(?:create|update|delete|archive)\s*\(/);
});
