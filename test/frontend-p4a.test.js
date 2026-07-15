"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const root = path.join(__dirname, "..", "frontend-p4a");

test("P4A frontend is staging-only with complete references and v19 cache", () => {
  assert.notEqual(fs.realpathSync(root), fs.realpathSync("/var/www/ai-companion-frontend"));
  for (const page of ["chat.html", "stickers.html"]) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = match[1]; if (/^(?:https?:|#)/.test(ref)) continue;
      assert.ok(fs.existsSync(path.join(root, ref)) || fs.existsSync(path.join("/var/www/ai-companion-frontend", ref)), `missing ${ref}`);
    }
  }
  assert.match(fs.readFileSync(path.join(root, "sw.js"), "utf8"), /xinban-shell-v19/);
});

test("Thinking, images and Sticker UI are present and safe at 320px", () => {
  const chat = fs.readFileSync(path.join(root, "assets/js/chat.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "assets/css/chat.css"), "utf8");
  assert.match(chat, /thinking-panel/); assert.match(chat, /uploadImages/); assert.match(chat, /sendSticker/);
  assert.match(css, /@media \(max-width: 359px\)/); assert.match(css, /minmax\(0, 1fr\)/);
  assert.doesNotMatch(chat, /api\.xiaowo\.homes|Bearer\s+[A-Za-z0-9_-]{16,}/);
});
