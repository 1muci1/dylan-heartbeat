"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { bind } = require("../ai-companion-frontend/shared/provider-config-panel");

const control = (value = "") => ({
  value,
  checked: false,
  disabled: false,
  type: "text",
  listeners: {},
  addEventListener(type, listener) { this.listeners[type] = listener; },
  matches() { return true; }
});

test("shared Provider panel opens, masks secrets, and returns normalized fields", () => {
  const fields = {
    source: control("global"),
    type: control("dylan"),
    baseUrl: control(),
    endpoint: control(),
    token: control(),
    displayName: control(),
    model: control(),
    supportsImages: control(),
    enabled: control()
  };
  const form = { elements: fields };
  const status = { textContent: "" };
  const title = { textContent: "" };
  const tokenButton = control();
  tokenButton.textContent = "显示";
  tokenButton.setAttribute = (name, value) => { tokenButton[name] = value; };
  const closeButton = control();
  const dialog = {
    open: false,
    querySelector(selector) {
      return {
        "[data-provider-config-form]": form,
        "[data-provider-panel-status]": status,
        "[data-provider-panel-title]": title,
        "[data-provider-panel-token]": tokenButton
      }[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-provider-custom]") {
        return [fields.type, fields.baseUrl, fields.endpoint, fields.token, fields.displayName, fields.model, fields.supportsImages, fields.enabled];
      }
      if (selector === "[data-provider-panel-close]") return [closeButton];
      return [];
    },
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const panel = bind(dialog);
  panel.open({
    title: "配置聊天模型",
    message: "当前配置",
    values: {
      source: "custom",
      type: "anthropic",
      baseUrl: "https://provider.example",
      endpoint: "/v1/messages",
      token: "masked-test-value",
      displayName: "Claude Opus 4.6",
      model: "[脆卷-kiro-0.08]claude-opus-4-6",
      supportsImages: true,
      enabled: true
    }
  });
  assert.equal(dialog.open, true);
  assert.equal(title.textContent, "配置聊天模型");
  assert.equal(status.textContent, "当前配置");
  assert.equal(fields.token.type, "password");
  const saved = panel.read();
  assert.deepEqual({ ...saved, auth: { ...saved.auth, token: Boolean(saved.auth.token) } }, {
    source: "custom",
    type: "anthropic",
    enabled: true,
    baseUrl: "https://provider.example",
    endpoint: "/v1/messages",
    displayName: "Claude Opus 4.6",
    model: "[脆卷-kiro-0.08]claude-opus-4-6",
    supportsImages: true,
    auth: { type: "bearer", token: true }
  });
  tokenButton.listeners.click({ currentTarget: tokenButton });
  assert.equal(fields.token.type, "text");
  closeButton.listeners.click();
  assert.equal(dialog.open, false);
});

test("global council source disables only custom Provider fields", () => {
  const source = control("global");
  const custom = control();
  const form = { elements: { source, type: custom } };
  const dialog = {
    querySelector: selector => selector === "[data-provider-config-form]" ? form : null,
    querySelectorAll: selector => selector === "[data-provider-custom]" ? [custom] : []
  };
  const panel = bind(dialog);
  panel.fill({ source: "global" });
  assert.equal(custom.disabled, true);
  source.value = "custom";
  source.listeners.change();
  assert.equal(custom.disabled, false);
});

test("Provider panel keeps mobile actions above the safe area", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "ai-companion-frontend", "shared", "provider-config-panel.css"), "utf8");
  assert.match(css, /\.provider-config-dialog form[^}]*overflow-y:auto/);
  assert.match(css, /\.provider-config-actions[^}]*position:sticky/);
  assert.match(css, /\.provider-config-actions[^}]*safe-area-inset-bottom/);
  assert.match(css, /100dvh/);
});
