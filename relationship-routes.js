"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseScope(query = {}) {
  const allowed = new Set(["scopeType", "scopeId"]);
  const unknown = Object.keys(query).find(key => !allowed.has(key));
  if (unknown) return { error: `不支持的查询参数：${unknown}`, code: "RELATIONSHIP_QUERY_INVALID", statusCode: 400 };
  const scopeType = query.scopeType == null || query.scopeType === "" ? "companion" : query.scopeType;
  const scopeId = query.scopeId == null || query.scopeId === "" ? "default" : query.scopeId;
  if (scopeType !== "companion" || scopeId !== "default") {
    return { error: "不允许读取该 Relationship scope", code: "RELATIONSHIP_SCOPE_FORBIDDEN", statusCode: 403 };
  }
  return { scopeType, scopeId };
}

function registerRelationshipRoutes(app, options = {}) {
  const service = options.service;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  if (!service || typeof service.get !== "function") throw new TypeError("RelationshipViewService 必填");

  function bearerAuth(req, reply, done) {
    const auth = req.headers.authorization || "";
    if (!apiKey) return reply.code(503).send({ error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
    if (!safeEqual(auth, `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
    }
    done();
  }

  app.get("/api/v1/relationship", { preHandler: bearerAuth }, async (req, reply) => {
    const scope = parseScope(req.query || {});
    if (scope.error) return reply.code(scope.statusCode).send({ error: { code: scope.code, message: scope.error } });
    try {
      return service.get();
    } catch (error) {
      req.log.error({ errorName: error.name }, "relationship view failed");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Relationship 服务暂时不可用" } });
    }
  });

  return { bearerAuth };
}

module.exports = { parseScope, registerRelationshipRoutes };
