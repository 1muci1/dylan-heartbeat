"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { MediaError } = require("./media-store");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual)); const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function envelope(data, meta = {}) { return { data, meta, error: null }; }
function errorReply(req, reply, error) {
  const status = error.statusCode || 500;
  if (status >= 500) req.log.error({ errorName: error.name, errorCode: error.code }, "media operation failed");
  return reply.code(status).send({ data: null, meta: {}, error: { code: error.code || "INTERNAL_ERROR", message: status >= 500 ? "媒体服务暂时不可用" : error.message } });
}

function registerMediaRoutes(app, { store, sessionStore, apiKey = process.env.GATEWAY_API_KEY }) {
  const auth = (req, reply, done) => {
    if (!apiKey) return reply.code(503).send({ data: null, meta: {}, error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) return reply.code(401).header("WWW-Authenticate", "Bearer").send({ data: null, meta: {}, error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
    done();
  };
  const run = handler => async (req, reply) => { try { return await handler(req, reply); } catch (error) { return errorReply(req, reply, error); } };

  app.post("/api/v1/chat/uploads/images", { preHandler: auth }, run(async (req, reply) => {
    const sessionId = String(req.headers["x-session-id"] || "").trim() || null;
    if (sessionId) sessionStore.getSession(sessionId);
    const files = [];
    for await (const part of req.parts({ limits: { files: 5, fileSize: 10 * 1024 * 1024, fields: 4, parts: 9 } })) {
      if (part.type !== "file") continue;
      if (files.length >= 4) throw new MediaError("每次最多上传 4 张图片", 413, "TOO_MANY_FILES");
      const buffer = await part.toBuffer();
      if (part.file.truncated || buffer.length > 10 * 1024 * 1024) throw new MediaError("单张图片不能超过 10 MiB", 413, "FILE_TOO_LARGE");
      files.push({ buffer, mimeType: part.mimetype });
    }
    if (!files.length) throw new MediaError("至少选择一张图片", 400, "FILE_REQUIRED");
    const saved = files.map(file => store.saveBuffer(file.buffer, file.mimeType, "image", { sessionId }));
    return reply.code(201).send(envelope(saved, { count: saved.length }));
  }));

  app.get("/api/v1/chat/media/:id", { preHandler: auth }, run((req, reply) => {
    const file = store.resolveFile("image", req.params.id);
    return reply.header("Cache-Control", "private, max-age=3600").type(file.mimeType).send(fs.createReadStream(file.filename));
  }));
  app.get("/api/v1/chat/media/stickers/:id", { preHandler: auth }, run((req, reply) => {
    const file = store.resolveFile("sticker", req.params.id);
    return reply.header("Cache-Control", "private, max-age=3600").type(file.mimeType).send(fs.createReadStream(file.filename));
  }));

  app.get("/api/v1/stickers", { preHandler: auth }, run(req => envelope(store.listStickers(req.query || {}))));
  app.post("/api/v1/stickers", { preHandler: auth }, run(async (req, reply) => {
    let file = null; const fields = {};
    for await (const part of req.parts({ limits: { files: 2, fileSize: 5 * 1024 * 1024, fields: 8, parts: 10 } })) {
      if (part.type === "file") {
        if (file) throw new MediaError("每次只能上传一个 Sticker", 413, "TOO_MANY_FILES");
        const buffer = await part.toBuffer();
        if (part.file.truncated || buffer.length > 5 * 1024 * 1024) throw new MediaError("Sticker 不能超过 5 MiB", 413, "FILE_TOO_LARGE");
        file = { buffer, mimeType: part.mimetype, originalName: part.filename };
      } else fields[part.fieldname] = part.value;
    }
    if (!file) throw new MediaError("请选择 Sticker 图片", 400, "FILE_REQUIRED");
    const saved = store.saveBuffer(file.buffer, file.mimeType, "sticker", { ...file, label: fields.label, tags: fields.tags });
    return reply.code(201).send(envelope(saved));
  }));
  app.patch("/api/v1/stickers/:id", { preHandler: auth }, run(req => envelope(store.updateSticker(req.params.id, req.body || {}))));
  app.delete("/api/v1/stickers/:id", { preHandler: auth }, run(req => envelope(store.deleteSticker(req.params.id))));
  app.post("/api/v1/stickers/:id/restore", { preHandler: auth }, run(req => envelope(store.restoreSticker(req.params.id))));
  return { auth };
}

module.exports = { registerMediaRoutes };
