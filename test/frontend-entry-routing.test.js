"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const canonicalRoutes = [
  'href="/home/"',
  'href="/game/"',
  'href="/frontend-p4b/chat.html"',
  'href="/collaboration/"',
  'href="/space/"'
];

test("root entry and legacy chat entry route into the canonical companion shell", () => {
  const index = read("ai-companion-frontend/index.html");
  const chatEntry = read("ai-companion-frontend/chat.html");

  assert.match(index, /window\.location\.replace\("\/home\/"\)/);
  assert.match(chatEntry, /window\.location\.replace\("\/frontend-p4b\/chat\.html"\)/);
  assert.match(chatEntry, /rel="canonical" href="\/frontend-p4b\/chat\.html"/);
  assert.doesNotMatch(chatEntry, /心伴/);
});

test("new Home and Chat navigation use canonical absolute routes", () => {
  const home = read("ai-companion-frontend/home/index.html");
  const chat = read("frontend-p4b/chat.html");

  for (const route of canonicalRoutes) {
    assert.match(home, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(chat, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(home, /href="\/chat\.html"/);
  assert.doesNotMatch(chat, /<title>心伴/);
});

test("new shell app navigation never points at the legacy root chat page", () => {
  for (const relativePath of [
    "ai-companion-frontend/home/index.html",
    "ai-companion-frontend/calendar/index.html",
    "ai-companion-frontend/space/index.html",
    "ai-companion-frontend/game/index.html",
    "frontend-p4b/index.html",
    "frontend-p4b/chat.html",
    "frontend-p4b/settings.html",
    "frontend-p4b/dashboard.html",
    "frontend-p4b/proactive-explanation.html"
  ]) {
    assert.doesNotMatch(read(relativePath), /href="\/chat\.html"/, relativePath);
  }
});
