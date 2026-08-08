"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { relationshipDays, RELATIONSHIP_START_DATE } = require("../ai-companion-frontend/calendar/calendar");

const root = path.join(__dirname, "..", "ai-companion-frontend");

test("新版 Calendar 页面和资源存在", () => {
  for (const file of ["index.html", "calendar.css", "calendar.js"]) assert.equal(fs.existsSync(path.join(root, "calendar", file)), true);
});

test("旧 Home 入口收敛到新版小窝且不再承载旧导航", () => {
  const home = fs.readFileSync(path.join(root, "home", "index.html"), "utf8");
  assert.match(home, /location\.replace\("\/index\.html"\)/);
  assert.doesNotMatch(home, /href="\/calendar\/"|href="\.\.\/dashboard\.html"/);
});

test("Calendar reads the shared relationship start date", () => {
  assert.equal(RELATIONSHIP_START_DATE, "2026-07-01");
  assert.equal(relationshipDays(new Date("2026-07-24T12:00:00")), 24);
  const html = fs.readFileSync(path.join(root, "calendar", "index.html"), "utf8");
  assert.match(html, /2026-07-01/);
});

test("Calendar does not reference the legacy dashboard page", () => {
  const source = ["index.html", "calendar.css", "calendar.js"].map(file => fs.readFileSync(path.join(root, "calendar", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /dashboard\.html/);
});
