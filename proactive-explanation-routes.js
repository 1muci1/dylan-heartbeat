"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function registerProactiveExplanationRoutes(app, { explanationView, apiKey = process.env.GATEWAY_API_KEY } = {}) {
  if (!app || typeof app.get !== "function") throw new TypeError("app 必填");
  if (!explanationView || typeof explanationView.get !== "function") throw new TypeError("explanationView 必填");

  function auth(req, reply, done) {
    if (!apiKey) return reply.code(503).send({ error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
    }
    done();
  }

  app.get("/api/v1/proactive/explanations/:deliveryId", { preHandler: auth }, async (req, reply) => {
    try {
      return explanationView.get(req.params.deliveryId);
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) {
        req.log.error({ errorName: error.name, errorCode: error.code }, "proactive explanation API failed");
      }
      return reply.code(status).send({ error: {
        code: error.code || "INTERNAL_ERROR",
        message: status >= 500 ? "Proactive Explanation 服务暂时不可用" : error.message
      } });
    }
  });
}

module.exports = { registerProactiveExplanationRoutes, safeEqual };
