"use strict";

const crypto = require("node:crypto");
const { SessionError, SessionStore } = require("./session-store");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sendError(req, reply, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) req.log.error({ err: error }, "session operation failed");
  return reply.code(statusCode).send({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: statusCode >= 500 ? "Session 服务暂时不可用" : error.message
    }
  });
}

function registerSessionRoutes(app, options = {}) {
  const ownsStore = !options.store;
  const store = options.store || new SessionStore({ filename: options.filename });
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;

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

  app.get("/api/v1/chat/sessions", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return { sessions: store.listSessions({ limit: req.query?.limit }) };
    } catch (error) { return sendError(req, reply, error); }
  });

  app.post("/api/v1/chat/sessions", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return reply.code(201).send({ session: store.createSession(req.body?.title) });
    } catch (error) { return sendError(req, reply, error); }
  });

  app.patch("/api/v1/chat/sessions/:id", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      if (!req.body || typeof req.body.title !== "string") throw new SessionError("title 必填");
      return { session: store.renameSession(req.params.id, req.body.title) };
    } catch (error) { return sendError(req, reply, error); }
  });

  app.delete("/api/v1/chat/sessions/:id", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      store.deleteSession(req.params.id);
      return reply.code(204).send();
    } catch (error) { return sendError(req, reply, error); }
  });

  app.get("/api/v1/chat/sessions/:id/messages", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return store.listMessages(req.params.id, { limit: req.query?.limit, before: req.query?.before });
    } catch (error) { return sendError(req, reply, error); }
  });

  if (ownsStore) app.addHook("onClose", () => store.close());

  return { store, bearerAuth };
}

module.exports = { registerSessionRoutes };
