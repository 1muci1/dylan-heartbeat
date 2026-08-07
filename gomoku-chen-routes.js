"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function registerGomokuChenRoutes(app, { service, apiKey = process.env.GATEWAY_API_KEY } = {}) {
  if (!service) throw new TypeError("GomokuChenService 必填");
  const fail = (reply, statusCode, code, message) => reply.code(statusCode).type("application/json").send({
    ok: false,
    error: { code, message }
  });
  function auth(req, reply, done) {
    if (!apiKey) return fail(reply, 503, "GATEWAY_KEY_MISSING", "游戏服务未配置");
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      reply.header("WWW-Authenticate", "Bearer");
      return fail(reply, 401, "UNAUTHORIZED", "游戏访问凭据无效");
    }
    done();
  }
  app.post("/api/game/gomoku/chen-move", { preHandler: auth }, async (req, reply) => {
    try {
      return reply.send(await service.chenMove(req.body));
    } catch (error) {
      if ((error.statusCode || 500) >= 500) {
        req.log.error({ errorCode: error.code, errorName: error.name }, "gomoku chen move failed");
      }
      return fail(
        reply,
        error.statusCode || 500,
        error.code || "GOMOKU_CHEN_MOVE_FAILED",
        error.statusCode < 500 ? error.message : "游戏服务暂时不可用"
      );
    }
  });
}

module.exports = { registerGomokuChenRoutes };
