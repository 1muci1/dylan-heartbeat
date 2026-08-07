"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function registerMemorySuggestionRoutes(app, { store, apiKey = process.env.GATEWAY_API_KEY } = {}) {
  if (!store) throw new TypeError("MemorySuggestionStore 必填");
  function auth(req, reply, done) {
    if (!apiKey) return reply.code(503).send({ data: null, error: { code: "GATEWAY_KEY_MISSING", message: "Gateway key 未配置" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer").send({ data: null, error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    }
    done();
  }
  const route = handler => async (req, reply) => {
    try { return await handler(req, reply); }
    catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) req.log.error({ errorCode: error.code, errorName: error.name }, "memory suggestion API failed");
      return reply.code(status).send({ data: null, error: {
        code: error.code || "INTERNAL_ERROR",
        message: status >= 500 ? "记忆建议服务暂时不可用" : error.message
      } });
    }
  };
  app.get("/api/memory/suggestions", { preHandler: auth }, route(req => ({ data: store.list(req.query || {}), error: null })));
  app.post("/api/memory/suggestions/:id/approve", { preHandler: auth }, route(req => ({ data: store.approve(req.params.id), error: null })));
  app.post("/api/memory/suggestions/:id/reject", { preHandler: auth }, route(req => ({ data: store.reject(req.params.id), error: null })));
}

module.exports = { registerMemorySuggestionRoutes };
