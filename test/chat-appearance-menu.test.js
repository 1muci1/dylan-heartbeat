"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { resolveReturnTarget } = require("../frontend-p4b/assets/js/settings-return");

const frontend = path.join(__dirname, "..", "frontend-p4b");
const read = relative => fs.readFileSync(path.join(frontend, relative), "utf8");

test("the existing session drawer exposes appearance as its first action", () => {
  const html = read("chat.html");
  const drawerStart = html.indexOf('<aside class="session-drawer"');
  const appearance = html.indexOf('class="session-appearance-link"', drawerStart);
  const newSession = html.indexOf('class="session-new"', drawerStart);
  assert.ok(drawerStart >= 0);
  assert.ok(appearance > drawerStart && appearance < newSession);
  assert.match(
    html.slice(appearance, newSession),
    /小世界美化[\s\S]*头像、背景与主题/
  );
});

test("appearance shortcut keeps chat as return target and uses the appearance hash", () => {
  const html = read("chat.html");
  assert.match(
    html,
    /href="\/frontend-p4b\/settings\.html\?returnTo=%2Ffrontend-p4b%2Fchat\.html#appearance"/
  );
  assert.equal(
    resolveReturnTarget({
      returnTo: "/frontend-p4b/chat.html",
      origin: "https://chat.example",
      settingsPath: "/frontend-p4b/settings.html"
    }),
    "/frontend-p4b/chat.html"
  );
});

test("settings exposes a native appearance anchor without changing default return behavior", () => {
  const html = read("settings.html");
  assert.match(html, /class="appearance-settings" id="appearance"/);
  assert.equal(
    resolveReturnTarget({
      origin: "https://chat.example",
      settingsPath: "/frontend-p4b/settings.html"
    }),
    "/home/"
  );
});
