"use strict";

require("dotenv").config({ quiet: true });

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");
const { MemoryApiClient } = require("./memory-api-client");

const MEMORY_TYPES = ["MEMORY", "EVENT", "MOMENT", "PROMISE", "WISHLIST", "NOTE"];
const MEMORY_STATUSES = ["active", "archived", "deleted"];
const MEMORY_SORTS = ["newest", "oldest", "updated", "importance"];

class MemoryMcpConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryMcpConfigurationError";
    this.code = "MEMORY_MCP_CONFIGURATION_INVALID";
  }
}

function readMemoryMcpConfig(env = process.env) {
  const rawBaseUrl = String(env.MEMORY_API_BASE_URL || "").trim();
  const token = String(env.MEMORY_API_TOKEN || "").trim();
  if (!rawBaseUrl) throw new MemoryMcpConfigurationError("MEMORY_API_BASE_URL 未配置");
  if (!token) throw new MemoryMcpConfigurationError("MEMORY_API_TOKEN 未配置");
  let baseUrl;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new MemoryMcpConfigurationError("MEMORY_API_BASE_URL 格式无效");
  }
  if (!new Set(["http:", "https:"]).has(baseUrl.protocol)) {
    throw new MemoryMcpConfigurationError("MEMORY_API_BASE_URL 只允许 http 或 https");
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") + "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  return Object.freeze({ baseUrl, token });
}

function toolSuccess(payload) {
  const structuredContent = payload;
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function mapToolError(error) {
  let code = "UPSTREAM_ERROR";
  let message = "Memory 服务暂时不可用";
  if (error?.code === "MEMORY_ID_INVALID" || error?.code === "INVALID_ARGUMENT") {
    code = "INVALID_ARGUMENT";
    message = error.message || "参数无效";
  } else if (error?.statusCode === 404 || error?.code === "MEMORY_NOT_FOUND") {
    code = "MEMORY_NOT_FOUND";
    message = "Memory 不存在";
  } else if ([401, 403].includes(error?.statusCode) || error?.code === "UNAUTHORIZED") {
    code = "UNAUTHORIZED";
    message = "Memory API 认证失败";
  }
  const structuredContent = { error: { code, message } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function registerMemoryTools(server, apiClient) {
  const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const register = (name, config, handler) => server.registerTool(name, {
    ...config,
    annotations: readOnlyAnnotations
  }, async input => {
    try {
      return toolSuccess(await handler(input));
    } catch (error) {
      return mapToolError(error);
    }
  });

  register("memory_search", {
    title: "Search Memory",
    description: "Search active long-term Memory by keyword.",
    inputSchema: {
      query: z.string().trim().min(1).max(200),
      type: z.enum(MEMORY_TYPES).optional(),
      status: z.enum(MEMORY_STATUSES).default("active"),
      limit: z.number().int().min(1).max(20).default(10)
    }
  }, async ({ query, type, status, limit }) => {
    const payload = await apiClient.list({ keyword: query, type, status, limit, page: 1 });
    return { items: Array.isArray(payload?.data) ? payload.data : [], meta: payload?.meta || {} };
  });

  register("memory_get", {
    title: "Get Memory",
    description: "Get one non-deleted Memory by ID.",
    inputSchema: { id: z.string().trim().min(1).max(128) }
  }, async ({ id }) => {
    const payload = await apiClient.get(id);
    if (payload?.data?.deletedAt || payload?.data?.status === "deleted") {
      const error = new Error("Memory 不存在");
      error.code = "MEMORY_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    return { memory: payload.data, meta: payload.meta || {} };
  });

  register("memory_list", {
    title: "List Memory",
    description: "List active long-term Memory with bounded pagination.",
    inputSchema: {
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(20).default(20),
      type: z.enum(MEMORY_TYPES).optional(),
      sort: z.enum(MEMORY_SORTS).default("newest")
    }
  }, async ({ page, limit, type, sort }) => {
    const payload = await apiClient.list({ page, limit, type, sort, status: "active" });
    return { items: Array.isArray(payload?.data) ? payload.data : [], meta: payload?.meta || {} };
  });

  register("memory_stats", {
    title: "Memory Statistics",
    description: "Return aggregate long-term Memory counts.",
    inputSchema: {}
  }, async () => {
    const payload = await apiClient.stats();
    return { stats: payload?.data || {}, meta: payload?.meta || {} };
  });
}

function createMemoryMcpRuntime(options = {}) {
  const config = options.config || readMemoryMcpConfig(options.env);
  const server = options.server || new McpServer({ name: "dylan-heartbeat-memory", version: "0.1.0" });
  const transport = options.transport || new StdioServerTransport();
  const apiClient = options.apiClient || new MemoryApiClient({
    baseUrl: config.baseUrl,
    token: config.token,
    fetch: options.fetch
  });
  registerMemoryTools(server, apiClient);
  const signalSource = options.signalSource || process;
  let started = false;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    signalSource.removeListener?.("SIGINT", handleSignal);
    signalSource.removeListener?.("SIGTERM", handleSignal);
    await server.close();
  };
  const handleSignal = () => {
    close().catch(error => {
      process.stderr.write(`Memory MCP 关闭失败：${error.message}\n`);
      process.exitCode = 1;
    });
  };
  const start = async () => {
    if (started) return;
    started = true;
    signalSource.once?.("SIGINT", handleSignal);
    signalSource.once?.("SIGTERM", handleSignal);
    try {
      await server.connect(transport);
    } catch (error) {
      signalSource.removeListener?.("SIGINT", handleSignal);
      signalSource.removeListener?.("SIGTERM", handleSignal);
      started = false;
      throw error;
    }
  };

  return { apiClient, close, config, server, start, transport };
}

async function main() {
  const runtime = createMemoryMcpRuntime();
  await runtime.start();
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Memory MCP 启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MemoryMcpConfigurationError,
  createMemoryMcpRuntime,
  main,
  mapToolError,
  readMemoryMcpConfig,
  registerMemoryTools
};
