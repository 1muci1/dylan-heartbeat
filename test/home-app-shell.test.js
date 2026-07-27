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

test("Home uses the App Shell navigation with chat as the primary action", () => {
  assert.match(home, /class="app-tab-bar"/);
  assert.match(home, /<span>小窝<\/span>/);
  assert.match(home, /app-tab-bar__chat/);
  assert.match(home, /<span>游戏<\/span>/);
  assert.match(home, /<span>议事厅<\/span>/);
  assert.match(home, /<span>设置<\/span>/);
  assert.match(navCss, /\.app-tab-bar__chat/);
});

test("Home is a relationship page with compact daily widgets", () => {
  for (const token of ["home-pair", "DAYS TOGETHER", "home-relationship-strip", "日历", "待办", "天气", "当前心情", "纪念日"]) {
    assert.match(home, new RegExp(token));
  }
  assert.doesNotMatch(home, /装扮小窝|主题、头像|当前 Preset/);
});

test("Beauty controls live in Settings instead of the Home visual hierarchy", () => {
  for (const token of ["SPACE APPEARANCE", "主题模式", "主题风格", "字体", "背景图", "沉沉头像", "空间 Preset"]) {
    assert.match(settings, new RegExp(token));
  }
});
