"use strict";

require("dotenv").config({ quiet: true });

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");
const { MemoryApiClient } = require("./memory-api-client");
const {
  DELIVERY_STATUSES,
  FEEDBACK_TYPES,
  MAX_DELIVERY_ID_LENGTH,
  PROACTIVE_EXPLANATION_TOOL_NAME,
  SUMMARY_CODES,
  mapPublicExplanation
} = require("./proactive-explanation-contract");
const { ToolRegistry } = require("./tool-registry");

const MEMORY_TYPES = ["MEMORY", "EVENT", "MOMENT", "PROMISE", "WISHLIST", "NOTE"];
const MEMORY_STATUSES = ["active", "archived", "deleted"];
const MEMORY_SORTS = ["newest", "oldest", "updated", "importance"];
const TOOL_AUDIT_EVENT_TYPES = ["tool.requested", "tool.approved", "tool.completed", "tool.failed"];

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

function mapExplanationToolError(error) {
  let code = "EXPLANATION_UNAVAILABLE";
  let message = "Proactive Explanation 服务暂时不可用";
  if (error?.code === "PROACTIVE_EXPLANATION_INVALID" || error?.code === "INVALID_ARGUMENT") {
    code = "INVALID_ARGUMENT";
    message = "deliveryId 参数无效";
  } else if (error?.statusCode === 404 || error?.code === "DELIVERY_NOT_FOUND") {
    code = "DELIVERY_NOT_FOUND";
    message = "Delivery 不存在";
  } else if ([401, 403].includes(error?.statusCode) || error?.code === "UNAUTHORIZED") {
    code = "UNAUTHORIZED";
    message = "Proactive Explanation API 认证失败";
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
  const register = (name, config, handler, errorMapper = mapToolError) => server.registerTool(name, {
    ...config,
    annotations: readOnlyAnnotations
  }, async input => {
    try {
      return toolSuccess(await handler(input));
    } catch (error) {
      return errorMapper(error);
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

  register("companion_state_get", {
    title: "Get Companion State",
    description: "Return the current public companion/default State projection.",
    inputSchema: {
      scope: z.enum(["default"]).default("default")
    }
  }, async ({ scope }) => {
    const payload = await apiClient.state(scope);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return {
      states: items.map(item => ({ key: item.stateKey, value: item.value, updatedAt: item.updatedAt }))
    };
  });

  register("relationship_view_get", {
    title: "Get Relationship View",
    description: "Return the current read-only relationship context for companion/default.",
    inputSchema: {}
  }, async () => {
    const payload = await apiClient.relationship();
    const interactionStyle = payload?.interactionStyle || {};
    const proactiveContact = payload?.proactiveContact || {};
    const familiarity = payload?.familiarity || {};
    return {
      interactionStyle: {
        value: typeof interactionStyle.value === "string" ? interactionStyle.value : "unspecified",
        source: interactionStyle.source === "memory" ? "memory" : "default"
      },
      proactiveContact: {
        enabled: proactiveContact.enabled === true,
        source: proactiveContact.source === "state" ? "state" : "default"
      },
      familiarity: {
        level: [1, 2, 3].includes(familiarity.level) ? familiarity.level : 1,
        basis: "interaction_count"
      },
      recentTopics: Array.isArray(payload?.recentTopics)
        ? payload.recentTopics.filter(item => typeof item === "string" && item.length <= 100).slice(0, 10) : [],
      importantMemoryIds: Array.isArray(payload?.importantMemoryIds)
        ? payload.importantMemoryIds.filter(item => typeof item === "string").slice(0, 100) : []
    };
  });

  register("proactive_overview_get", {
    title: "Get Proactive Overview",
    description: "Return the read-only Companion Center proactive overview.",
    inputSchema: {}
  }, async () => {
    const payload = await apiClient.proactiveOverview();
    return {
      enabled: payload?.enabled === true,
      quietHours: { start: payload?.quietHours?.start || "23:00", end: payload?.quietHours?.end || "08:00" },
      recentDeliveries: (Array.isArray(payload?.recentDeliveries) ? payload.recentDeliveries : []).slice(0, 5).map(item => ({
        id: item.id, channel: item.channel, status: item.status, reasonCode: item.reasonCode,
        createdAt: item.createdAt, sentAt: item.sentAt
      })),
      pendingCount: Number(payload?.pendingCount || 0),
      failedCount: Number(payload?.failedCount || 0),
      lastContactAt: payload?.lastContactAt || null,
      lastReasonCode: payload?.lastReasonCode || null,
      feedbackSummary: Object.fromEntries(Object.entries(payload?.feedbackSummary || {})
        .filter(([key, value]) => ["liked", "dismissed", "not_relevant", "disable_future"].includes(key) && Number.isSafeInteger(value) && value > 0))
    };
  });

  const explanationTool = new ToolRegistry().get(PROACTIVE_EXPLANATION_TOOL_NAME);
  const expectedInput = explanationTool?.inputSchema;
  if (!expectedInput || expectedInput.required?.length !== 1 || expectedInput.required[0] !== "deliveryId" ||
      expectedInput.properties?.deliveryId?.maxLength !== MAX_DELIVERY_ID_LENGTH ||
      expectedInput.additionalProperties !== false) {
    throw new MemoryMcpConfigurationError("proactive_explanation_get contract 无效");
  }
  register(PROACTIVE_EXPLANATION_TOOL_NAME, {
    title: "Get Proactive Explanation",
    description: explanationTool.description,
    inputSchema: z.strictObject({
      deliveryId: z.string().trim().min(1).max(MAX_DELIVERY_ID_LENGTH)
    }),
    outputSchema: z.strictObject({
      deliveryId: z.string(),
      summaryCode: z.enum(Object.values(SUMMARY_CODES)),
      delivery: z.strictObject({
        status: z.enum(DELIVERY_STATUSES),
        channel: z.string(),
        reasonCode: z.string(),
        attemptCount: z.number().int().nonnegative(),
        createdAt: z.string(),
        sentAt: z.string().nullable(),
        failedAt: z.string().nullable(),
        lastErrorCode: z.string().nullable()
      }),
      aiJob: z.strictObject({
        available: z.boolean(), id: z.string().nullable(), status: z.string().nullable()
      }),
      triggerEvent: z.strictObject({
        available: z.boolean(), eventType: z.string().nullable(), occurredAt: z.string().nullable()
      }),
      wakeDecision: z.strictObject({
        available: z.literal(false), decision: z.null(), reasonCode: z.null()
      }),
      feedback: z.strictObject({
        feedbackType: z.enum(FEEDBACK_TYPES), createdAt: z.string()
      }).nullable()
    })
  }, async ({ deliveryId }) => mapPublicExplanation(await apiClient.proactiveExplanation(deliveryId)), mapExplanationToolError);

  register("tool_audit_get", {
    title: "Get Tool Audit",
    description: "Query the safe read-only Tool lifecycle audit trail.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20),
      toolName: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,7}$/).max(120).optional(),
      eventType: z.enum(TOOL_AUDIT_EVENT_TYPES).optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional()
    }
  }, async input => {
    const payload = await apiClient.toolAudit(input);
    return {
      items: (Array.isArray(payload?.items) ? payload.items : []).slice(0, input.limit).map(item => ({
        eventType: item.eventType,
        toolName: item.toolName,
        approvalStatus: item.approvalStatus ?? null,
        success: typeof item.success === "boolean" ? item.success : null,
        errorCode: item.errorCode ?? null,
        createdAt: item.createdAt
      }))
    };
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
  mapExplanationToolError,
  readMemoryMcpConfig,
  registerMemoryTools
};
