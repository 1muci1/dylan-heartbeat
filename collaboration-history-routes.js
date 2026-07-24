"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sendServiceError(req, reply, error, resource) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500) {
    req.log.error(
      { errorName: error?.name, errorCode: error?.code },
      "collaboration history API failed"
    );
  }
  return reply.code(statusCode).send({
    [resource]: null,
    error: {
      code: error?.code || "COLLABORATION_HISTORY_UNAVAILABLE",
      message: statusCode >= 500
        ? "Collaboration History 服务暂时不可用"
        : error.message
    }
  });
}

function registerCollaborationHistoryRoutes(app, {
  service,
  apiKey = process.env.GATEWAY_API_KEY
} = {}) {
  if (!app || typeof app.get !== "function") throw new TypeError("app 必填");
  if (
    !service ||
    typeof service.list !== "function" ||
    typeof service.get !== "function"
  ) {
    throw new TypeError("CollaborationHistoryService 必填");
  }

  function bearerAuth(req, reply, done) {
    if (!apiKey) {
      reply.code(503).send({
        records: null,
        error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" }
      });
      return;
    }
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      reply.code(401).header("WWW-Authenticate", "Bearer").send({
        records: null,
        error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" }
      });
      return;
    }
    done();
  }

  app.get("/api/collaboration/history", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      const records = service.list().map(record => ({
        ...record,
        participants: [...record.participants]
      }));
      return reply.send({ records, error: null });
    } catch (error) {
      return sendServiceError(req, reply, error, "records");
    }
  });

  app.get("/api/collaboration/history/:id", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      const value = service.get(req.params.id);
      if (!value) {
        return reply.code(404).send({
          record: null,
          error: {
            code: "COLLABORATION_HISTORY_NOT_FOUND",
            message: "议事记录不存在"
          }
        });
      }
      const record = { ...value, participants: [...value.participants] };
      return reply.send({ record, error: null });
    } catch (error) {
      return sendServiceError(req, reply, error, "record");
    }
  });
}

module.exports = {
  registerCollaborationHistoryRoutes,
  safeEqual,
  sendServiceError
};
