"use strict";

const DEFAULT_TIMEOUT_MS = 10000;

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function failure(reasonCode) {
  return { success: false, reasonCode };
}

class BarkPushAdapter {
  constructor({
    enabled: configuredEnabled = process.env.BARK_ENABLED,
    serverUrl = process.env.BARK_SERVER_URL,
    deviceToken = process.env.BARK_DEVICE_TOKEN,
    fetch: fetchImpl = global.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    this.enabled = typeof configuredEnabled === "boolean" ? configuredEnabled : enabled(configuredEnabled);
    this.serverUrl = typeof serverUrl === "string" ? serverUrl.trim().replace(/\/+$/, "") : "";
    this.deviceToken = typeof deviceToken === "string" ? deviceToken.trim() : "";
    this.fetch = fetchImpl;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  async send(delivery, options = {}) {
    if (!this.enabled) return failure("BARK_DISABLED");
    if (!this.serverUrl || !this.deviceToken || typeof this.fetch !== "function") return failure("BARK_NOT_CONFIGURED");
    if (!delivery || typeof delivery !== "object" || typeof delivery.text !== "string"
      || !delivery.text.trim() || delivery.text.length > 500) return failure("BARK_INVALID_DELIVERY");

    let endpoint;
    try {
      const base = new URL(this.serverUrl);
      if (!new Set(["http:", "https:"]).has(base.protocol)) return failure("BARK_NOT_CONFIGURED");
      endpoint = `${this.serverUrl}/${encodeURIComponent(this.deviceToken)}`;
    } catch {
      return failure("BARK_NOT_CONFIGURED");
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener?.("abort", abort, { once: true });
    const configuredTimeout = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : this.timeoutMs;
    let timer;
    let timedOut = false;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(Object.assign(new Error("timeout"), { barkTimeout: true }));
      }, timeoutMs);
    });

    let response;
    try {
      response = await Promise.race([
        this.fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "AI Companion", body: delivery.text }),
          signal: controller.signal
        }),
        timeout
      ]);
    } catch (error) {
      return failure(error?.barkTimeout || timedOut ? "BARK_TIMEOUT" : "BARK_NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", abort);
    }

    const status = Number(response?.status);
    if (status >= 200 && status < 300) return { success: true, provider: "bark" };
    if (status === 401 || status === 403) return failure("BARK_AUTH_FAILED");
    if (status === 429) return failure("BARK_RATE_LIMITED");
    if (status >= 500) return failure("BARK_PROVIDER_ERROR");
    return failure("BARK_PROVIDER_ERROR");
  }
}

module.exports = { BarkPushAdapter, DEFAULT_TIMEOUT_MS, enabled };
