"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const themes = require("../frontend-p4b/assets/js/theme-store.js");

const root = path.join(__dirname, "..", "frontend-p4b");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const local = id => `/api/theme/assets/${id.padEnd(8, "0")}`;

test("v58 only admits localized theme assets into visual slots", () => {
  const theme = themes.normalizeTheme({ name: "Echoes", tokens: {}, assets: {}, layout: {}, visualSlots: {
    pageBackground: { url: local("bg") }, userBubbleDecor: { url: "https://example.com/user.png" },
    assistantBubbleDecor: { url: local("assistant") }, avatarFrame: { url: local("avatar") }, inputDecor: { url: local("input") }
  } });
  assert.equal(theme.visualSlots.pageBackground.url, local("bg"));
  assert.equal(theme.visualSlots.userBubbleDecor.url, "");
  assert.equal(theme.visualSlots.assistantBubbleDecor.url, local("assistant"));
  assert.equal(theme.visualSlots.avatarFrame.url, local("avatar"));
  assert.equal(theme.visualSlots.inputDecor.url, local("input"));
});

test("v58 performance mode disables large and decorative slot variables", () => {
  const url = local("asset");
  const pretty = themes.cssVariables({ name: "pretty", tokens: {}, assets: {}, layout: { effectsMode: "balanced" }, visualSlots: { enabledByUser: true,
    pageBackground: { url, enabled: true }, homeCardDecor: { url, enabled: true }, navAccent: { url, enabled: true }
  } });
  assert.match(pretty["--xb-bg-image"], /api\/theme\/assets/u);
  assert.match(pretty["--xb-home-card-decor"], /api\/theme\/assets/u);
  const fast = themes.cssVariables({ name: "fast", tokens: {}, assets: {}, layout: { effectsMode: "performance" }, visualSlots: { enabledByUser: true,
    pageBackground: { url, enabled: true }, homeCardDecor: { url, enabled: true }, navAccent: { url, enabled: true }
  } });
  assert.equal(fast["--xb-bg-image"], "none");
  assert.equal(fast["--xb-home-card-decor"], "none");
  assert.equal(fast["--xb-nav-accent"], "none");
});

test("v58 localization maps known kinds to disabled slots and saves extras", () => {
  const js = read("assets/js/theme-workshop.js");
  for (const pair of [
    'backgroundImage: "pageBackground"', 'bubbleUserDecoration: "userBubbleDecor"',
    'bubbleAssistantDecoration: "assistantBubbleDecor"', 'avatarFrame: "avatarFrame"',
    'inputDecoration: "inputDecor"', 'headerDecoration: "chatHeaderDecor"',
    'decorativeAsset: "homeCardDecor"', 'navIcon: "navAccent"'
  ]) assert.ok(js.includes(pair), pair);
  assert.match(js, /next\.assetLibrary\.push/u);
  assert.match(js, /!next\.visualSlots\[slot\]\.url/u);
  assert.match(js, /next\.visualSlots\[slot\]\.enabled=false/u);
  assert.match(js, /只保存到素材库/u);
});

test("v58 renders bounded visual slots on chat and home surfaces", () => {
  const css = read("assets/css/theme.css");
  for (const selector of [".chat-header::after", ".message-row--user .message-bubble::after", ".message-row--ai .message-bubble::before", ".composer::after", ".companion-hero::after", ".today-card::before", ".companion-portrait::after"]) assert.ok(css.includes(selector), selector);
  assert.match(css, /pointer-events:none/u);
  assert.match(css, /\.home-shell/u);
  assert.match(css, /\.status-card/u);
  assert.match(css, /theme-effects=performance/u);
});

test("v58 home, dashboard and settings share the global theme runtime", () => {
  for (const page of ["index.html", "dashboard.html", "settings.html"]) {
    const html = read(page);
    assert.match(html, /assets\/css\/theme\.css\?v=v65-p4b/u, page);
    assert.match(html, /assets\/js\/theme-store\.js\?v=v65-p4b/u, page);
  }
  const css = read("assets/css/theme.css");
  for (const variable of ["--xb-color-bg", "--xb-card-bg", "--xb-card-text", "--xb-header-bg", "--xb-border-color", "--xb-bottom-nav-bg"]) assert.ok(css.includes(variable), variable);
});

test("v58 workshop exposes controlled asset management and versioned shell", () => {
  const html = read("theme-workshop.html"); const sw = read("sw.js");
  assert.match(html, /装饰槽位设置/u);
  assert.match(html, /data-theme-slot-editor/u);
  assert.match(html, /不会原样执行 Echoes CSS/u);
  assert.match(sw, /xinban-shell-v65-p4b/u);
  assert.match(sw, /v65-p4b-no-purple-fallback/u);
});
