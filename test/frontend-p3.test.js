"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const staging = path.join(__dirname, "..", "frontend-p3");
const production = "/var/www/ai-companion-frontend";

test("P3 frontend stays in staging and all memory page references resolve", () => {
  assert.notEqual(fs.realpathSync(staging), fs.realpathSync(production));
  const html = fs.readFileSync(path.join(staging, "memory.html"), "utf8");
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  for (const reference of references.filter(value => !/^(?:https?:|#)/.test(value))) {
    const inStaging = path.join(staging, reference);
    const inProduction = path.join(production, reference);
    assert.ok(fs.existsSync(inStaging) || fs.existsSync(inProduction), `missing reference: ${reference}`);
  }
  assert.match(fs.readFileSync(path.join(staging, "index.html"), "utf8"), /href="memory\.html"/);
  assert.match(fs.readFileSync(path.join(staging, "dashboard.html"), "utf8"), /href="memory\.html"/);
  assert.match(fs.readFileSync(path.join(staging, "sw.js"), "utf8"), /xinban-shell-v18/);
});

test("memory staging CSS includes explicit 320px overflow protection", () => {
  const html = fs.readFileSync(path.join(staging, "memory.html"), "utf8");
  const css = fs.readFileSync(path.join(staging, "assets/css/memory.css"), "utf8");
  assert.match(html, /width=device-width/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /@media\s*\(max-width:359px\)/);
  assert.match(css, /minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /min-width:\s*(?:3[3-9]\d|[4-9]\d\d)px/);
});

test("memory frontend uses saved Provider credentials without hardcoded secrets", () => {
  const source = fs.readFileSync(path.join(staging, "assets/js/memory.js"), "utf8");
  assert.match(source, /getProviderConfig/);
  assert.match(source, /provider\.auth\?\.token/);
  assert.doesNotMatch(source, /api\.xiaowo\.homes/);
  assert.doesNotMatch(source, /Bearer\s+[A-Za-z0-9_-]{16,}/);
});
