"use strict";

const crypto = require("node:crypto");
const { NAME_PATTERN } = require("./tool-registry");

const TOOL_EVENT_TYPES = new Set(["tool.requested", "tool.approved", "tool.completed", "tool.failed"]);
const QUERY_FIELDS = new Set(["limit", "toolName", "eventType", "from", "to"]);

class ToolAuditRouteError extends Error {
  constructor(message, statusCode = 400, code = "TOOL_AUDIT_QUERY_INVALID") {
    super(message); this.name = "ToolAuditRouteError"; this.statusCode = statusCode; this.code = code;
  }
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual)), right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseTime(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ToolAuditRouteError(`${field} 时间无效`);
  return date.toISOString();
}

function parseAuditQuery(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new ToolAuditRouteError("查询格式无效");
  const unknown = Object.keys(query).find(key => !QUERY_FIELDS.has(key));
  if (unknown) throw new ToolAuditRouteError(`不支持的查询参数：${unknown}`);
  const limit = query.limit == null || query.limit === "" ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolAuditRouteError("limit 必须是 1 到 100");
  const result = { page: 1, limit, category: "tool", sort: "newest" };
  if (query.toolName != null && query.toolName !== "") {
    if (typeof query.toolName !== "string" || !NAME_PATTERN.test(query.toolName)) throw new ToolAuditRouteError("toolName 格式无效");
    result.subjectType = "tool"; result.subjectId = query.toolName;
  }
  if (query.eventType != null && query.eventType !== "") {
    if (!TOOL_EVENT_TYPES.has(query.eventType)) throw new ToolAuditRouteError("eventType 无效");
    result.eventType = query.eventType;
  }
  if (query.from != null && query.from !== "") result.occurredFrom = parseTime(query.from, "from");
  if (query.to != null && query.to !== "") result.occurredTo = parseTime(query.to, "to");
  if (result.occurredFrom && result.occurredTo && result.occurredFrom > result.occurredTo) {
    throw new ToolAuditRouteError("from 不能晚于 to");
  }
  return result;
}

function presentToolAudit(event) {
  const payload = event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : {};
  return {
    eventType: event.eventType,
    toolName: typeof payload.toolName === "string" ? payload.toolName : event.subjectId,
    approvalStatus: typeof payload.approvalStatus === "string" ? payload.approvalStatus : null,
    success: typeof payload.success === "boolean" ? payload.success : null,
    errorCode: typeof payload.errorCode === "string" ? payload.errorCode : null,
    createdAt: event.createdAt
  };
}

function registerToolAuditRoutes(app, options = {}) {
  const eventStore = options.eventStore;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  if (!eventStore || typeof eventStore.list !== "function") throw new TypeError("eventStore 必填");

  function auth(req, reply, done) {
    if (!apiKey) return reply.code(503).send({ error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
    }
    done();
  }

  app.get("/api/v1/tools/audit", { preHandler: auth }, async (req, reply) => {
    try {
      const query = parseAuditQuery(req.query || {});
      return { items: eventStore.list(query).items.map(presentToolAudit) };
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) req.log.error({ errorName: error.name, errorCode: error.code }, "tool audit API failed");
      return reply.code(status).send({ error: { code: error.code || "INTERNAL_ERROR", message: status >= 500 ? "Tool Audit 服务暂时不可用" : error.message } });
    }
  });
}

module.exports = { QUERY_FIELDS, TOOL_EVENT_TYPES, ToolAuditRouteError, parseAuditQuery, presentToolAudit, registerToolAuditRoutes };
