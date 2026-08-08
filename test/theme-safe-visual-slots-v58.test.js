"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ACTIVE_KEY, DEFAULT_THEME, ThemeStore, cssVariables, normalizeTheme } = require("../frontend-p4b/assets/js/theme-store.js");

const root = path.join(__dirname, "..", "frontend-p4b");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const asset = "/api/theme/assets/11111111-1111-4111-8111-111111111111";

function storageWith(value) {
  const values = new Map([[ACTIVE_KEY, JSON.stringify(value)]]);
  return { values, storage: { getItem: key => values.get(key) || null, setItem: (key, next) => values.set(key, next) } };
}

test("v58 migrates a v57 active theme to disabled image decoration while preserving colors", () => {
  const legacy = { ...DEFAULT_THEME, tokens: { ...DEFAULT_THEME.tokens, colorPrimary: "#123456" }, migratedVisualSlotsSafe: false,
    visualSlots: { pageBackground: { url: asset, enabled: true }, assistantBubbleDecor: { url: asset, enabled: true } } };
  const fixture = storageWith(legacy); const store = new ThemeStore({ storage: fixture.storage, documentRef: null }); const active = store.getActive();
  assert.equal(active.tokens.colorPrimary, "#123456");
  assert.equal(active.visualSlots.pageBackground.enabled, false);
  assert.equal(active.visualSlots.assistantBubbleDecor.enabled, false);
  assert.equal(active.migratedVisualSlotsSafe, true);
  assert.equal(store.lastVisualSlotsMigration, true);
  assert.equal(JSON.parse(fixture.values.get(ACTIVE_KEY)).migratedVisualSlotsSafe, true);
});

test("v58 localized assets default off and only explicit user enabling paints one slot", () => {
  const safe = normalizeTheme({ name: "safe", tokens: {}, assets: {}, layout: {}, visualSlots: { assistantBubbleDecor: { url: asset, enabled: true } } });
  assert.equal(safe.visualSlots.assistantBubbleDecor.enabled, false);
  assert.equal(cssVariables(safe)["--xb-assistant-bubble-decor"], "none");
  const enabled = normalizeTheme({ ...safe, visualSlots: { ...safe.visualSlots, enabledByUser: true, assistantBubbleDecor: { ...safe.visualSlots.assistantBubbleDecor, enabled: true } } });
  assert.match(cssVariables(enabled)["--xb-assistant-bubble-decor"], /11111111/u);
  assert.equal(cssVariables(enabled)["--xb-user-bubble-decor"], "none");
});

test("v58 safe-mode action disables slots without changing theme tokens", () => {
  const js = read("assets/js/theme-workshop.js"); const html = read("theme-workshop.html");
  assert.match(html, /只保留颜色，关闭装饰/u);
  assert.match(js, /data-theme-disable-slots/u);
  assert.match(js, /next\.visualSlots\[key\]\.enabled=false/u);
  assert.doesNotMatch(js.slice(js.indexOf('data-theme-disable-slots'), js.indexOf('data-theme-export')), /next\.tokens\s*=/u);
});

test("v58 theme CSS no longer rewrites direct children of layout shells", () => {
  const css = read("assets/css/theme.css");
  assert.doesNotMatch(css, /\.chat-shell\s*>\s*\*[^{}]*\{[^}]*position\s*:/u);
  assert.doesNotMatch(css, /\.home-shell\s*>\s*\*[^{}]*\{[^}]*position\s*:/u);
  assert.doesNotMatch(css, /\.settings-shell\s*>\s*\*[^{}]*\{[^}]*z-index\s*:/u);
  assert.doesNotMatch(css, /\.composer\s*>\s*\*[^{}]*\{[^}]*position\s*:/u);
  for (const selector of [".chat-main", ".message-list", ".session-drawer"]) {
    const rules = [...css.matchAll(new RegExp(`${selector.replace(".", "\\.")}[^{}]*\\{([^}]*)\\}`, "gu"))].map(match => match[1]).join(";");
    assert.doesNotMatch(rules, /background-image|position\s*:|display\s*:|overflow\s*:|height\s*:/u, selector);
  }
});

test("v58 decorations are bounded, noninteractive, and performance mode hides them", () => {
  const css = read("assets/css/theme.css");
  const decorativeRules = [...css.matchAll(/[^{}]*(?:::before|::after)[^{}]*\{([^}]*(?:--xb-|var\(--xb-)[^}]*)\}/gu)].map(match => match[1]).join(";");
  assert.match(decorativeRules, /position:absolute/u);
  assert.match(decorativeRules, /pointer-events:none/u);
  assert.match(decorativeRules, /max-width/u);
  assert.match(decorativeRules, /max-height/u);
  assert.match(decorativeRules, /contain:paint/u);
  assert.match(css, /\[data-theme-effects=performance\][^{]*\.message-bubble::before/u);
});

test("v58 drawer receives theme colors but never visual-slot images", () => {
  const css = read("assets/css/theme.css");
  const drawer = css.match(/html\.has-xinban-theme \.session-drawer[^{}]*\{([^}]*)\}/u)?.[1] || "";
  assert.match(drawer, /background:/u);
  assert.doesNotMatch(drawer, /--xb-(?:bg-image|header-decor|bubble|avatar|input-decor|home-card|nav-accent)|background-image/u);
});
