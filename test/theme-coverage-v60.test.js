"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..", "frontend-p4b");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const theme = read("assets/css/theme.css");
const store = read("assets/js/theme-store.js");

test("v60 exposes and applies the complete canonical theme variable set", () => {
  for (const name of ["color-surface","color-surface-soft","color-text-muted","color-accent","color-accent-soft","page-bg","page-text","card-bg","card-text","card-muted","card-border","card-shadow","header-bg","header-text","bottom-nav-bg","nav-text","nav-active-bg","nav-active-text","button-bg","button-text","button-border","input-bg","input-text","input-border","status-bg","status-text","badge-bg","badge-text","avatar-ring","progress-bg","progress-fill","radius-card","radius-button","radius-bubble"]) {
    assert.match(theme, new RegExp(`--xb-${name}:`, "u"), name);
    assert.match(store, new RegExp(`"--xb-${name}"`, "u"), name);
  }
});

test("home and dashboard cards, status, avatar and navigation use canonical variables", () => {
  assert.match(theme, /\.today-card,[^}]*\.action-card,[^}]*\.status-card/u);
  assert.match(theme, /background:var\(--xb-card-bg\)/u);
  assert.match(theme, /\.online-pill,[^}]*\.online-label,[^}]*\.status-card__tag/u);
  assert.match(theme, /background:var\(--xb-status-bg\)/u);
  assert.match(theme, /\.companion-portrait,[^}]*\.dashboard-avatar/u);
  assert.match(theme, /border-color:var\(--xb-avatar-ring\)/u);
  assert.match(theme, /\.today-card__meter span\{background:var\(--xb-progress-bg\)/u);
  assert.match(theme, /:is\(\.bottom-nav,\.game-nav\).*background:var\(--xb-bottom-nav-bg\)/u);
});

test("settings, workshop and memory review controls share themed surfaces", () => {
  assert.match(theme, /\.provider-form,[^}]*\.theme-panel,[^}]*\.theme-asset-card/u);
  assert.match(theme, /\.review-notice,[^}]*\.candidate-card,[^}]*\.review-card/u);
  assert.match(theme, /\.provider-button--primary,[^}]*\.theme-actions button\[data-theme-apply\][^}]*\.review-more/u);
  assert.match(theme, /\.review-filters input,[^}]*\.review-editor textarea/u);
});

test("game outer UI reads the active theme while board and canvas remain functional", () => {
  const gameHtml = fs.readFileSync(path.join(__dirname, "..", "ai-companion-frontend", "game", "index.html"), "utf8");
  assert.match(gameHtml, /\/assets\/css\/theme\.css\?v=v63-p4b/u);
  assert.match(gameHtml, /\/assets\/js\/theme-store\.js\?v=v63-p4b/u);
  assert.match(gameHtml, /body class="game-page"/u);
  assert.match(theme, /body\.game-page/u);
  assert.match(theme, /\.lobby-card,\.game-panel/u);
  assert.doesNotMatch(theme, /html\.has-xinban-theme\s+\.(?:gomoku-board|drawing-wrap|drawing-wrap canvas)/u);
  assert.match(gameHtml, /game\.js\?v=game-v49-p4b/u);
});

test("chat coverage changes appearance without overriding protected layout properties", () => {
  const coverage = theme.slice(theme.indexOf("/* v60 canonical coverage"));
  for (const selector of ["chat-shell","chat-main","message-list","composer","session-drawer"]) {
    const rules = [...coverage.matchAll(new RegExp(`[^{}]*\\.${selector}[^{}]*\\{([^}]*)\\}`, "gu"))].map(match => match[1]).join(";");
    assert.doesNotMatch(rules, /(?:^|;)\s*(?:display|position|height|overflow|transform|z-index)\s*:/u, selector);
  }
});

test("service worker publishes the v60 theme coverage revision", () => {
  const sw = read("sw.js");
  assert.match(sw, /CACHE_NAME = "xinban-shell-v63-p4b"/u);
  assert.match(sw, /BUILD_REVISION = "v63-p4b-computed-theme-audit"/u);
});
