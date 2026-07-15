"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const Fastify = require("fastify");
const { SessionStore } = require("../session-store");
const { beginSessionTurn, createSseAccumulator } = require("../chat-session-persistence");

const tempDirs = [];

async function fixture() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-chat-turn-"));
  tempDirs.push(dir);
  const store = new SessionStore({ filename: path.join(dir, "sessions.sqlite") });
  const app = Fastify({ logger: false });
  app.post("/chat", async req => {
    const sessionId = req.headers["x-session-id"] || "";
    const turn = beginSessionTurn(store, sessionId, req.body.messages, value => String(value || ""));
    if (req.body.failure) {
      turn?.fail("", "UPSTREAM_HTTP_502");
      return { failed: true };
    }
    if (req.body.interrupted) {
      turn?.interrupt("partial");
      return { interrupted: true };
    }
    if (req.body.stream) {
      const accumulator = createSseAccumulator();
      accumulator.push(Buffer.from('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'));
      accumulator.push(Buffer.from('data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'));
      const observed = accumulator.finish();
      turn?.complete(observed.content);
      return observed;
    }
    turn?.complete("hello");
    return { choices: [{ message: { role: "assistant", content: "hello" } }] };
  });
  await app.ready();
  return { app, store };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.promises.rm(dir, { recursive: true, force: true })));
});

test("requests without X-Session-Id retain the legacy non-persistent behavior", async t => {
  const { app, store } = await fixture();
  t.after(async () => { await app.close(); store.close(); });
  const response = await app.inject({
    method: "POST", url: "/chat", payload: { stream: false, messages: [{ role: "user", content: "legacy" }] }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].message.content, "hello");
  assert.deepEqual(store.listSessions(), []);
});

test("stream:true and stream:false persist completed assistant messages", async t => {
  const { app, store } = await fixture();
  t.after(async () => { await app.close(); store.close(); });
  for (const stream of [true, false]) {
    const session = store.createSession(stream ? "Stream" : "JSON");
    const response = await app.inject({
      method: "POST", url: "/chat", headers: { "x-session-id": session.id },
      payload: { stream, messages: [{ role: "user", content: `user-${stream}` }] }
    });
    assert.equal(response.statusCode, 200);
    const history = store.listMessages(session.id);
    assert.deepEqual(history.messages.map(message => [message.role, message.content, message.status]), [
      ["user", `user-${stream}`, "completed"],
      ["assistant", "hello", "completed"]
    ]);
  }
});

test("interrupted and upstream-error replies are never marked completed", async t => {
  const { app, store } = await fixture();
  t.after(async () => { await app.close(); store.close(); });
  for (const field of ["interrupted", "failure"]) {
    const session = store.createSession(field);
    await app.inject({
      method: "POST", url: "/chat", headers: { "x-session-id": session.id },
      payload: { [field]: true, messages: [{ role: "user", content: field }] }
    });
    const assistant = store.listMessages(session.id).messages.at(-1);
    assert.equal(assistant.role, "assistant");
    assert.equal(assistant.status, field === "interrupted" ? "interrupted" : "error");
  }
});
