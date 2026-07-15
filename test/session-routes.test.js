"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const Fastify = require("fastify");
const { SessionStore } = require("../session-store");
const { registerSessionRoutes } = require("../session-routes");

const tempDirs = [];

async function fixture() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-sessions-"));
  tempDirs.push(dir);
  const store = new SessionStore({ filename: path.join(dir, "sessions.sqlite") });
  const app = Fastify({ logger: false });
  registerSessionRoutes(app, { store, apiKey: "session-token" });
  await app.ready();
  return { app, store };
}

function auth(token = "session-token") {
  return { authorization: `Bearer ${token}` };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.promises.rm(dir, { recursive: true, force: true })));
});

test("creates, lists, renames, and deletes sessions", async t => {
  const { app, store } = await fixture();
  t.after(async () => { await app.close(); store.close(); });
  const created = await app.inject({
    method: "POST", url: "/api/v1/chat/sessions", headers: auth(), payload: { title: "First" }
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().session.id;

  const listed = await app.inject({ method: "GET", url: "/api/v1/chat/sessions", headers: auth() });
  assert.deepEqual(listed.json().sessions.map(session => session.title), ["First"]);

  const renamed = await app.inject({
    method: "PATCH", url: `/api/v1/chat/sessions/${id}`, headers: auth(), payload: { title: "Renamed" }
  });
  assert.equal(renamed.json().session.title, "Renamed");

  const deleted = await app.inject({ method: "DELETE", url: `/api/v1/chat/sessions/${id}`, headers: auth() });
  assert.equal(deleted.statusCode, 204);
  assert.deepEqual(store.listSessions(), []);
});

test("message history paginates and sessions remain isolated", async t => {
  const { app, store } = await fixture();
  t.after(async () => { await app.close(); store.close(); });
  const first = store.createSession("First");
  const second = store.createSession("Second");
  store.addMessage(first.id, "user", "first-1");
  store.addMessage(first.id, "assistant", "first-2");
  store.addMessage(first.id, "user", "first-3");
  store.addMessage(second.id, "user", "second-only");

  const pageOne = await app.inject({
    method: "GET", url: `/api/v1/chat/sessions/${first.id}/messages?limit=2`, headers: auth()
  });
  assert.deepEqual(pageOne.json().messages.map(message => message.content), ["first-2", "first-3"]);
  assert.equal(pageOne.json().hasMore, true);

  const pageTwo = await app.inject({
    method: "GET",
    url: `/api/v1/chat/sessions/${first.id}/messages?limit=2&before=${pageOne.json().nextCursor}`,
    headers: auth()
  });
  assert.deepEqual(pageTwo.json().messages.map(message => message.content), ["first-1"]);
  assert.equal(pageTwo.json().hasMore, false);

  const isolated = await app.inject({
    method: "GET", url: `/api/v1/chat/sessions/${second.id}/messages`, headers: auth()
  });
  assert.deepEqual(isolated.json().messages.map(message => message.content), ["second-only"]);
});

test("session APIs reject missing and incorrect tokens", async t => {
  const { app, store } = await fixture();
  t.after(async () => { await app.close(); store.close(); });
  for (const headers of [{}, auth("wrong")]) {
    const response = await app.inject({ method: "GET", url: "/api/v1/chat/sessions", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["www-authenticate"], "Bearer");
  }
});
