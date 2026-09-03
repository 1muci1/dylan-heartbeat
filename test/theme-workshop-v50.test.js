"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  ACTIVE_KEY, LIBRARY_KEY, DEFAULT_THEME, PRESET_THEMES, ThemeStore,
  normalizeTheme, safeCustomCss, contrastRatio, cssVariables
} = require("../frontend-p4b/assets/js/theme-store.js");

function storageFixture(values = {}) {
  const data = new Map(Object.entries(values));
  return { getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), data };
}

function documentFixture() {
  const values = new Map();
  const styleNode = { textContent: "" };
  const root = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) }, dataset: {} };
  return { values, styleNode, document: { documentElement: root, head: { append() {} },
    getElementById: () => styleNode, createElement: () => styleNode } };
}

test("v56 ThemeStore loads and migrates the default theme without old localStorage", () => {
  const storage = storageFixture(); const fixture = documentFixture();
  const store = new ThemeStore({ storage, documentRef: fixture.document });
  const active = store.applyActive();
  assert.equal(active.id, DEFAULT_THEME.id);
  assert.ok(storage.data.has(ACTIVE_KEY));
  assert.equal(fixture.values.get("--theme-primary"), DEFAULT_THEME.tokens.colorPrimary);
  assert.equal(PRESET_THEMES.length >= 5, true);
});

test("contrast guard separates user and assistant text and repairs white-on-white themes", () => {
  const theme = normalizeTheme({ ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens,
    chatUserBubbleBg: "#111111", chatUserBubbleText: "#ffffff",
    chatAssistantBubbleBg: "rgba(255,255,255,.9)", chatAssistantBubbleText: "#ffffff" } });
  assert.equal(theme.tokens.chatUserBubbleText, "#ffffff");
  assert.notEqual(theme.tokens.chatAssistantBubbleText, "#ffffff");
  assert.ok(contrastRatio(theme.tokens.chatAssistantBubbleText, theme.tokens.chatAssistantBubbleBg, theme.tokens.colorBg) >= 4.5);
  for (const preset of PRESET_THEMES.map(item => normalizeTheme(item))) {
    assert.ok(contrastRatio(preset.tokens.chatUserBubbleText, preset.tokens.chatUserBubbleBg, preset.tokens.colorBg) >= 4.5, `${preset.name} user`);
    assert.ok(contrastRatio(preset.tokens.chatAssistantBubbleText, preset.tokens.chatAssistantBubbleBg, preset.tokens.colorBg) >= 4.5, `${preset.name} assistant`);
    assert.ok(contrastRatio(preset.tokens.cardText, preset.tokens.cardBg, preset.tokens.colorBg) >= 4.5, `${preset.name} card`);
  }
});

test("performance mode clamps effects while draft normalization does not persist activeTheme", () => {
  const storage = storageFixture(); const fixture = documentFixture(); const store = new ThemeStore({ storage, documentRef: fixture.document });
  const draft = normalizeTheme({ ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, blur: "40px" }, layout: { ...DEFAULT_THEME.layout, effectsMode: "performance", blurNav: "36px", shadowLevel: "medium" } });
  assert.equal(storage.data.has(ACTIVE_KEY), false);
  const variables = cssVariables(draft);
  assert.equal(variables["--theme-blur-nav"], "0px");
  assert.equal(variables["--theme-shadow-soft"], "none");
  assert.equal(variables["--theme-blur"], "2px");
  store.applyTheme(draft);
  assert.equal(storage.data.has(ACTIVE_KEY), true);
});

test("applyTheme writes visual CSS variables without touching unrelated preferences", () => {
  const storage = storageFixture({ "xinban-user-preferences-v1": "avatar-and-background-kept", "xinban-provider-config-v1": "provider-kept" });
  const fixture = documentFixture(); const store = new ThemeStore({ storage, documentRef: fixture.document });
  store.applyTheme({ ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, colorPrimary: "#123456", radiusBubble: "30px" } });
  assert.equal(fixture.values.get("--theme-primary"), "#123456");
  assert.equal(fixture.values.get("--theme-radius-bubble"), "30px");
  assert.equal(storage.data.get("xinban-user-preferences-v1"), "avatar-and-background-kept");
  assert.equal(storage.data.get("xinban-provider-config-v1"), "provider-kept");
});

test("theme import filters unknown fields, rejects active content, previews without auto-apply, and exports v1", () => {
  const storage = storageFixture(); const fixture = documentFixture(); const store = new ThemeStore({ storage, documentRef: fixture.document });
  const imported = store.importTheme({ type: "xinban-theme", themeVersion: 1, theme: {
    ...DEFAULT_THEME, name: "导入主题", secret: "ignored", tokens: { ...DEFAULT_THEME.tokens, unknown: "ignored" }
  } });
  assert.equal(imported.secret, undefined);
  assert.equal(imported.tokens.unknown, undefined);
  assert.equal(storage.data.has(ACTIVE_KEY), false);
  assert.equal(JSON.parse(storage.data.get(LIBRARY_KEY)).length, 1);
  assert.deepEqual(Object.keys(store.exportTheme(imported)).sort(), ["theme", "themeVersion", "type"]);
  for (const css of ["script{}", "@import 'x.css'", ".x{background:url(https://evil.test/x)}", "body{position:fixed;inset:0}", "*{pointer-events:none}"]) {
    assert.throws(() => safeCustomCss(css));
  }
  assert.throws(() => normalizeTheme({ ...DEFAULT_THEME, assets: { ...DEFAULT_THEME.assets, backgroundImage: "https://evil.test/x.png" } }));
});

test("theme workshop is linked, live-preview driven, and every main page loads theme variables", () => {
  const root = path.join(__dirname, "..", "frontend-p4b");
  const workshop = fs.readFileSync(path.join(root, "theme-workshop.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "assets/js/theme-workshop.js"), "utf8");
  const settings = fs.readFileSync(path.join(root, "settings.html"), "utf8");
  assert.match(settings, /href="theme-workshop\.html"/);
  assert.match(workshop, /data-theme-preview/);
  assert.match(workshop, /data-theme-import/);
  assert.match(workshop, /data-theme-export/);
  assert.match(script, /addEventListener\("input"/);
  assert.match(script, /requestAnimationFrame/);
  assert.match(workshop, /data-theme-fix-readability/);
  assert.match(workshop, /data-theme-layout="effectsMode"/);
  assert.match(script, /applyTheme/);
  for (const page of ["index.html", "chat.html", "dashboard.html", "settings.html", "memory.html", "stickers.html"]) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    assert.match(html, /assets\/css\/theme\.css\?v=v76-p4b/, page);
    assert.match(html, /assets\/js\/theme-store\.js\?v=v76-p4b/, page);
  }
});
