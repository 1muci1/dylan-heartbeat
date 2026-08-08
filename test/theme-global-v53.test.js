"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ACTIVE_KEY, DEFAULT_THEME, ThemeStore } = require("../frontend-p4b/assets/js/theme-store.js");
const root = path.join(__dirname, "..", "frontend-p4b");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("chat loads the global theme after its legacy CSS and real chat selectors use tokens", () => {
  const html = read("chat.html"); const css = read("assets/css/theme.css");
  assert.ok(html.indexOf("assets/css/chat.css?v=v61-p4b") < html.indexOf("assets/css/theme.css?v=v61-p4b"));
  assert.match(html, /assets\/js\/theme-store\.js\?v=v61-p4b/u);
  for (const selector of [".chat-shell", ".chat-header", ".message-row .message-bubble", ".message-row--user .message-bubble", ".composer", ".composer .composer__field", ".bottom-nav"]) assert.ok(css.includes(selector), selector);
  assert.match(css, /html\.has-xinban-theme \.message-row--user \.message-bubble/u);
  assert.match(css, /var\(--theme-user-bubble\)/u); assert.match(css, /var\(--theme-assistant-bubble\)/u);
  assert.ok(css.indexOf("html.has-xinban-theme .message-row .message-bubble") > css.indexOf(".message-bubble{"));
});

test("applyActiveTheme writes documentElement, stable classes and an application event", () => {
  const variables = new Map(), classes = new Set(), events = [];
  const classList = { add: (...items) => items.forEach(item => classes.add(item)), remove: (...items) => items.forEach(item => classes.delete(item)) };
  const view = { CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, dispatchEvent: event => events.push(event) };
  const documentElement = { style: { setProperty: (key, value) => variables.set(key, value), removeProperty: key => variables.delete(key) }, dataset: {}, classList };
  const documentRef = { documentElement, body: { classList }, defaultView: view, getElementById: () => ({ textContent: "" }), createElement: () => ({ textContent: "" }), head: { append() {} } };
  const storage = { getItem: key => key === ACTIVE_KEY ? JSON.stringify({ ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, colorPrimary: "#7650aa" } }) : null, setItem() {} };
  const theme = new ThemeStore({ storage, documentRef }).applyActiveTheme();
  assert.equal(theme.tokens.colorPrimary, "#7650aa"); assert.equal(variables.get("--theme-primary"), "#7650aa");
  assert.ok(classes.has("has-xinban-theme")); assert.ok(classes.has("theme-effects-balanced"));
  assert.equal(events.at(-1).type, "xinban:theme-applied");
});

test("workshop applies globally, offers recovery and keeps user background preferences separate", () => {
  const store = read("assets/js/theme-store.js"), workshop = read("assets/js/theme-workshop.js"), html = read("theme-workshop.html"), preferences = read("assets/js/chat-preferences.js");
  assert.match(store, /applyActiveTheme\(\)/u); assert.match(store, /target: this\.document\?\.documentElement/u);
  assert.match(store, /xinban:theme-applied/u); assert.match(store, /addEventListener\?\.\("storage"/u);
  assert.match(workshop, /store\.applyTheme\(draft, \{ persist: true/u); assert.match(workshop, /聊天页也会同步生效/u);
  assert.match(html, /data-theme-reset-soft/u); assert.match(html, /href="\/chat\.html"/u);
  assert.match(preferences, /--chat-bg-image/u); assert.doesNotMatch(store, /xinban-user-preferences-v1/u);
});

test("all principal pages share one ThemeStore active key and v53 cache", () => {
  for (const page of ["chat.html", "settings.html", "theme-workshop.html", "index.html", "dashboard.html", "memory.html", "stickers.html"]) {
    const html = read(page); assert.match(html, /assets\/js\/theme-store\.js\?v=v61-p4b/u, page); assert.match(html, /assets\/css\/theme\.css\?v=v61-p4b/u, page);
  }
  assert.match(read("sw.js"), /xinban-shell-v61-p4b/u);
  assert.equal(ACTIVE_KEY, "xinban-theme-active-v1");
  assert.equal(DEFAULT_THEME.tokens.colorBg, "#171326");
});

test("legacy dirty yellow active themes migrate to purple mist without touching assets", () => {
  let saved = ""; const legacy = { ...DEFAULT_THEME, harmonyVersion: undefined, tokens: { ...DEFAULT_THEME.tokens, colorBg: "rgba(178,164,112,.92)" }, assets: { ...DEFAULT_THEME.assets, chatBackgroundImage: "/uploads/kept.webp" } };
  const storage = { getItem: () => JSON.stringify(legacy), setItem: (key, value) => { if (key === ACTIVE_KEY) saved = value; } };
  const theme = new ThemeStore({ storage, documentRef: null }).getActive();
  assert.equal(theme.tokens.colorBg, "#171326"); assert.equal(theme.assets.chatBackgroundImage, "/uploads/kept.webp");
  assert.equal(JSON.parse(saved).harmonyVersion, 2);
});
