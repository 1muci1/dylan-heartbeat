"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CollaborationProviderConfig = Object.freeze(api);
})(typeof window !== "undefined" ? window : null, () => {
  const STORAGE_KEY = "xinban-collaboration-provider-config-v1";
  const VERSION = 1;
  const DEFAULT_MODEL = "claude-opus-4-6";
  const PROVIDER_TYPES = new Set(["dylan", "gateway", "openai", "anthropic"]);
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaultProvider = () => ({
    source: "global",
    type: "dylan",
    enabled: true,
    baseUrl: "",
    endpoint: "/v1/chat/completions",
    model: DEFAULT_MODEL,
    auth: { type: "bearer", token: "" }
  });
  const normalizeProvider = value => {
    const defaults = defaultProvider();
    const type = String(value?.type || "").trim().toLowerCase();
    const endpoint = String(value?.endpoint || "").trim();
    return {
      source: value?.source === "custom" ? "custom" : "global",
      type: PROVIDER_TYPES.has(type) ? type : defaults.type,
      enabled: value?.enabled !== false,
      baseUrl: String(value?.baseUrl || "").trim(),
      endpoint: endpoint.startsWith("/") ? endpoint : defaults.endpoint,
      model: String(value?.model || "").trim() || defaults.model,
      auth: {
        type: "bearer",
        token: String(value?.auth?.token || "").trim()
      }
    };
  };
  const normalize = value => {
    const providers = {};
    if (value?.providers && typeof value.providers === "object") {
      Object.entries(value.providers).forEach(([agentId, provider]) => {
        if (/^[a-z0-9_-]{1,64}$/iu.test(agentId)) providers[agentId] = normalizeProvider(provider);
      });
    }
    return { version: VERSION, providers };
  };

  class CollaborationProviderStore {
    constructor({ storage, key = STORAGE_KEY } = {}) {
      this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      this.key = key;
    }
    load() {
      if (!this.storage) return normalize(null);
      try { return normalize(JSON.parse(this.storage.getItem(this.key) || "null")); }
      catch { return normalize(null); }
    }
    get(agentId) {
      return clone(this.load().providers[String(agentId || "")] || defaultProvider());
    }
    save(agentId, provider) {
      const id = String(agentId || "");
      if (!/^[a-z0-9_-]{1,64}$/iu.test(id)) throw new TypeError("无效 Agent ID");
      const current = this.load();
      current.providers[id] = normalizeProvider(provider);
      if (this.storage) this.storage.setItem(this.key, JSON.stringify(current));
      return clone(current.providers[id]);
    }
  }

  return {
    CollaborationProviderStore,
    DEFAULT_MODEL,
    STORAGE_KEY,
    VERSION,
    defaultProvider,
    normalize,
    normalizeProvider
  };
});
