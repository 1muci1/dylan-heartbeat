"use strict";

class WakeDecisionSnapshotClient {
  constructor({ url = "http://127.0.0.1:3001/internal/wake-decision/snapshot", token = "", fetch: fetchImpl = globalThis.fetch, timeoutMs = 1000 } = {}) {
    this.url = String(url);
    try {
      const parsed = new URL(this.url);
      this.localOnly = parsed.protocol === "http:" && new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname);
    } catch {
      this.localOnly = false;
    }
    this.token = typeof token === "string" ? token.trim() : "";
    this.fetch = fetchImpl;
    this.timeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1000;
  }

  async fetchSnapshot() {
    if (!this.localOnly || !this.token || typeof this.fetch !== "function") return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` },
        signal: controller.signal
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload && typeof payload === "object" && !payload.error ? payload : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { WakeDecisionSnapshotClient };
