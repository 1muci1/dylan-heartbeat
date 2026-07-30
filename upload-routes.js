"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { extractFile } = require("./file-extractors");
const { normalizeUploadError } = require("./upload-store");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function registerUploadRoutes(app, options = {}) {
  const { uploadStore, stickerImporter } = options;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  const auth = (req, reply, done) => {
    if (!apiKey) return reply.code(503).send({ ok: false, error: { code: "GATEWAY_KEY_MISSING", message: "上传服务暂时不可用" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ ok: false, error: { code: "UNAUTHORIZED", message: "上传授权失效" } });
    }
    done();
  };
  const run = handler => async (req, reply) => {
    try { return await handler(req, reply); }
    catch (rawError) {
      const error = normalizeUploadError(rawError);
      if (error.statusCode >= 500) req.log.error({ errorCode: error.code }, "upload operation failed");
      return reply.code(error.statusCode).send({ ok: false, error: { code: error.code, message: error.message } });
    }
  };
  async function receive(req, maxFiles = 5, options = {}) {
    const files = [];
    for await (const part of req.parts({ limits: { files: maxFiles, fileSize: 10 * 1024 * 1024, fields: 4, parts: maxFiles + 4 } })) {
      if (part.type !== "file") continue;
      if (files.length >= maxFiles) {
        const error = new Error("一次最多上传 5 个文件");
        error.statusCode = 413; error.code = "UPLOAD_TOO_LARGE"; throw error;
      }
      const buffer = await part.toBuffer();
      if (part.file.truncated || buffer.length > 10 * 1024 * 1024) {
        const error = new Error("单个文件不能超过 10 MiB");
        error.statusCode = 413; error.code = "UPLOAD_TOO_LARGE"; throw error;
      }
      const extraction = extractFile({ buffer, name: part.filename, mime: part.mimetype });
      if (extraction.kind === "archive" && options.allowArchive !== true) {
        const error = new Error("聊天暂不支持 ZIP 文件");
        error.statusCode = 415; error.code = "UPLOAD_TYPE_UNSUPPORTED"; throw error;
      }
      files.push(uploadStore.save({
        buffer, originalName: part.filename, mime: part.mimetype, extraction
      }));
    }
    if (!files.length) {
      const error = new Error("请选择文件");
      error.statusCode = 400; error.code = "UPLOAD_EMPTY"; throw error;
    }
    return files;
  }

  app.post("/api/v1/uploads/chat-file", { preHandler: auth }, run(async (req, reply) => {
    const files = await receive(req, 5);
    return reply.code(201).send({ ok: true, data: files });
  }));

  app.post("/api/v1/sticker-imports/preview", { preHandler: auth }, run(async (req, reply) => {
    const [file] = await receive(req, 1, { allowArchive: true });
    return reply.code(201).send(stickerImporter.preview(file.fileId));
  }));

  app.post("/api/v1/sticker-imports/confirm", { preHandler: auth }, run(req => (
    stickerImporter.confirm(req.body?.fileId, req.body?.selectedIndexes)
  )));

  app.get("/api/v1/sticker-imports", { preHandler: auth }, run(() => ({
    ok: true, data: stickerImporter.list()
  })));

  app.get("/api/v1/sticker-imports/assets/:name", { preHandler: auth }, run((req, reply) => {
    const filename = uploadStore.resolveAsset(req.params.name);
    const mime = new Map([
      [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
      [".webp", "image/webp"], [".gif", "image/gif"]
    ]).get(path.extname(filename).toLowerCase()) || "application/octet-stream";
    return reply.header("Cache-Control", "private, max-age=3600").type(mime).send(fs.createReadStream(filename));
  }));

  return { auth };
}

module.exports = { registerUploadRoutes };
