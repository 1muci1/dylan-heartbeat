"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function statusFor(error) {
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  if (error?.code === "COLLABORATION_ROOM_NOT_FOUND") return 404;
  if (error?.code === "COLLABORATION_TURN_IN_PROGRESS" ||
      error?.code === "COLLABORATION_ROOM_CONFLICT") return 409;
  if (error?.code?.startsWith("COLLABORATION_AGENT_")) return 502;
  return 400;
}

function sendError(req, reply, error) {
  const statusCode = statusFor(error);
  if (statusCode >= 500) {
    req.log.error(
      { errorName: error?.name, errorCode: error?.code },
      "collaboration API failed"
    );
  }
  return reply.code(statusCode).send({
    room: null,
    error: {
      code: error?.code || "COLLABORATION_REQUEST_INVALID",
      message: statusCode >= 500 ? "Collaboration 服务暂时不可用" : error.message
    }
  });
}

function registerCollaborationRoutes(app, {
  runtime,
  sessionService,
  apiKey = process.env.GATEWAY_API_KEY
} = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
    throw new TypeError("app 必填");
  }
  if (
    !runtime ||
    typeof runtime.createDiscussion !== "function" ||
    typeof runtime.runTurn !== "function"
  ) {
    throw new TypeError("CollaborationRuntime 必填");
  }
  if (!sessionService || typeof sessionService.getContext !== "function") {
    throw new TypeError("CollaborationSessionService 必填");
  }

  function bearerAuth(req, reply, done) {
    if (!apiKey) {
      reply.code(503).send({
        room: null,
        error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" }
      });
      return;
    }
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      reply.code(401).header("WWW-Authenticate", "Bearer").send({
        room: null,
        error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" }
      });
      return;
    }
    done();
  }

  app.post("/api/collaboration/rooms", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      const input = req.body;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw Object.assign(new Error("请求体格式无效"), {
          code: "COLLABORATION_REQUEST_INVALID"
        });
      }
      const unknown = Object.keys(input).find(
        field => !["topic", "participants"].includes(field)
      );
      if (unknown) {
        throw Object.assign(new Error(`不允许传入字段：${unknown}`), {
          code: "COLLABORATION_REQUEST_INVALID"
        });
      }
      const room = runtime.createDiscussion({
        topic: input.topic,
        participants: input.participants
      });
      return reply.code(201).send({ room, error: null });
    } catch (error) {
      return sendError(req, reply, error);
    }
  });

  app.post("/api/collaboration/rooms/:id/run", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      const room = await runtime.runTurn(req.params.id);
      return reply.send({ room, error: null });
    } catch (error) {
      return sendError(req, reply, error);
    }
  });

  app.get("/api/collaboration/rooms/:id", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return reply.send({ room: sessionService.getContext(req.params.id), error: null });
    } catch (error) {
      return sendError(req, reply, error);
    }
  });
}

module.exports = {
  registerCollaborationRoutes,
  safeEqual,
  statusFor
};
