"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("v68 service worker replaces old shell caches and keeps HTML network-first", () => {
  const sw = read("frontend-p4b/sw.js");
  assert.match(sw, /CACHE_NAME = "xinban-shell-v77-p4b"/u);
  assert.match(sw, /BUILD_REVISION = "v77"/u);
  assert.match(sw, /self\.skipWaiting\(\)/u);
  assert.match(sw, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/u);
  assert.match(sw, /self\.clients\.claim\(\)/u);
  const shouldDelete = key => key.startsWith("xinban-shell-") && key !== "xinban-shell-v77-p4b";
  assert.equal(shouldDelete("xinban-shell-v67-p4b"), true);
  assert.equal(shouldDelete("xinban-shell-v77-p4b"), false);
  const htmlBranch = sw.slice(sw.indexOf('event.request.mode === "navigate"'));
  assert.ok(htmlBranch.indexOf("fetch(event.request)") < htmlBranch.indexOf("caches.match(event.request)"));
});

test("v68 pages and shell assets use the new cache-bust version", () => {
  const pages = [
    "frontend-p4b/index.html", "frontend-p4b/chat.html", "frontend-p4b/settings.html",
    "frontend-p4b/theme-workshop.html", "frontend-p4b/dashboard.html", "frontend-p4b/ai-memory-review.html",
    "ai-companion-frontend/collaboration/index.html", "ai-companion-frontend/space/index.html",
    "ai-companion-frontend/space/studio/index.html", "ai-companion-frontend/game/index.html"
  ];
  for (const file of pages) {
    const html = read(file);
    assert.doesNotMatch(html, /v67-p4b/u, file);
    assert.match(html, /v77-p4b/u, file);
  }
  assert.doesNotMatch(read("frontend-p4b/sw.js"), /\?v=v67-p4b/u);
  assert.match(read("frontend-p4b/sw.js"), /\?v=v77-p4b/u);
});

test("v68 controller refresh is guarded once and game build remains v49", () => {
  const common = read("frontend-p4b/assets/js/common.js");
  assert.match(common, /CONTROLLER_REFRESH_GUARD = "p4b-sw-controller-refresh-v77"/u);
  assert.match(common, /getItem\(CONTROLLER_REFRESH_GUARD\) === "1"/u);
  assert.match(common, /setItem\(CONTROLLER_REFRESH_GUARD, "1"\)/u);
  assert.match(common, /addEventListener\("controllerchange", refreshOnceForController\)/u);
  assert.equal((common.match(/windowRef\.location\.reload\(\)/gu) || []).length, 1);
  assert.match(read("ai-companion-frontend/game/index.html"), /game-v49-p4b/u);
  assert.match(read("ai-companion-frontend/game/game.js"), /game-v49-p4b/u);
});
