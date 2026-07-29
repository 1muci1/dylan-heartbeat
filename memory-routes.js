"use strict";

const crypto = require("node:crypto");
const { StructuredMemoryError } = require("./structured-memory-store");
const { detectMemoryIntent } = require("./agent-memory-query");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function envelope(data, meta = {}) {
  return { data, meta, error: null };
}

function sendError(req, reply, error) {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) req.log.error({ errorName: error.name, errorCode: error.code }, "memory API failed");
  return reply.code(statusCode).send({
    data: null,
    meta: {},
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: statusCode >= 500 ? "记忆服务暂时不可用" : error.message
    }
  });
}

function registerMemoryRoutes(app, options) {
  const store = options.store;
  const retriever = options.retriever;
  const contextBuilder = options.contextBuilder;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  if (!store) throw new TypeError("store 必填");

  function bearerAuth(req, reply, done) {
    const auth = req.headers.authorization || "";
    if (!apiKey) {
      reply.code(503).send({ data: null, meta: {}, error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
      return;
    }
    if (!safeEqual(auth, `Bearer ${apiKey}`)) {
      reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ data: null, meta: {}, error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
      return;
    }
    done();
  }

  const route = handler => async (req, reply) => {
    try { return await handler(req, reply); } catch (error) { return sendError(req, reply, error); }
  };

  app.get("/api/v1/memories", { preHandler: bearerAuth }, route(req => {
    const result = store.list(req.query || {});
    return envelope(result.items, result.meta);
  }));

  app.post("/api/v1/memories", { preHandler: bearerAuth }, route((req, reply) => (
    reply.code(201).send(envelope(store.create(req.body, { eventContext: { source: "memory-api" } })))
  )));

  app.get("/api/v1/memories/stats", { preHandler: bearerAuth }, route(() => envelope(store.stats())));

  app.get("/admin/memory/debug", { preHandler: bearerAuth, logLevel: "silent" }, route(req => {
    if (!retriever || !contextBuilder) {
      throw new StructuredMemoryError("Memory 诊断未配置", 503, "MEMORY_DEBUG_UNAVAILABLE");
    }
    const query = String(req.query?.query || "").trim().slice(0, 500);
    const memoryIntent = detectMemoryIntent(query);
    const limit = memoryIntent === "overview" ? 24 : 12;
    const characterBudget = memoryIntent === "overview" ? 12000 : 5000;
    const result = retriever.retrieve({ query, memoryIntent, limit, characterBudget });
    const context = contextBuilder.build(result, { maxItems: limit, maxCharacters: characterBudget });
    const activeCount = store.list({ page: 1, limit: 1, status: "active" }).meta.total;
    const archivedCount = store.list({ page: 1, limit: 1, status: "archived" }).meta.total;
    const deletedCount = store.list({ page: 1, limit: 1, status: "deleted" }).meta.total;
    return envelope({
      query,
      normalizedQuery: result.meta.normalizedQuery,
      memoryIntent,
      candidates: result.meta.candidateCount,
      selectedAlwaysOn: result.items
        .filter(item => item.layer === "core")
        .map(({ id, title, type, importance }) => ({ id, title, type, importance })),
      selectedRelevant: result.items
        .filter(item => item.layer === "relevant")
        .map(({ id, title, type, importance }) => ({ id, title, type, importance })),
      selectedRecent: result.items
        .filter(item => item.layer === "recent")
        .map(({ id, title, type, importance }) => ({ id, title, type, importance })),
      selectedGroups: result.meta.selectedGroups,
      perGroupCount: result.meta.perGroupCount,
      topTitlesByGroup: Object.fromEntries((result.meta.selectedGroups || []).map(group => [
        group,
        result.items
          .filter(item => item.sourceGroup === group)
          .slice(0, 6)
          .map(({ id, title, type, importance, content }) => ({
            id,
            title,
            type,
            importance,
            summary: String(content || "").replace(/\s+/g, " ").slice(0, 100)
          }))
      ])),
      rejectedReasons: {
        ...result.meta.rejectedReasons,
        archived: archivedCount,
        deleted: deletedCount,
        activeNotSelected: Math.max(0, activeCount - result.items.length - result.meta.rejectedCount)
      },
      rejectedCount: result.meta.rejectedCount,
      finalInjectedCount: result.items.length,
      finalInjectedTokenEstimate: Math.ceil((context?.content?.length || 0) / 4)
    });
  }));

  app.get("/api/v1/memories/:id", { preHandler: bearerAuth }, route(req => envelope(
    store.get(req.params.id, { includeDeleted: req.query?.includeDeleted === "true" })
  )));

  app.patch("/api/v1/memories/:id", { preHandler: bearerAuth }, route(req => envelope(store.update(req.params.id, req.body, { source: "memory-api" }))));

  app.delete("/api/v1/memories/:id", { preHandler: bearerAuth }, route(req => {
    store.softDelete(req.params.id, { source: "memory-api" });
    return envelope({ id: req.params.id, status: "deleted" });
  }));

  app.post("/api/v1/memories/:id/restore", { preHandler: bearerAuth }, route(req => envelope(store.restore(req.params.id, { source: "memory-api" }))));

  app.get("/api/v1/memories/:id/comments", { preHandler: bearerAuth }, route(req => envelope(store.listComments(req.params.id))));

  app.post("/api/v1/memories/:id/comments", { preHandler: bearerAuth }, route((req, reply) => (
    reply.code(201).send(envelope(store.createComment(req.params.id, req.body)))
  )));

  app.patch("/api/v1/memories/:id/comments/:commentId", { preHandler: bearerAuth }, route(req => envelope(
    store.updateComment(req.params.id, req.params.commentId, req.body)
  )));

  app.delete("/api/v1/memories/:id/comments/:commentId", { preHandler: bearerAuth }, route(req => {
    store.deleteComment(req.params.id, req.params.commentId);
    return envelope({ id: req.params.commentId, status: "deleted" });
  }));

  return { bearerAuth };
}

module.exports = { envelope, registerMemoryRoutes };
