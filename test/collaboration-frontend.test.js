"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..", "ai-companion-frontend", "collaboration");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const collaboration = require(path.join(root, "collaboration.js"));
const {
  CollaborationProviderStore,
  DEFAULT_MODEL,
  STORAGE_KEY
} = require(path.join(root, "collaboration-provider-store.js"));

const roomPayload = {
  room: {
    id: "room-api-1",
    topic: "怎样建设圆桌？",
    participants: ["chen", "chatgpt"],
    createdAt: "2026-07-24T00:00:00.000Z",
    messages: [
      { id: "message-1", agent: "chen", content: "沉的观点" },
      { id: "message-2", agent: "chatgpt", content: "ChatGPT 的观点" }
    ],
    summary: "双方形成了一份讨论总结。"
  },
  error: null
};

function appConfig() {
  return {
    getProviderConfig() {
      return {
        baseUrl: "https://gateway.example.test/",
        auth: { type: "bearer", token: "test-bearer-token" }
      };
    }
  };
}

function jsonResponse(payload = roomPayload, ok = true) {
  return { ok, json: async () => payload };
}

test("Collaboration page loads AppConfig and remains independent from chat.js", () => {
  const html = read("index.html");
  for (const file of ["collaboration.css", "collaboration.js"]) {
    assert.ok(fs.existsSync(path.join(root, file)));
    assert.match(html, new RegExp(file.replace(".", "\\.")));
  }
  assert.match(html, /\/assets\/js\/data\.js/);
  assert.match(html, /Gateway API/);
  assert.match(html, /data-room-form/);
  assert.match(html, /collaboration-provider-store\.js/);
  assert.doesNotMatch(html, /react|vue|angular|provider\.js|chat\.js/i);
});

test("each council AI exposes global or custom masked Provider configuration", () => {
  const html = read("index.html");
  for (const agentId of ["chen", "chatgpt"]) {
    assert.match(html, new RegExp(`data-configure-agent="${agentId}"`));
  }
  assert.match(html, /配置此 AI/);
  assert.match(html, /使用全局模型配置/);
  assert.match(html, /使用单独 Provider 配置/);
  for (const field of ["baseUrl", "endpoint", "token", "model", "enabled"]) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.match(html, /name="token" type="password"/);
});

test("seat Provider config uses a versioned local schema and restores after refresh", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const first = new CollaborationProviderStore({ storage });
  first.save("chen", {
    source: "custom",
    type: "gateway",
    enabled: true,
    baseUrl: "https://seat.example",
    endpoint: "/v1/chat/completions",
    model: "seat-model",
    auth: { type: "bearer", token: "not-printed" }
  });
  const restored = new CollaborationProviderStore({ storage }).get("chen");
  assert.equal(STORAGE_KEY, "xinban-collaboration-provider-config-v1");
  assert.equal(restored.source, "custom");
  assert.equal(restored.model, "seat-model");
  assert.equal(Boolean(restored.auth.token), true);
  assert.equal(new CollaborationProviderStore({ storage }).get("chatgpt").model, DEFAULT_MODEL);
});

test("API configuration uses AppConfig baseUrl and Bearer token", async () => {
  const requests = [];
  let configReads = 0;
  const client = collaboration.createApiClient({
    appConfig: {
      getProviderConfig() {
        configReads++;
        return appConfig().getProviderConfig();
      }
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse();
    }
  });

  await client.getRoom("room-api-1");

  assert.equal(configReads, 1);
  assert.equal(requests[0].url, "https://gateway.example.test/api/collaboration/rooms/room-api-1");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-bearer-token");
  assert.equal(requests[0].options.cache, "no-store");
});

test("room creation and run use the fixed Collaboration API methods", async () => {
  const requests = [];
  const client = collaboration.createApiClient({
    appConfig: appConfig(),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse();
    }
  });

  const created = await client.createRoom({
    topic: "  怎样建设圆桌？ ",
    participants: ["chen", "chatgpt"]
  });
  await client.runRoom(created.id);

  assert.equal(requests[0].url, "https://gateway.example.test/api/collaboration/rooms");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    topic: "怎样建设圆桌？",
    participants: ["chen", "chatgpt"]
  });
  assert.equal(
    requests[1].url,
    "https://gateway.example.test/api/collaboration/rooms/room-api-1/run"
  );
  assert.equal(requests[1].options.method, "POST");
});

test("renders chen and chatgpt messages with textContent", () => {
  const room = collaboration.normalizeRoom(roomPayload.room);
  const created = [];
  const documentRef = {
    createElement(tagName) {
      const element = {
        tagName,
        children: [],
        dataset: {},
        attributes: {},
        className: "",
        textContent: "",
        append(...children) { this.children.push(...children); },
        setAttribute(name, value) { this.attributes[name] = value; }
      };
      created.push(element);
      return element;
    }
  };
  const container = {
    children: [],
    append(element) { this.children.push(element); }
  };

  room.messages.forEach(message =>
    collaboration.renderMessage(documentRef, container, message)
  );

  assert.equal(container.children.length, 2);
  assert.ok(container.children.some(element => element.className.includes("message--chen")));
  assert.ok(container.children.some(element => element.className.includes("message--chatgpt")));
  assert.ok(created.some(element => element.tagName === "p" && element.textContent === "沉的观点"));
  assert.equal(collaboration.summarizeRoom(room), "双方形成了一份讨论总结。");
  assert.doesNotMatch(read("collaboration.js"), /innerHTML|console\.(?:log|info|debug)/);
});

test("API failures use stable errors and never fabricate mock messages", async () => {
  const client = collaboration.createApiClient({
    appConfig: appConfig(),
    fetchImpl: async () => jsonResponse({
      room: null,
      error: { code: "COLLABORATION_UNAVAILABLE", message: "服务不可用" }
    }, false)
  });

  await assert.rejects(
    client.runRoom("room-api-1"),
    error => error.code === "COLLABORATION_UNAVAILABLE" && error.message === "服务不可用"
  );
  const source = read("collaboration.js");
  assert.doesNotMatch(source, /mockDiscussion|生成模拟讨论|先从陪伴体验出发/);
  assert.match(source, /当前房间内容已保留/);
});

test("Collaboration Room retains mobile-first layout rules", () => {
  const html = read("index.html");
  const css = read("collaboration.css");
  assert.match(html, /width=device-width/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.match(css, /minmax\(0, 1fr\)/);
});
