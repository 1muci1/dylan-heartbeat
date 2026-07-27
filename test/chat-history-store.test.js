"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ChatHistoryStore } = require("../frontend-p4b/storage/chat-history-store");

const request = action => {
  const result = {};
  queueMicrotask(() => {
    try {
      result.result = action();
      result.onsuccess?.();
    } catch (error) {
      result.error = error;
      result.onerror?.();
    }
  });
  return result;
};

const fakeIndexedDB = () => {
  const records = new Map();
  const objectStore = {
    put(value) {
      return request(() => {
        records.set(value.id, structuredClone(value));
        return value.id;
      });
    },
    get(id) {
      return request(() => records.has(id) ? structuredClone(records.get(id)) : undefined);
    },
    getAll() {
      return request(() => [...records.values()].map(value => structuredClone(value)));
    },
    delete(id) {
      return request(() => records.delete(id));
    }
  };
  const database = {
    objectStoreNames: { contains: () => false },
    createObjectStore() {
      return { createIndex() {} };
    },
    transaction() {
      return { objectStore: () => objectStore };
    }
  };
  return {
    open() {
      const openRequest = {};
      queueMicrotask(() => {
        openRequest.result = database;
        openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    }
  };
};

const message = (id, role, content, extra = {}) => ({
  id,
  role,
  content,
  time: "12:00",
  timestamp: `2026-07-27T12:00:0${id}Z`,
  ...extra
});

test("ChatHistoryStore creates, saves, restores, lists, and deletes sessions", async () => {
  let tick = 0;
  const store = new ChatHistoryStore({
    indexedDB: fakeIndexedDB(),
    databaseName: "test-chat-history",
    createId: () => String(++tick),
    clock: () => new Date(`2026-07-27T12:00:0${tick}Z`)
  });
  const first = await store.createSession("第一段对话");
  const second = await store.createSession("第二段对话");
  await store.saveMessages(first.id, [
    message("1", "user", "你好"),
    message("2", "assistant", "我在")
  ]);

  assert.deepEqual((await store.loadSession(first.id)).messages.map(item => item.content), ["你好", "我在"]);
  assert.deepEqual((await store.listSessions()).map(item => item.id), [first.id, second.id]);
  assert.equal((await store.listSessions())[0].messageCount, 2);
  assert.equal(await store.deleteSession(first.id), true);
  assert.equal(await store.loadSession(first.id), null);
  assert.equal(await store.deleteSession(first.id), false);
});

test("ChatHistoryStore only persists message fields and excludes credentials", async () => {
  const store = new ChatHistoryStore({
    indexedDB: fakeIndexedDB(),
    createId: () => "safe",
    clock: () => new Date("2026-07-27T12:00:00Z")
  });
  const session = await store.createSession();
  await store.saveMessages(session.id, [
    message("1", "user", "safe content", {
      token: "secret-token",
      apiKey: "secret-key",
      authorization: "Bearer secret",
      provider: { auth: { token: "nested-secret" } }
    })
  ]);
  const serialized = JSON.stringify(await store.loadSession(session.id));
  assert.doesNotMatch(serialized, /secret|token|apiKey|authorization|Bearer/i);
  assert.match(serialized, /safe content/);
});

test("chat page loads IndexedDB history before chat runtime and saves both sides", () => {
  const root = path.join(__dirname, "..", "frontend-p4b");
  const html = fs.readFileSync(path.join(root, "chat.html"), "utf8");
  const chat = fs.readFileSync(path.join(root, "assets/js/chat.js"), "utf8");
  assert.ok(html.indexOf("storage/chat-history-store.js") < html.indexOf("assets/js/chat.js"));
  assert.match(chat, /initializeLocalHistory/);
  assert.match(chat, /persistLocalMessages\(savedState\.messages\)/);
  assert.match(chat, /initializeLocalHistory\(initialState\.messages\)\.finally\(initializeSessions\)/);
});
