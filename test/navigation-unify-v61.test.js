"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("v61 source navigation never links chat through the legacy frontend directory", () => {
  const roots = ["frontend-p4b", "ai-companion-frontend"];
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (/\.(?:html|js|css)$/u.test(entry.name)) files.push(relative);
    }
  };
  roots.forEach(visit);
  for (const file of files) assert.doesNotMatch(read(file), /href=["']\/frontend-p4b\/chat\.html["']/u, file);
});

test("legacy home is a script-free compatibility redirect to the current home", () => {
  const home = read("ai-companion-frontend/home/index.html");
  assert.match(home, /v61-p4b-nav-unify/u);
  assert.match(home, /http-equiv="refresh" content="0;url=\/index\.html"/u);
  assert.match(home, /location\.replace\("\/index\.html"\)/u);
  assert.doesNotMatch(home, /theme-engine\.js|home\.js\?v=37|app-tab-bar/u);
});

test("legacy frontend paths are static redirects to canonical root pages", () => {
  for (const [name, target] of [["chat", "chat"], ["index", "index"], ["settings", "settings"], ["theme-workshop", "theme-workshop"], ["dashboard", "dashboard"]]) {
    const html = read(`frontend-p4b/frontend-p4b/${name}.html`);
    assert.match(html, /v61-p4b-legacy-redirect/u, name);
    assert.match(html, new RegExp(`location\\.replace\\("/${target}\\.html"\\)`, "u"), name);
  }
});

test("canonical navigation and cache markers use v61", () => {
  for (const page of ["frontend-p4b/index.html", "frontend-p4b/chat.html", "frontend-p4b/dashboard.html", "frontend-p4b/settings.html"]) {
    const html = read(page);
    assert.doesNotMatch(html, /href=["']\/home\/["']/u, page);
  }
  assert.match(read("frontend-p4b/index.html"), /href="\/chat\.html"/u);
  assert.match(read("frontend-p4b/chat.html"), /href="\/index\.html"[^>]*data-nav="home"/u);
  const common = read("frontend-p4b/assets/js/common.js");
  assert.match(common, /APP_VERSION = "v65-p4b"/u);
  assert.match(common, /p4b-sw-controller-refresh-v65/u);
  const sw = read("frontend-p4b/sw.js");
  assert.match(sw, /CACHE_NAME = "xinban-shell-v65-p4b"/u);
  assert.match(sw, /BUILD_REVISION = "v65-p4b-no-purple-fallback"/u);
});
