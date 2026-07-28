"use strict";

const assert = require("node:assert/strict");
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
    model: control(),
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
        return [fields.type, fields.baseUrl, fields.endpoint, fields.token, fields.model, fields.enabled];
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
      model: "claude-opus-4-6",
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
    model: "claude-opus-4-6",
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
