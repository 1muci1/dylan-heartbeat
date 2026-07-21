"use strict";

const LIST_PATH = "/api/v1/memories";
const STATS_PATH = "/api/v1/memories/stats";
const STATE_PATH = "/api/v1/state";
const RELATIONSHIP_PATH = "/api/v1/relationship";
const PROACTIVE_OVERVIEW_PATH = "/api/v1/proactive/overview";
const TOOL_AUDIT_PATH = "/api/v1/tools/audit";
const MEMORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

class MemoryApiClientError extends Error {
  constructor(message, code = "MEMORY_API_ERROR", statusCode = 500) {
    super(message);
    this.name = "MemoryApiClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

class MemoryApiClient {
  constructor(options = {}) {
    if (!(options.baseUrl instanceof URL)) throw new TypeError("baseUrl 必须是 URL");
    if (typeof options.token !== "string" || !options.token) throw new TypeError("token 必填");
    if (typeof (options.fetch || globalThis.fetch) !== "function") throw new TypeError("fetch 必填");
    this.baseUrl = new URL(options.baseUrl.toString());
    this.token = options.token;
    this.fetch = options.fetch || globalThis.fetch;
  }

  list(query = {}) {
    const search = new URLSearchParams();
    for (const key of ["page", "limit", "keyword", "type", "status", "dateFrom", "dateTo", "sort"]) {
      if (query[key] !== undefined && query[key] !== null && query[key] !== "") search.set(key, String(query[key]));
    }
    const suffix = search.size ? `?${search}` : "";
    return this.request(`${LIST_PATH}${suffix}`);
  }

  get(id) {
    const normalized = String(id || "").trim();
    if (!MEMORY_ID_PATTERN.test(normalized)) {
      throw new MemoryApiClientError("Memory ID 格式无效", "MEMORY_ID_INVALID", 400);
    }
    return this.request(`${LIST_PATH}/${encodeURIComponent(normalized)}`);
  }

  stats() {
    return this.request(STATS_PATH);
  }

  state(scope = "default") {
    if (scope !== "default") throw new MemoryApiClientError("State scope 不允许", "STATE_SCOPE_FORBIDDEN", 403);
    return this.request(`${STATE_PATH}?scopeType=companion&scopeId=default`);
  }

  relationship() {
    return this.request(RELATIONSHIP_PATH);
  }

  proactiveOverview() {
    return this.request(PROACTIVE_OVERVIEW_PATH);
  }

  toolAudit(query = {}) {
    const search = new URLSearchParams();
    for (const key of ["limit", "toolName", "eventType", "from", "to"]) {
      if (query[key] !== undefined && query[key] !== null && query[key] !== "") search.set(key, String(query[key]));
    }
    const suffix = search.size ? `?${search}` : "";
    return this.request(`${TOOL_AUDIT_PATH}${suffix}`);
  }

  async request(pathname) {
    const allowed = pathname === LIST_PATH || pathname === STATS_PATH || pathname.startsWith(`${LIST_PATH}?`) ||
      pathname === `${STATE_PATH}?scopeType=companion&scopeId=default` ||
      pathname === RELATIONSHIP_PATH || pathname === PROACTIVE_OVERVIEW_PATH ||
      pathname === TOOL_AUDIT_PATH || pathname.startsWith(`${TOOL_AUDIT_PATH}?`) ||
      new RegExp(`^${LIST_PATH}/[A-Za-z0-9][A-Za-z0-9._%:-]{0,383}$`).test(pathname);
    if (!allowed) throw new MemoryApiClientError("Memory API 路径不允许", "MEMORY_API_PATH_FORBIDDEN", 403);
    const url = new URL(pathname, this.baseUrl);
    const response = await this.fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` }
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new MemoryApiClientError("Memory API 返回了无效 JSON", "MEMORY_API_RESPONSE_INVALID", 502);
    }
    if (!response.ok || payload?.error) {
      throw new MemoryApiClientError(
        payload?.error?.message || `Memory API 请求失败（${response.status}）`,
        payload?.error?.code || "MEMORY_API_REQUEST_FAILED",
        response.status || 502
      );
    }
    return payload;
  }
}

module.exports = { MemoryApiClient, MemoryApiClientError };
