"use strict";

const crypto = require("node:crypto");
const { StateStoreError } = require("./state-store");

const QUERY_FIELDS = new Set(["scopeType", "scopeId"]);

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseScope(query = {}) {
  const unknown = Object.keys(query).find(key => !QUERY_FIELDS.has(key));
  if (unknown) throw new StateStoreError(`不支持的查询参数：${unknown}`);
  const scopeType = query.scopeType == null || query.scopeType === "" ? "companion" : query.scopeType;
  const scopeId = query.scopeId == null || query.scopeId === "" ? "default" : query.scopeId;
  if (typeof scopeType !== "string" || typeof scopeId !== "string") throw new StateStoreError("scope 格式无效");
  if (scopeType !== "companion" || scopeId !== "default") {
    throw new StateStoreError("不允许读取该 State scope", 403, "STATE_SCOPE_FORBIDDEN");
  }
  return { scopeType, scopeId };
}

function sendError(req, reply, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) req.log.error({ errorName: error.name, errorCode: error.code }, "state API failed");
  return reply.code(statusCode).send({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: statusCode >= 500 ? "State 服务暂时不可用" : error.message
    }
  });
}

function registerStateRoutes(app, options = {}) {
  const store = options.store;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  if (!store || typeof store.getPublicState !== "function") throw new TypeError("StateStore 必填");

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

  app.get("/api/v1/state", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      const { scopeType, scopeId } = parseScope(req.query || {});
      return { items: store.getPublicState(scopeType, scopeId) };
    } catch (error) { return sendError(req, reply, error); }
  });

  return { bearerAuth };
}

module.exports = { parseScope, registerStateRoutes };
