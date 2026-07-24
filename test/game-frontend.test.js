"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..", "ai-companion-frontend", "game");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("game space is an independent native frontend module with all local references", () => {
  const html = read("index.html");
  for (const file of ["game.css", "game.js"]) {
    assert.ok(fs.existsSync(path.join(root, file)));
    assert.match(html, new RegExp(file.replace(".", "\\.")));
  }
  assert.doesNotMatch(html, /chat\.js|provider\.js|react|vue|angular/i);
});

test("game space includes the room and three required interactions", () => {
  const html = read("index.html");
  const js = read("game.js");
  assert.match(html, /沉的小屋/);
  assert.match(html, /data-guess-form/);
  for (const mood of ["开心", "平静", "疲惫", "低落"]) assert.match(html, new RegExp(`data-mood="${mood}"`));
  for (const result of ["大了", "小了", "猜中了"]) assert.match(js, new RegExp(result));
  for (const event of ["和沉一起看星星", "整理小屋", "喝下午茶", "散步"]) assert.match(js, new RegExp(event));
});

test("game space uses existing AppConfig and reports successful interactions to the Event API", () => {
  const html = read("index.html");
  const js = read("game.js");
  assert.match(html, /\/assets\/js\/data\.js/);
  assert.match(js, /\/api\/game\/events/);
  assert.match(js, /AppConfig\?\.getProviderConfig/);
  assert.match(js, /config\?\.baseUrl/);
  assert.match(js, /Authorization:\s*`Bearer/);
  assert.match(js, /method:\s*"POST"/);
  for (const eventType of ["mood_selected", "mini_game_completed", "room_interaction"]) {
    assert.match(js, new RegExp(`eventType: "${eventType}"`));
  }
  assert.doesNotMatch(js, /XMLHttpRequest|localStorage|sessionStorage/);
});

test("game Event reporting is best-effort and never blocks local interaction results", () => {
  const js = read("game.js");
  assert.match(js, /if \(!baseUrl \|\| !token\) return false/);
  assert.match(js, /catch \{\s*return false/);
  assert.match(js, /void sendGameEvent/);
  assert.match(js, /return response\.ok/);
});

test("game space has mobile-first safe-area and narrow viewport rules", () => {
  const html = read("index.html");
  const css = read("game.css");
  assert.match(html, /width=device-width/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.match(css, /minmax\(0, 1fr\)/);
});
