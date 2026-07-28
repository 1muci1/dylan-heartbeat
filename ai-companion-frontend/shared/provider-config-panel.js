"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionProviderConfigPanel = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const fieldNames = ["source", "type", "baseUrl", "endpoint", "token", "displayName", "model", "enabled"];
  const bind = dialog => {
    if (!dialog?.querySelector) return null;
    const form = dialog.querySelector("[data-provider-config-form]");
    if (!form) return null;
    const fields = Object.fromEntries(fieldNames
      .map(name => [name, form.elements?.[name]])
      .filter(([, field]) => field));
    const status = dialog.querySelector("[data-provider-panel-status]");
    const syncSource = () => {
      if (!fields.source) return;
      const global = fields.source.value === "global";
      dialog.querySelectorAll("[data-provider-custom]").forEach(node => {
        const field = node.matches?.("input,select,button") ? node : node.querySelector?.("input,select,button");
        if (field) field.disabled = global;
      });
    };
    const fill = values => {
      const value = values || {};
      if (fields.source) fields.source.value = value.source === "custom" ? "custom" : "global";
      if (fields.type) fields.type.value = value.type || "dylan";
      if (fields.baseUrl) fields.baseUrl.value = value.baseUrl || "";
      if (fields.endpoint) fields.endpoint.value = value.endpoint || "/v1/chat/completions";
      if (fields.token) {
        fields.token.type = "password";
        fields.token.value = value.auth?.token || value.token || "";
      }
      if (fields.displayName) fields.displayName.value = value.displayName || "Claude Opus 4.6";
      if (fields.model) fields.model.value = value.model || "[脆卷-kiro-0.08]claude-opus-4-6";
      if (fields.enabled) fields.enabled.checked = value.enabled !== false;
      syncSource();
    };
    const read = () => ({
      ...(fields.source ? { source: fields.source.value } : {}),
      type: fields.type?.value || "dylan",
      enabled: fields.enabled ? fields.enabled.checked : true,
      baseUrl: String(fields.baseUrl?.value || "").trim(),
      endpoint: String(fields.endpoint?.value || "").trim(),
      ...(fields.displayName ? { displayName: String(fields.displayName.value || "").trim() } : {}),
      model: String(fields.model?.value || "").trim(),
      auth: { type: "bearer", token: String(fields.token?.value || "").trim() }
    });
    const close = () => {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
    const open = ({ title, values, message } = {}) => {
      fill(values);
      const titleNode = dialog.querySelector("[data-provider-panel-title]");
      if (titleNode && title) titleNode.textContent = title;
      if (status) status.textContent = message || "";
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    };
    dialog.querySelectorAll("[data-provider-panel-close]").forEach(button => {
      button.addEventListener("click", close);
    });
    dialog.querySelector("[data-provider-panel-token]")?.addEventListener("click", event => {
      if (!fields.token) return;
      const showing = fields.token.type === "text";
      fields.token.type = showing ? "password" : "text";
      event.currentTarget.textContent = showing ? "显示" : "隐藏";
      event.currentTarget.setAttribute("aria-label", showing ? "显示 API Key" : "隐藏 API Key");
    });
    fields.source?.addEventListener("change", syncSource);
    return Object.freeze({ close, dialog, fields, fill, form, open, read, status, syncSource });
  };
  return { bind };
});
