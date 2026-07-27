"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  ChatSyncController,
  chooseServerSession,
  lastServerMessageId
} = require("../frontend-p4b/assets/js/chat-sync");

const localStore = (initial) => {
  let session = structuredClone(initial);
  return {
    async loadSession(id) {
      return id === session.id ? structuredClone(session) : null;
    },
    async saveMessages(id, messages) {
      assert.equal(id, session.id);
      session.messages = structuredClone(messages);
      return structuredClone(session);
    },
    async updateSyncState(id, changes) {
      assert.equal(id, session.id);
      session = { ...session, ...structuredClone(changes) };
      return structuredClone(session);
    },
    snapshot() {
      return structuredClone(session);
    }
  };
};

const serverApi = (sessions, histories) => ({
  createCalls: 0,
  async list() {
    return structuredClone(sessions);
  },
  async create(title) {
    this.createCalls += 1;
    const created = { id: "server-created", title, updatedAt: "2026-07-27T12:00:00Z" };
    sessions.unshift(created);
    histories[created.id] = [];
    return structuredClone(created);
  },
  async messages(id) {
    return structuredClone(histories[id] || []);
  }
});

const serverMessages = [
  { id: 10, role: "user", content: "服务器消息", createdAt: "2026-07-27T11:59:00Z" },
  { id: 11, role: "assistant", content: "服务器回复", createdAt: "2026-07-27T12:00:00Z" }
];
const mapMessage = message => ({
  id: `server-message-${message.id}`,
  role: message.role,
  content: message.content,
  timestamp: message.createdAt,
  time: "12:00",
  type: "text"
});

test("local session keeps and prioritizes its bound server session", async () => {
  const local = localStore({
    id: "local-1",
    title: "最近会话",
    serverSessionId: "server-bound",
    messages: [{ id: "old", role: "user", content: "本地缓存" }]
  });
  const api = serverApi([
    { id: "server-newest", title: "最新" },
    { id: "server-bound", title: "已绑定" }
  ], { "server-bound": serverMessages });
  const sync = new ChatSyncController({
    historyStore: local,
    sessionApi: api,
    localSessionId: "local-1",
    mapMessage,
    clock: () => new Date("2026-07-27T12:01:00Z")
  });

  const result = await sync.connect();
  assert.equal(result.serverSessionId, "server-bound");
  assert.equal(api.createCalls, 0);
  assert.equal(local.snapshot().serverSessionId, "server-bound");
  assert.equal(local.snapshot().syncState, "synced");
  await sync.select("server-newest");
  assert.equal(local.snapshot().serverSessionId, "server-newest");
});

test("server history replaces stale local cache and records the sync cursor", async () => {
  const local = localStore({
    id: "local-1",
    title: "最近会话",
    serverSessionId: null,
    messages: [{ id: "local-only", role: "assistant", content: "旧缓存" }]
  });
  const api = serverApi([{ id: "server-recent", title: "最近服务器会话" }], {
    "server-recent": serverMessages
  });
  const sync = new ChatSyncController({
    historyStore: local,
    sessionApi: api,
    localSessionId: "local-1",
    mapMessage,
    clock: () => new Date("2026-07-27T12:01:00Z")
  });

  await sync.connect();
  assert.deepEqual(local.snapshot().messages.map(message => message.content), ["服务器消息", "服务器回复"]);
  assert.equal(local.snapshot().lastServerMessageId, 11);
  assert.equal(local.snapshot().lastSyncedAt, "2026-07-27T12:01:00.000Z");
});

test("two devices without bindings select the same most recent server session", async () => {
  const sessions = [{ id: "shared-session", title: "共同会话" }];
  const histories = { "shared-session": serverMessages };
  const api = serverApi(sessions, histories);
  const devices = ["phone", "computer"].map(id => localStore({
    id,
    title: "最近会话",
    serverSessionId: null,
    messages: []
  }));

  const results = await Promise.all(devices.map((historyStore, index) => new ChatSyncController({
    historyStore,
    sessionApi: api,
    localSessionId: index ? "computer" : "phone",
    mapMessage
  }).connect()));

  assert.deepEqual(results.map(result => result.serverSessionId), ["shared-session", "shared-session"]);
  assert.deepEqual(devices.map(device => device.snapshot().serverSessionId), ["shared-session", "shared-session"]);
  assert.equal(api.createCalls, 0);
});

test("empty server creates one session and sync helpers use server ordering", async () => {
  assert.equal(chooseServerSession([{ id: "recent" }], null).id, "recent");
  assert.equal(lastServerMessageId([{ id: 2 }, { id: 9 }, { id: "bad" }]), 9);
  const local = localStore({ id: "local-1", title: "本地会话", serverSessionId: null, messages: [] });
  const api = serverApi([], {});
  const result = await new ChatSyncController({
    historyStore: local,
    sessionApi: api,
    localSessionId: "local-1",
    mapMessage
  }).connect();
  assert.equal(result.serverSessionId, "server-created");
  assert.equal(api.createCalls, 1);
});

test("chat integration only pulls server replies and keeps X-Session-Id flow", () => {
  const root = path.join(__dirname, "..", "frontend-p4b");
  const html = fs.readFileSync(path.join(root, "chat.html"), "utf8");
  const chat = fs.readFileSync(path.join(root, "assets/js/chat.js"), "utf8");
  assert.match(html, /assets\/js\/chat-sync\.js/);
  assert.match(chat, /ChatSyncController/);
  assert.match(chat, /headers:[\s\S]*"X-Session-Id": activeSessionId/);
  assert.match(chat, /await chatSync\.pull\(\)/);
  assert.doesNotMatch(chat, /chatSync\.(?:push|upload|replay)/);
});
