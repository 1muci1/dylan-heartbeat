"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { cssVariables, normalizeTheme, DEFAULT_THEME } = require("../frontend-p4b/assets/js/theme-store");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const themeCss = read("frontend-p4b/assets/css/theme.css");

test("collaboration loads activeTheme and themes every primary surface and action", () => {
  const html = read("ai-companion-frontend/collaboration/index.html");
  assert.match(html, /class="collaboration-page"/u);
  assert.match(html, /\/assets\/css\/theme\.css\?v=v67-p4b/u);
  assert.match(html, /\/assets\/js\/theme-store\.js\?v=v67-p4b/u);
  assert.match(html, /v67-p4b-live-visual-editor/u);
  assert.match(themeCss, /\.collaboration-page :is\(\.intro-card,\.create-card,\.room-card,\.agent-card,\.summary-card\)[^}]*background:var\(--xb-card-bg\)/u);
  assert.match(themeCss, /\.collaboration-page :is\(\.primary-button,[^}]*background:var\(--xb-color-accent\)/u);
  assert.match(themeCss, /\.collaboration-page :is\(\.agent-card>button,[^}]*background:var\(--xb-color-surface-soft\)/u);
  assert.match(themeCss, /\.collaboration-page \.page-header>a[^}]*background:var\(--xb-button-bg\)/u);
});

test("space and studio load activeTheme with themed cards, controls, sliders and navigation", () => {
  for (const file of ["ai-companion-frontend/space/index.html", "ai-companion-frontend/space/studio/index.html"]) {
    const html = read(file);
    assert.match(html, /\/assets\/css\/theme\.css\?v=v67-p4b/u, file);
    assert.match(html, /\/assets\/js\/theme-store\.js\?v=v67-p4b/u, file);
    assert.match(html, /v67-p4b-live-visual-editor/u, file);
    assert.doesNotMatch(html, /theme\/theme-engine\.js/u, file);
    assert.match(html, /theme-adapter\.js\?v=v67-p4b/u, file);
  }
  assert.match(themeCss, /:is\(\.space-page,\.space-studio-page\) :is\(\.preview-card,[^}]*background:var\(--xb-card-bg\)/u);
  assert.match(themeCss, /input\[type=range\]\{accent-color:var\(--xb-color-accent\)\}/u);
  assert.match(themeCss, /\.segmented button\.is-active,[^}]*background:var\(--xb-color-accent\)/u);
  assert.match(themeCss, /\.app-tab-bar\{[^}]*background:var\(--xb-bottom-nav-bg\)/u);
  assert.match(themeCss, /\.app-tab-bar a\[aria-current=page\][^}]*background:var\(--xb-nav-active-bg\)/u);
});

test("home residual accents use canonical theme variables", () => {
  assert.match(themeCss, /\.bottom-nav \.bottom-nav__chat svg[^}]*background:var\(--xb-color-accent\)/u);
  assert.match(themeCss, /\.today-card__meter span:nth-child\(-n\+4\)[^}]*background:var\(--xb-progress-fill\)/u);
  assert.match(themeCss, /\.action-card--chat[^}]*background:var\(--xb-color-accent\)/u);
  assert.match(themeCss, /:is\(\.today-card__mark,\.action-card__icon,\.status-card__icon\)[^}]*color:var\(--xb-color-accent\)/u);
});

test("a blue active theme derives blue canonical accents instead of purple defaults", () => {
  const blue = normalizeTheme({
    ...DEFAULT_THEME,
    id: "theme_blue_fixture",
    tokens: { ...DEFAULT_THEME.tokens, colorPrimary: "#397aa8", colorAccent: "#6da9cc" }
  });
  const vars = cssVariables(blue);
  for (const name of ["--xb-color-accent", "--xb-progress-fill", "--xb-button-bg"]) assert.equal(vars[name], "#397aa8", name);
  assert.match(vars["--xb-avatar-ring"], /#397aa8/u);
  assert.match(vars["--xb-nav-active-bg"], /#397aa8/u);
  assert.doesNotMatch(Object.values(vars).filter(value => typeof value === "string" && /--xb-|color-mix/u.test(value)).join("\n"), /#a78bfa|#9b7cff|#8b5cf6/iu);
});

test("v62 cache markers update without changing the game build", () => {
  const sw = read("frontend-p4b/sw.js");
  const common = read("frontend-p4b/assets/js/common.js");
  const game = read("ai-companion-frontend/game/index.html");
  assert.match(sw, /xinban-shell-v67-p4b/u);
  assert.match(sw, /v67-p4b-live-visual-editor/u);
  assert.match(common, /p4b-sw-controller-refresh-v67/u);
  assert.match(game, /game\.js\?v=game-v49-p4b/u);
});
