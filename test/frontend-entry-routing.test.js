"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const canonicalRoutes = [
  'href="/index.html"',
  'href="/game/"',
  'href="/chat.html"',
  'href="/collaboration/"'
];

test("root entry and legacy chat entry route into the canonical companion shell", () => {
  const index = read("ai-companion-frontend/index.html");
  const chatEntry = read("ai-companion-frontend/chat.html");

  assert.match(index, /window\.location\.replace\("\/index\.html"\)/);
  assert.match(chatEntry, /window\.location\.replace\("\/chat\.html"\)/);
  assert.match(chatEntry, /rel="canonical" href="\/chat\.html"/);
  assert.doesNotMatch(chatEntry, /\/frontend-p4b\/chat\.html|\.\.\/chat\.html/);
  assert.doesNotMatch(chatEntry, /心伴/);
});

test("new Home and Chat navigation use canonical absolute routes", () => {
  const home = read("frontend-p4b/index.html");
  const chat = read("frontend-p4b/chat.html");

  for (const route of canonicalRoutes) {
    assert.match(home, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(chat, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(chat, /href="\/settings\.html\?returnTo=%2Fchat\.html"/);
  assert.match(home, /href="\/chat\.html"/);
  assert.doesNotMatch(chat, /href="\/frontend-p4b\/chat\.html"|\.\.\/chat\.html/);
  assert.doesNotMatch(chat, /<title>心伴/);
});

test("new shell app navigation uses the formal root chat entry", () => {
  for (const relativePath of [
    "ai-companion-frontend/calendar/index.html",
    "ai-companion-frontend/space/index.html",
    "frontend-p4b/index.html",
    "frontend-p4b/chat.html",
    "frontend-p4b/settings.html",
    "frontend-p4b/dashboard.html",
    "frontend-p4b/proactive-explanation.html"
  ]) {
    assert.match(read(relativePath), /href="\/chat\.html"/, relativePath);
  }
  assert.match(read("ai-companion-frontend/home/index.html"), /location\.replace\("\/index\.html"\)/);
  const game = read("ai-companion-frontend/game/index.html");
  assert.match(game, /href="\/chat\.html"/);
  assert.match(game, /href="\/chat\.html\?fromGame=gomoku"/);
  assert.match(game, /href="\/chat\.html\?fromGame=draw"/);
  assert.doesNotMatch(game, /\/frontend-p4b\/chat\.html|\.\.\/chat\.html|ai-companion-frontend\/chat\.html/);
});
