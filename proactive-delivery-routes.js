"use strict";

const crypto = require("node:crypto");

const LIST_FIELDS = new Set(["limit", "status", "from", "to"]);
const STATUSES = new Set(["pending", "sending", "sent", "failed", "cancelled"]);

class ProactiveRouteError extends Error {
  constructor(message, statusCode = 400, code = "PROACTIVE_QUERY_INVALID") {
    super(message); this.statusCode = statusCode; this.code = code;
  }
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual)); const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function listView(item) {
  return { id: item.id, channel: item.channel, status: item.status, reasonCode: item.reasonCode,
    attemptCount: item.attemptCount, createdAt: item.createdAt, sentAt: item.sentAt, failedAt: item.failedAt };
}

function detailView(item) {
  return { id: item.id, status: item.status, channel: item.channel, reasonCode: item.reasonCode,
    attemptCount: item.attemptCount, createdAt: item.createdAt, sentAt: item.sentAt,
    failedAt: item.failedAt, lastErrorCode: item.lastErrorCode };
}

function parseListQuery(query = {}) {
  const unknown = Object.keys(query).find(key => !LIST_FIELDS.has(key));
  if (unknown) throw new ProactiveRouteError(`不支持的查询参数：${unknown}`);
  const limit = query.limit == null || query.limit === "" ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProactiveRouteError("limit 必须是 1 到 100");
  if (query.status != null && !STATUSES.has(query.status)) throw new ProactiveRouteError("status 无效");
  const result = { limit };
  if (query.status) result.status = query.status;
  for (const key of ["from", "to"]) {
    if (query[key] == null || query[key] === "") continue;
    const date = new Date(query[key]);
    if (Number.isNaN(date.getTime())) throw new ProactiveRouteError(`${key} 时间无效`);
    result[key] = date.toISOString();
  }
  if (result.from && result.to && result.from > result.to) throw new ProactiveRouteError("from 不能晚于 to");
  return result;
}

function registerProactiveDeliveryRoutes(app, options = {}) {
  const deliveryStore = options.deliveryStore;
  const settings = options.settings;
  const proactiveView = options.proactiveView;
  const feedbackStore = options.feedbackStore;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  if (!deliveryStore || typeof deliveryStore.list !== "function" || typeof deliveryStore.get !== "function") throw new TypeError("deliveryStore 必填");
  if (!settings || typeof settings.getSettings !== "function" || typeof settings.updateSettings !== "function") throw new TypeError("settings 必填");
  if (proactiveView && typeof proactiveView.getOverview !== "function") throw new TypeError("proactiveView 无效");
  if (feedbackStore && typeof feedbackStore.record !== "function") throw new TypeError("feedbackStore 无效");

  function auth(req, reply, done) {
    if (!apiKey) return reply.code(503).send({ error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
    }
    done();
  }
  function fail(req, reply, error) {
    const status = error.statusCode || 500;
    if (status >= 500) req.log.error({ errorName: error.name, errorCode: error.code }, "proactive API failed");
    return reply.code(status).send({ error: { code: error.code || "INTERNAL_ERROR", message: status >= 500 ? "Proactive 服务暂时不可用" : error.message } });
  }

  app.get("/api/v1/proactive/deliveries", { preHandler: auth }, async (req, reply) => {
    try { const query = parseListQuery(req.query); return { items: deliveryStore.list(query).items.map(listView) }; }
    catch (error) { return fail(req, reply, error); }
  });
  app.get("/api/v1/proactive/deliveries/:id", { preHandler: auth }, async (req, reply) => {
    try { return detailView(deliveryStore.get(req.params.id)); } catch (error) { return fail(req, reply, error); }
  });
  app.get("/api/v1/proactive/settings", { preHandler: auth }, async (req, reply) => {
    try { return settings.getSettings(); } catch (error) { return fail(req, reply, error); }
  });
  app.put("/api/v1/proactive/settings", { preHandler: auth }, async (req, reply) => {
    try { return settings.updateSettings(req.body); } catch (error) { return fail(req, reply, error); }
  });
  if (proactiveView) app.get("/api/v1/proactive/overview", { preHandler: auth }, async (req, reply) => {
    try { return proactiveView.getOverview(); } catch (error) { return fail(req, reply, error); }
  });
  if (feedbackStore) app.post("/api/v1/proactive/deliveries/:id/feedback", { preHandler: auth }, async (req, reply) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "feedbackType")) {
        throw new ProactiveRouteError("Body 只允许 feedbackType", 400, "PROACTIVE_FEEDBACK_INVALID");
      }
      return feedbackStore.record({ deliveryId: req.params.id, feedbackType: body.feedbackType });
    } catch (error) { return fail(req, reply, error); }
  });
}

module.exports = { detailView, listView, parseListQuery, registerProactiveDeliveryRoutes };
