"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("Service Worker controller change refreshes only once per v61 tab session", async () => {
  const source = read("frontend-p4b/assets/js/common.js");
  const session = new Map();
  const listeners = {};
  let reloads = 0;
  let updates = 0;
  const windowRef = {
    location: { reload: () => { reloads += 1; } },
    sessionStorage: {
      getItem: key => session.get(key) || null,
      setItem: (key, value) => session.set(key, value)
    }
  };
  const documentRef = {
    addEventListener() {},
    querySelector() { return null; }
  };
  const navigatorRef = {
    serviceWorker: {
      addEventListener(type, listener) { listeners[type] = listener; },
      register: async () => ({ update: async () => { updates += 1; } })
    }
  };
  vm.runInNewContext(source, {
    window: windowRef,
    document: documentRef,
    navigator: navigatorRef,
    Object, Promise
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates, 1);
  assert.equal(typeof listeners.controllerchange, "function");
  listeners.controllerchange();
  listeners.controllerchange();
  assert.equal(reloads, 1);
  assert.equal(session.get("p4b-sw-controller-refresh-v77"), "1");
  assert.equal(windowRef.XINBAN_BUILD, "v77-p4b");
});

test("legacy nested chat file statically replaces to the formal root entry", () => {
  const html = read("frontend-p4b/frontend-p4b/chat.html");
  assert.match(html, /http-equiv="refresh" content="0;url=\/chat\.html"/);
  assert.match(html, /location\.replace\("\/chat\.html"\)/);
  assert.doesNotMatch(html, /assets\/(?:js|css)|Authorization|fetch\(/u);
});

test("chat recovery hooks reapply model badge, avatars, and background without rebuilding state", () => {
  const chat = read("frontend-p4b/assets/js/chat.js");
  for (const event of ["pageshow", "focus", "visibilitychange", "storage", "provider-config-change", "user-preferences-change"]) {
    assert.match(chat, new RegExp(`addEventListener\\("${event}"`));
  }
  assert.match(chat, /CompanionModelSwitcher\?\.refresh/);
  assert.match(chat, /CompanionChatAvatars\?\.apply/);
  assert.match(chat, /CompanionChatPreferences\?\.apply/);
  const recovery = chat.slice(chat.indexOf("const reapplyUiState"));
  assert.doesNotMatch(recovery, /saveState|createInitialState|clearPendingFiles/);
});

test("Provider save leaves avatar preferences intact and emits no token value", () => {
  const source = read("frontend-p4b/assets/js/data.js");
  const avatarPreferences = JSON.stringify({
    avatar: {
      userAvatar: { imageData: "data:image/png;base64,user" },
      chenAvatar: { imageData: "data:image/png;base64,chen" }
    }
  });
  const values = new Map([["xinban-user-preferences-v1", avatarPreferences]]);
  const events = [];
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }
  const context = {
    window: { dispatchEvent: event => events.push(event) },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value))
    },
    CustomEvent: TestCustomEvent,
    JSON, Object, String, Boolean, Set
  };
  vm.runInNewContext(source, context);
  context.window.AppConfig.saveProviderConfig({
    type: "dylan",
    mode: "real",
    baseUrl: "https://gateway.example",
    endpoint: "/v1/chat/completions",
    model: "custom-model",
    displayName: "自定义模型",
    supportsImages: true,
    auth: { token: "fixture-secret" }
  });
  assert.equal(values.get("xinban-user-preferences-v1"), avatarPreferences);
  const providerEvent = events.find(event => event.type === "provider-config-change");
  assert.equal(providerEvent.detail.tokenConfigured, true);
  assert.equal(Object.hasOwn(providerEvent.detail, "token"), false);
  const preferenceEvent = events.find(event => event.type === "user-preferences-change");
  assert.equal(Object.hasOwn(preferenceEvent.detail, "preferences"), false);
});

test("settings diagnostic is allowlisted and never includes secret or image payload fields", () => {
  const html = read("frontend-p4b/settings.html");
  const settings = read("frontend-p4b/assets/js/settings.js");
  assert.match(html, /data-copy-provider-diagnostic/);
  for (const field of [
    "appVersion", "swCacheName", "providerConfigured", "modelConfigured",
    "displayNameConfigured", "tokenConfigured", "supportsImages", "badgeText",
    "userAvatarExists", "chenAvatarExists", "sourceKey"
  ]) assert.match(settings, new RegExp(`${field}:`));
  const diagnostic = settings.slice(settings.indexOf("const buildSafeDiagnostic"), settings.indexOf("window.CompanionSettingsDiagnostics"));
  assert.doesNotMatch(diagnostic, /imageData|background|messages|auth:\s|token:\s/);
  assert.match(diagnostic, /tokenConfigured:\s*Boolean/);
});

test("P4B pages register early and legacy home redirects without old runtime assets", () => {
  for (const page of ["frontend-p4b/chat.html", "frontend-p4b/settings.html"]) {
    const html = read(page);
    assert.ok(html.indexOf("assets/js/common.js") < html.indexOf("assets/js/data.js"));
  }
  const home = read("ai-companion-frontend/home/index.html");
  assert.match(home, /location\.replace\("\/index\.html"\)/);
  assert.doesNotMatch(home, /home\.js\?v=37|theme-engine\.js/);
});

test("Provider quota failure preserves old config and emits no success event", () => {
  const source = read("frontend-p4b/assets/js/data.js");
  const previous = JSON.stringify({
    model: "old-model",
    displayName: "Old",
    supportsImages: false,
    auth: { token: "old-secret" }
  });
  let stored = previous;
  const events = [];
  class TestCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }
  const quota = Object.assign(new Error("secret data:image/png;base64,BAD"), { name: "QuotaExceededError" });
  const context = {
    window: { dispatchEvent: event => events.push(event) },
    localStorage: {
      getItem: () => stored,
      setItem(_key, value) {
        if (value !== previous) throw quota;
        stored = value;
      },
      removeItem() {}
    },
    CustomEvent: TestCustomEvent,
    JSON, Object, String, Boolean, Set
  };
  vm.runInNewContext(source, context);
  assert.throws(
    () => context.window.AppConfig.saveProviderConfig({
      model: "new-model",
      displayName: "New",
      supportsImages: true,
      auth: { token: "new-secret" }
    }),
    error => error.code === "STORAGE_QUOTA_EXCEEDED" && !/secret|base64/iu.test(error.message)
  );
  assert.equal(stored, previous);
  assert.equal(events.some(event => event.type === "provider-config-change"), false);
});

test("mobile chat uses one bottom-nav reservation without repeating the safe area in composer", () => {
  const css = read("frontend-p4b/assets/css/chat.css");
  assert.match(css, /--chat-safe-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(css, /--chat-bottom-nav-height:\s*calc\(var\(--nav-height\) \+ var\(--chat-safe-bottom\)\)/);
  assert.match(css, /\.chat-shell\s*\{[^}]*padding-bottom:\s*var\(--chat-bottom-nav-height\)/s);
  assert.match(css, /\.bottom-nav--chat\s*\{[^}]*height:\s*var\(--chat-bottom-nav-height\)/s);
  assert.match(css, /\.bottom-nav--chat\s*\{[^}]*padding-bottom:\s*calc\(8px \+ var\(--chat-safe-bottom\)\)/s);
  const composerRule = css.match(/\.composer\s*\{[^}]*\}/s)?.[0] || "";
  assert.match(composerRule, /padding:\s*11px 14px 12px/);
  assert.doesNotMatch(composerRule, /safe-area-inset-bottom|chat-safe-bottom|chat-bottom-nav-height/);
  const messageListRule = css.match(/\.message-list\s*\{[^}]*\}/s)?.[0] || "";
  assert.doesNotMatch(messageListRule, /safe-area-inset-bottom|nav-height|chat-bottom-nav-height/);
  assert.match(css, /@media \(min-width: 521px\)[\s\S]*\.chat-shell/);
});
