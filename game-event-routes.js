"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sendError(req, reply, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    req.log.error({ errorName: error.name, errorCode: error.code }, "game event API failed");
  }
  return reply.code(statusCode).send({
    event: null,
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: statusCode >= 500 ? "游戏 Event 服务暂时不可用" : error.message
    }
  });
}

function registerGameEventRoutes(app, { service, apiKey = process.env.GATEWAY_API_KEY } = {}) {
  if (!service || typeof service.create !== "function") throw new TypeError("GameEventService 必填");

  function bearerAuth(req, reply, done) {
    const auth = req.headers.authorization || "";
    if (!apiKey) {
      reply.code(503).send({ event: null, error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
      return;
    }
    if (!safeEqual(auth, `Bearer ${apiKey}`)) {
      reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ event: null, error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
      return;
    }
    done();
  }

  app.post("/api/game/events", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return reply.code(201).send({ event: service.create(req.body), error: null });
    } catch (error) {
      return sendError(req, reply, error);
    }
  });
}

module.exports = { registerGameEventRoutes };
