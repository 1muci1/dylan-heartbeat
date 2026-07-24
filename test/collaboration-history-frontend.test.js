"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(
  __dirname,
  "..",
  "ai-companion-frontend",
  "collaboration",
  "history"
);
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const history = require(path.join(root, "history.js"));
const record = {
  id: "history-1",
  roomId: "room-1",
  topic: "议事厅主题",
  participants: ["chen", "chatgpt"],
  summary: "这是一份真实议事摘要。",
  createdAt: "2026-07-24T22:00:00.000Z"
};

function appConfig() {
  return {
    getProviderConfig() {
      return {
        baseUrl: "https://gateway.example.test/",
        auth: { type: "bearer", token: "history-test-token" }
      };
    }
  };
}

function element(tagName = "div") {
  return {
    tagName,
    type: "",
    className: "",
    dataset: {},
    children: [],
    textContent: "",
    listeners: {},
    append(...children) { this.children.push(...children); },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    replaceChildren(...children) { this.children = children; }
  };
}

test("History page loads as an independent authenticated frontend page", () => {
  const html = read("index.html");
  for (const file of ["history.css", "history.js"]) {
    assert.ok(fs.existsSync(path.join(root, file)));
    assert.match(html, new RegExp(file.replace(".", "\\.")));
  }
  assert.match(html, /\/assets\/js\/data\.js/);
  assert.match(html, /data-history-list/);
  assert.match(html, /data-history-detail/);
  assert.doesNotMatch(html, /chat\.js|provider\.js/i);
});

test("History list API uses AppConfig, Bearer auth, and renders records", async () => {
  const requests = [];
  const client = history.createApiClient({
    appConfig: appConfig(),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ records: [record], error: null }) };
    }
  });
  const records = await client.list();
  const documentRef = { createElement: tagName => element(tagName) };
  const container = element();
  history.renderHistoryItem(documentRef, container, records[0], () => {});

  assert.equal(requests[0].url, "https://gateway.example.test/api/collaboration/history");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.Authorization, "Bearer history-test-token");
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].children[0].textContent, "议事厅主题");
});

test("single History detail API and renderer expose the allowed fields", async () => {
  const requests = [];
  const client = history.createApiClient({
    appConfig: appConfig(),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ record, error: null }) };
    }
  });
  const value = await client.get("history-1");
  const nodes = {
    "[data-history-detail]": { hidden: true },
    "[data-detail-topic]": element(),
    "[data-detail-created-at]": element("time"),
    "[data-detail-summary]": element(),
    "[data-detail-participants]": element()
  };
  const documentRef = {
    querySelector: selector => nodes[selector] || null,
    createElement: tagName => element(tagName)
  };
  history.renderDetail(documentRef, value);

  assert.equal(
    requests[0].url,
    "https://gateway.example.test/api/collaboration/history/history-1"
  );
  assert.equal(nodes["[data-history-detail]"].hidden, false);
  assert.equal(nodes["[data-detail-topic]"].textContent, record.topic);
  assert.equal(nodes["[data-detail-summary]"].textContent, record.summary);
  assert.deepEqual(
    nodes["[data-detail-participants]"].children.map(item => item.textContent),
    ["chen", "chatgpt"]
  );
});

test("API failures return stable safe errors without local fallback data", async () => {
  const client = history.createApiClient({
    appConfig: appConfig(),
    fetchImpl: async () => ({
      ok: false,
      json: async () => ({
        records: null,
        error: { code: "HISTORY_UNAVAILABLE", message: "历史服务不可用" }
      })
    })
  });

  await assert.rejects(
    client.list(),
    error => error.code === "HISTORY_UNAVAILABLE" && error.message === "历史服务不可用"
  );
  assert.doesNotMatch(read("history.js"), /localStorage|sessionStorage|innerHTML/);
});

test("History page retains mobile-first layout", () => {
  const html = read("index.html");
  const css = read("history.css");
  assert.match(html, /width=device-width/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.match(css, /min\(100%, 820px\)/);
});
