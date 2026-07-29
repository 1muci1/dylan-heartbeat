"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function registerDrawGameRoutes(app, { service, apiKey = process.env.GATEWAY_API_KEY } = {}) {
  if (!service) throw new TypeError("DrawGameService 必填");
  function auth(req, reply, done) {
    if (!apiKey) return reply.code(503).send({ error: { code: "GATEWAY_KEY_MISSING", message: "游戏服务未配置" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    }
    done();
  }
  const handle = action => async (req, reply) => {
    try {
      return reply.send(action(req));
    } catch (error) {
      if ((error.statusCode || 500) >= 500) req.log.error({ errorCode: error.code, errorName: error.name }, "draw game API failed");
      return reply.code(error.statusCode || 500).send({ error: { code: error.code || "DRAW_GAME_FAILED", message: error.statusCode < 500 ? error.message : "游戏服务暂时不可用" } });
    }
  };
  app.post("/api/game/draw/start", { preHandler: auth }, handle(req => service.drawStart(req.body)));
  app.get("/api/game/draw/status/:roundId", { preHandler: auth }, handle(req => service.drawStatus(req.params.roundId)));
  app.post("/api/game/draw/guess/:roundId", { preHandler: auth }, handle(req => service.drawGuess(req.params.roundId, req.body)));
}

module.exports = { registerDrawGameRoutes };
