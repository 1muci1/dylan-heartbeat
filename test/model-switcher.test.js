"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const registrySource = path.join(__dirname, "..", "frontend-p4b", "assets", "js", "model-registry.js");
const switcherSource = path.join(__dirname, "..", "frontend-p4b", "assets", "js", "model-switcher.js");
const { MODELS, byId, isValidId, requireId } = require(registrySource);
const { ModelSwitcher } = require(switcherSource);
const DEFAULT_MODEL = "[脆卷-kiro-0.08]claude-opus-4-6-thinking";

test("Model Registry exposes enabled models with stable metadata", () => {
  assert.ok(MODELS.length >= 2);
  assert.deepEqual(byId(DEFAULT_MODEL).capabilities, ["reasoning", "coding", "long-context"]);
  assert.equal(byId("gpt-5").provider, "OpenAI");
  assert.equal(MODELS.every(model => model.enabled && model.id && model.name && model.provider), true);
  assert.equal(isValidId("not-a-model"), false);
  assert.throws(() => requireId("not-a-model"), error => error.code === "MODEL_ID_INVALID");
});

const fixture = (initial = { model: "claude-opus-4-6", mode: "mock" }) => {
  let config = { ...initial };
  return {
    getProviderConfig() { return { ...config }; },
    saveProviderConfig(next) { config = { ...next }; return { ...config }; },
    snapshot() { return { ...config }; }
  };
};

test("switching a model updates only the compatible Provider config", () => {
  const config = fixture({ model: "claude-opus-4-6", mode: "real", baseUrl: "https://example.test", auth: { token: "keep" } });
  const switcher = new ModelSwitcher({ configStore: config, modelRegistry: require("../frontend-p4b/assets/js/model-registry") });
  const result = switcher.select("gpt-5");
  assert.equal(result.model, "gpt-5");
  assert.equal(result.defaultModel, "gpt-5");
  assert.equal(result.baseUrl, "https://example.test");
  assert.deepEqual(result.auth, { token: "keep" });
  assert.equal("memory" in result, false);
});

test("illegal model IDs are rejected without changing configuration", () => {
  const config = fixture();
  const before = config.snapshot();
  const switcher = new ModelSwitcher({ configStore: config, modelRegistry: require("../frontend-p4b/assets/js/model-registry") });
  assert.throws(() => switcher.select("../../memory"), error => error.code === "MODEL_ID_INVALID");
  assert.deepEqual(config.snapshot(), before);
});

test("auto selection is an explicit preference only", () => {
  const config = fixture();
  const switcher = new ModelSwitcher({ configStore: config });
  assert.equal(switcher.setAutoSelect(true).autoSelectModel, true);
  assert.equal(switcher.setAutoSelect(false).autoSelectModel, false);
});

test("settings and chat consume the registry without changing runtime code", () => {
  const settings = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "settings.html"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "chat.html"), "utf8");
  const switcher = fs.readFileSync(switcherSource, "utf8");
  assert.match(settings, /data-model-list/);
  assert.match(settings, /data-auto-model/);
  assert.match(chat, /data-model-badge/);
  assert.match(settings + chat, /model-registry\.js/);
  assert.doesNotMatch(switcher, /ChatRuntime|MemoryWriter|fetch\s*\(/);
});

test("model UI remains theme-token based", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "assets", "css", "settings.css"), "utf8");
  assert.match(css, /--primary|var\(--primary\)/);
  assert.match(css, /model-option\.is-selected/);
  assert.match(css, /:root\[data-app-style/);
});

test("AppConfig compatibility is preserved by the data normalizer", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "assets", "js", "data.js"), "utf8");
  const context = { window: {}, localStorage: { getItem: () => null, setItem() {} }, JSON, Object, String, Boolean };
  vm.runInNewContext(source, context);
  const config = context.window.AppConfig.getProviderConfig();
  assert.equal(config.model, DEFAULT_MODEL);
  assert.equal(typeof config.autoSelectModel, "boolean");
  assert.equal(typeof context.window.AppConfig.saveProviderConfig, "function");
});

test("legacy default migrates while a user-selected model remains unchanged", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "assets", "js", "data.js"), "utf8");
  let stored = JSON.stringify({
    model: "claude-opus-4-6",
    defaultModel: "claude-opus-4-6",
    mode: "real"
  });
  const context = {
    window: {},
    localStorage: { getItem: () => stored, setItem(_key, value) { stored = value; } },
    JSON, Object, String, Boolean
  };
  vm.runInNewContext(source, context);
  assert.equal(context.window.AppConfig.getProviderConfig().model, DEFAULT_MODEL);

  context.window.AppConfig.saveProviderConfig({
    ...context.window.AppConfig.getProviderConfig(),
    model: "gpt-5",
    defaultModel: "gpt-5"
  });
  assert.equal(context.window.AppConfig.getProviderConfig().model, "gpt-5");
});

test("chat request body uses the migrated frontend default model", () => {
  const dataSource = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "assets", "js", "data.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "assets", "js", "api.js"), "utf8");
  const context = {
    window: {},
    localStorage: { getItem: () => null, setItem() {} },
    JSON, Object, String, Boolean, Array, TypeError, Set, AbortController
  };
  vm.runInNewContext(dataSource, context);
  context.window.MessageProtocol = {
    toOpenAIMessages: history => history.map(({ role, content }) => ({ role, content })),
    createUserMessage: content => ({ role: "user", content })
  };
  context.window.AppProvider = { send() {}, stream() {} };
  vm.runInNewContext(apiSource, context);
  const body = context.window.AppAPI.buildRequestBody([{ role: "user", content: "测试" }], true);
  assert.equal(body.model, DEFAULT_MODEL);
});
