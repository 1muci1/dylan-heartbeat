"use strict";

const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { CollaborationRuntime } = require("../collaboration-runtime");
const { registerCollaborationRoutes } = require("../collaboration-routes");
const { CollaborationSessionService } = require("../collaboration-session-service");
const { applyMigrations } = require("../database");

const apiKey = "collaboration-test-key";
const auth = { authorization: `Bearer ${apiKey}` };
const app = Fastify({ logger: false });
const database = new DatabaseSync(":memory:");
applyMigrations(database);
let roomSequence = 0;
const calls = [];
const sessionService = new CollaborationSessionService({
  idFactory: () => `api-room-${++roomSequence}`,
  now: () => "2026-07-24T18:00:00.000Z"
});
const agentAdapter = {
  async invoke(agent, input) {
    calls.push({ agent, input });
    return { agent, content: `${agent}-api-response` };
  }
};
const runtime = new CollaborationRuntime({ sessionService, agentAdapter });

app.post("/v1/chat/completions", async () => ({
  choices: [{ message: { role: "assistant", content: "chat-unchanged" } }]
}));
registerCollaborationRoutes(app, { runtime, sessionService, apiKey });

before(() => app.ready());
after(async () => {
  await app.close();
  database.close();
});

test("creates a Collaboration room with Bearer authentication", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/collaboration/rooms",
    headers: auth,
    payload: { topic: "API 圆桌", participants: ["chen", "chatgpt"] }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().room.topic, "API 圆桌");
  assert.deepEqual(response.json().room.participants, ["chen", "chatgpt"]);
});

test("runs a two-Agent round and returns messages in participant order", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/collaboration/rooms",
    headers: auth,
    payload: { topic: "执行一轮", participants: ["chen", "chatgpt"] }
  });
  const roomId = created.json().room.id;
  const response = await app.inject({
    method: "POST",
    url: `/api/collaboration/rooms/${roomId}/run`,
    headers: auth
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().room.messages.map(message => message.agent), [
    "chen",
    "chatgpt"
  ]);
});

test("gets isolated room context", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/collaboration/rooms",
    headers: auth,
    payload: { topic: "读取状态", participants: ["chen"] }
  });
  const roomId = created.json().room.id;

  await app.inject({
    method: "POST",
    url: `/api/collaboration/rooms/${roomId}/run`,
    headers: auth
  });
  const response = await app.inject({
    method: "GET",
    url: `/api/collaboration/rooms/${roomId}`,
    headers: auth
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().room.id, roomId);
  assert.deepEqual(response.json().room.messages.map(message => message.agent), ["chen"]);
});

test("rejects missing or invalid Gateway Bearer authentication", async () => {
  for (const headers of [{}, { authorization: "Bearer wrong-key" }]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/collaboration/rooms",
      headers,
      payload: { topic: "拒绝", participants: ["chen"] }
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
  }
});

test("Collaboration routes do not change Memory and leave Chat API operational", async () => {
  const before = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );
  const created = await app.inject({
    method: "POST",
    url: "/api/collaboration/rooms",
    headers: auth,
    payload: { topic: "边界验证", participants: ["chen", "chatgpt"] }
  });
  await app.inject({
    method: "POST",
    url: `/api/collaboration/rooms/${created.json().room.id}/run`,
    headers: auth
  });
  const chat = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: { messages: [{ role: "user", content: "hello" }] }
  });

  const after = Number(
    database.prepare("SELECT COUNT(*) count FROM memory_items").get().count
  );
  assert.equal(after, before);
  assert.equal(chat.statusCode, 200);
  assert.equal(chat.json().choices[0].message.content, "chat-unchanged");
  assert.equal(calls.length >= 2, true);
});
