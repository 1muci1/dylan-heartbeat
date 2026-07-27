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
const DEFAULT_MODEL = "claude-opus-4-6";
const LEGACY_DEFAULT_MODEL = "[脆卷-kiro-0.08]claude-opus-4-6-thinking";

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
  let mirroredModel = null;
  const preferences = { saveModel(id) { mirroredModel = id; } };
  const switcher = new ModelSwitcher({ configStore: config, modelRegistry: require("../frontend-p4b/assets/js/model-registry"), preferenceStore: preferences });
  const result = switcher.select("gpt-5");
  assert.equal(result.model, "gpt-5");
  assert.equal(result.defaultModel, "gpt-5");
  assert.equal(result.baseUrl, "https://example.test");
  assert.deepEqual(result.auth, { token: "keep" });
  assert.equal("memory" in result, false);
  assert.equal(mirroredModel, "gpt-5");
});

test("Provider config is the only source used to display the current model", () => {
  const config = fixture({ model: DEFAULT_MODEL, mode: "real" });
  const stalePreferences = { loadSync: () => ({ model: { selectedModelId: "gpt-5" } }) };
  const switcher = new ModelSwitcher({
    configStore: config,
    modelRegistry: require("../frontend-p4b/assets/js/model-registry"),
    preferenceStore: stalePreferences
  });
  assert.equal(switcher.current().id, DEFAULT_MODEL);
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
  assert.match(settings, /src="\/storage\/user-preference-store\.js"/);
  assert.doesNotMatch(settings, /ai-companion-frontend\/storage\/user-preference-store\.js/);
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
    model: LEGACY_DEFAULT_MODEL,
    defaultModel: LEGACY_DEFAULT_MODEL,
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

test("a saved Provider model survives refresh and matches the switcher and chat body", () => {
  const dataSource = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "assets", "js", "data.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "assets", "js", "api.js"), "utf8");
  const values = new Map();
  const localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const createContext = () => ({
    window: {}, localStorage, JSON, Object, String, Boolean, Array, TypeError, Set, AbortController
  });
  const firstPage = createContext();
  vm.runInNewContext(dataSource, firstPage);
  firstPage.window.AppConfig.saveProviderConfig({
    mode: "real",
    baseUrl: "https://example.test",
    model: DEFAULT_MODEL,
    defaultModel: DEFAULT_MODEL,
    auth: { token: "test-only" }
  });

  const refreshedPage = createContext();
  vm.runInNewContext(dataSource, refreshedPage);
  const refreshedConfig = refreshedPage.window.AppConfig.getProviderConfig();
  assert.equal(refreshedConfig.model, DEFAULT_MODEL);
  const switcher = new ModelSwitcher({
    configStore: refreshedPage.window.AppConfig,
    modelRegistry: require("../frontend-p4b/assets/js/model-registry"),
    preferenceStore: { loadSync: () => ({ model: { selectedModelId: "gpt-5" } }) }
  });
  assert.equal(switcher.current().id, DEFAULT_MODEL);

  refreshedPage.window.MessageProtocol = {
    toOpenAIMessages: history => history,
    createUserMessage: content => ({ role: "user", content })
  };
  refreshedPage.window.AppProvider = { send() {}, stream() {} };
  vm.runInNewContext(apiSource, refreshedPage);
  const body = refreshedPage.window.AppAPI.buildRequestBody([{ role: "user", content: "测试" }], true);
  assert.equal(body.model, DEFAULT_MODEL);
});
