"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..", "ai-companion-frontend");
const home = fs.readFileSync(path.join(root, "home", "index.html"), "utf8");
const settings = fs.readFileSync(path.join(__dirname, "..", "frontend-p4b", "settings.html"), "utf8");
const css = fs.readFileSync(path.join(root, "home", "home.css"), "utf8");
const navCss = fs.readFileSync(path.join(root, "theme", "app-nav.css"), "utf8");

test("legacy Home is a minimal compatibility redirect without a second app navigation", () => {
  assert.match(home, /location\.replace\("\/index\.html"\)/);
  assert.match(home, /v61-p4b-nav-unify/);
  assert.doesNotMatch(home, /class="app-tab-bar"|app-tab-bar__chat/);
  assert.match(navCss, /\.app-tab-bar__chat/);
});

test("legacy Home no longer loads the duplicate relationship UI", () => {
  assert.doesNotMatch(home, /home-pair|DAYS TOGETHER|home-relationship-strip|home-card/);
  assert.doesNotMatch(home, /theme-engine\.js|home\.js\?v=37/);
});

test("Beauty controls live in Settings instead of the Home visual hierarchy", () => {
  for (const token of ["SPACE APPEARANCE", "主题模式", "主题风格", "字体", "背景图", "沉沉头像", "空间 Preset"]) {
    assert.match(settings, new RegExp(token));
  }
});
