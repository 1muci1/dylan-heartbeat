"use strict";

const crypto = require("node:crypto");
const { EVENT_DEFINITIONS } = require("./event-definitions");
const { EventStoreError } = require("./event-store");

const QUERY_FIELDS = new Set([
  "page", "limit", "eventType", "category", "source", "subjectType", "subjectId",
  "occurredFrom", "occurredTo", "includeExpired", "sort"
]);
const CATEGORIES = new Set(Object.values(EVENT_DEFINITIONS).map(item => item.category));
const SOURCES = new Set(Object.values(EVENT_DEFINITIONS).flatMap(item => item.allowedSources));
const SENSITIVE_PAYLOAD_KEY = /(secret|token|password|prompt|stack|error)/i;

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function invalid(message) {
  return new EventStoreError(message, 400, "EVENT_INVALID");
}

function integer(value, field, fallback, max) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") throw invalid(`${field} 格式无效`);
  if (!/^\d+$/.test(String(value))) throw invalid(`${field} 格式无效`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw invalid(`${field} 格式无效`);
  return number;
}

function optionalText(value, field, max = 200) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw invalid(`${field} 格式无效`);
  return value.trim();
}

function dateTime(value, field) {
  const text = optionalText(value, field, 100);
  if (!text) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new EventStoreError(`${field} 格式无效`, 400, "EVENT_TIME_INVALID");
  return date.toISOString();
}

function boolean(value, field, fallback) {
  if (value == null || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw invalid(`${field} 必须是 true 或 false`);
}

function parseQuery(query = {}) {
  const unknown = Object.keys(query).find(key => !QUERY_FIELDS.has(key));
  if (unknown) throw invalid(`不支持的查询参数：${unknown}`);
  const eventType = optionalText(query.eventType, "eventType", 100);
  if (eventType && !EVENT_DEFINITIONS[eventType]) throw invalid("eventType 无效");
  const category = optionalText(query.category, "category", 100);
  if (category && !CATEGORIES.has(category)) throw invalid("category 无效");
  const source = optionalText(query.source, "source", 100);
  if (source && !SOURCES.has(source)) throw invalid("source 无效");
  const occurredFrom = dateTime(query.occurredFrom, "occurredFrom");
  const occurredTo = dateTime(query.occurredTo, "occurredTo");
  if (occurredFrom && occurredTo && occurredFrom >= occurredTo) throw new EventStoreError("时间范围无效", 400, "EVENT_TIME_INVALID");
  const sort = optionalText(query.sort, "sort", 20) || "newest";
  if (!new Set(["newest", "oldest"]).has(sort)) throw invalid("sort 无效");
  return {
    page: integer(query.page, "page", 1, Number.MAX_SAFE_INTEGER),
    limit: integer(query.limit, "limit", 20, 100),
    eventType,
    category,
    source,
    subjectType: optionalText(query.subjectType, "subjectType"),
    subjectId: optionalText(query.subjectId, "subjectId"),
    occurredFrom,
    occurredTo,
    includeExpired: boolean(query.includeExpired, "includeExpired", false),
    sort
  };
}

function sanitizePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_PAYLOAD_KEY.test(key)) continue;
    clean[key] = sanitizePayload(item);
  }
  return clean;
}

function presentEvent(event) {
  return {
    id: event.id,
    eventType: event.eventType,
    category: event.category,
    source: event.source,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    payload: sanitizePayload(event.payload),
    importance: event.importance,
    priority: event.priority,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    expiresAt: event.expiresAt
  };
}

function listWithoutExpired(store, query, now) {
  const { page, limit, includeExpired: _includeExpired, ...filters } = query;
  if (query.includeExpired) return store.list({ ...filters, page, limit });
  const active = [];
  let sourcePage = 1;
  while (true) {
    const batch = store.list({ ...filters, page: sourcePage, limit: 100 });
    active.push(...batch.items.filter(event => !event.expiresAt || event.expiresAt > now));
    if (sourcePage >= batch.meta.totalPages) break;
    sourcePage++;
  }
  const offset = (page - 1) * limit;
  return {
    items: active.slice(offset, offset + limit),
    meta: { page, limit, total: active.length, totalPages: Math.ceil(active.length / limit) }
  };
}

function sendError(req, reply, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) req.log.error({ errorName: error.name, errorCode: error.code }, "event API failed");
  return reply.code(statusCode).send({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: statusCode >= 500 ? "Event 服务暂时不可用" : error.message
    }
  });
}

function registerEventRoutes(app, options = {}) {
  const store = options.store;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  const clock = options.clock || (() => new Date());
  if (!store) throw new TypeError("store 必填");

  function bearerAuth(req, reply, done) {
    const auth = req.headers.authorization || "";
    if (!apiKey) {
      reply.code(503).send({ error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
      return;
    }
    if (!safeEqual(auth, `Bearer ${apiKey}`)) {
      reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
      return;
    }
    done();
  }

  app.get("/api/v1/events", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      const query = parseQuery(req.query || {});
      const now = clock();
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("clock 返回值无效");
      const result = listWithoutExpired(store, query, now.toISOString());
      return { items: result.items.map(presentEvent), meta: result.meta };
    } catch (error) { return sendError(req, reply, error); }
  });

  app.get("/api/v1/events/:id", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return { event: presentEvent(store.get(req.params.id)) };
    } catch (error) { return sendError(req, reply, error); }
  });

  return { bearerAuth };
}

module.exports = { parseQuery, presentEvent, registerEventRoutes, sanitizePayload };
