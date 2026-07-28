"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { resolveReturnTarget } = require("../frontend-p4b/assets/js/settings-return");
const settingsSection = require("../frontend-p4b/assets/js/settings-section");

const frontend = path.join(__dirname, "..", "frontend-p4b");
const read = relative => fs.readFileSync(path.join(frontend, relative), "utf8");

test("the existing session drawer separates model and appearance shortcuts", () => {
  const html = read("chat.html");
  const drawerStart = html.indexOf('<aside class="session-drawer"');
  const model = html.indexOf('session-settings-link--model', drawerStart);
  const appearance = html.indexOf('href="/frontend-p4b/settings.html?returnTo=%2Ffrontend-p4b%2Fchat.html#appearance"', drawerStart);
  const newSession = html.indexOf('class="session-new"', drawerStart);
  assert.ok(drawerStart >= 0);
  assert.ok(model > drawerStart && model < appearance && appearance < newSession);
  assert.match(
    html.slice(model, appearance),
    /模型设置[\s\S]*Provider、API 与模型/
  );
  assert.match(
    html.slice(appearance, newSession),
    /小世界美化[\s\S]*头像、背景与主题/
  );
});

test("model and appearance shortcuts keep chat as return target and use separate hashes", () => {
  const html = read("chat.html");
  assert.match(
    html,
    /href="\/frontend-p4b\/settings\.html\?returnTo=%2Ffrontend-p4b%2Fchat\.html#model"/
  );
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

test("settings exposes native model and appearance anchors without changing default return behavior", () => {
  const html = read("settings.html");
  assert.match(html, /class="settings-zone settings-zone--model" id="model"/);
  assert.match(html, /class="settings-zone settings-zone--appearance" id="appearance"/);
  assert.equal(
    resolveReturnTarget({
      origin: "https://chat.example",
      settingsPath: "/frontend-p4b/settings.html"
    }),
    "/home/"
  );
});

test("settings hashes select one visual section while no hash keeps the complete page", () => {
  const css = read("assets/css/settings.css");
  const createDocument = () => {
    const title = { textContent: "" };
    return { body: { dataset: {} }, querySelector: () => title, title };
  };
  const modelDocument = createDocument();
  assert.equal(settingsSection.apply(modelDocument, "#model"), "model");
  assert.equal(modelDocument.body.dataset.settingsSection, "model");
  assert.equal(modelDocument.title.textContent, "模型设置");
  const appearanceDocument = createDocument();
  assert.equal(settingsSection.apply(appearanceDocument, "#appearance"), "appearance");
  assert.equal(appearanceDocument.body.dataset.settingsSection, "appearance");
  assert.equal(appearanceDocument.title.textContent, "小世界美化");
  const allDocument = createDocument();
  assert.equal(settingsSection.apply(allDocument, ""), "all");
  assert.equal(allDocument.body.dataset.settingsSection, "all");
  assert.match(css, /data-settings-section="model"[\s\S]*settings-zone--appearance/);
  assert.match(css, /data-settings-section="appearance"[\s\S]*settings-zone--model/);
});

test("global model settings use the shared Provider configuration dialog", () => {
  const html = read("settings.html");
  const js = read("assets/js/settings.js");
  assert.match(html, /data-open-global-provider>配置模型/);
  assert.match(html, /data-global-provider-dialog/);
  for (const field of ["type", "baseUrl", "endpoint", "token", "model", "enabled"]) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.match(html, /data-provider-panel-token/);
  assert.match(html, />取消</);
  assert.match(html, />保存</);
  assert.match(js, /data-open-global-provider[\s\S]*providerPanel\.open/);
  assert.match(js, /saveProviderConfig\(readFormConfig\(\)\)/);
  assert.doesNotMatch(js, /console\.(?:log|debug|info)\s*\(/);
});

test("settings and council load the same Provider panel controller and stylesheet", () => {
  const settings = read("settings.html");
  const council = fs.readFileSync(path.join(__dirname, "..", "ai-companion-frontend", "collaboration", "index.html"), "utf8");
  for (const asset of ["/shared/provider-config-panel.css", "/shared/provider-config-panel.js"]) {
    assert.match(settings, new RegExp(asset.replace(/[./]/g, "\\$&")));
    assert.match(council, new RegExp(asset.replace(/[./]/g, "\\$&")));
  }
  assert.match(settings, /class="provider-config-dialog"/);
  assert.match(council, /class="provider-config-dialog"/);
});
