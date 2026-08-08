"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { extractDocxText } = require("./file-extractors");
const { ThemeAssetError } = require("./theme-asset-service");
function safeEqual(actual, expected) { const left = Buffer.from(String(actual)); const right = Buffer.from(String(expected)); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function registerThemeAssetRoutes(app, { localizer, store, previewService, previewStore, apiKey = process.env.GATEWAY_API_KEY } = {}) {
  const auth = (req, reply, done) => { if (!apiKey) return reply.code(503).send({ ok:false,error:{code:"GATEWAY_KEY_MISSING",message:"主题素材服务暂不可用"} }); if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) return reply.code(401).header("WWW-Authenticate","Bearer").send({ok:false,error:{code:"UNAUTHORIZED",message:"Unauthorized"}}); done(); };
  const run = handler => async (req, reply) => { try { return await handler(req, reply); } catch (raw) { const error = raw instanceof ThemeAssetError ? raw : new ThemeAssetError("主题素材服务暂不可用",500,"THEME_ASSET_INTERNAL_ERROR"); if (error.statusCode >= 500) req.log.error({ errorCode:error.code }, "theme asset operation failed"); return reply.code(error.statusCode).send({ok:false,error:{code:error.code,message:error.message}}); } };
  app.post("/api/theme/assets/localize", { preHandler: auth }, run(async req => ({ ok:true,data:await localizer.localize(req.body?.assets) })));
  app.post("/api/theme/assets/preview", { preHandler: auth }, run(async req => ({ ok:true,data:await previewService.preview(req.body?.assets) })));
  app.post("/api/theme/import/extract", { preHandler: auth }, run(async req => {
    const part = await req.file({ limits:{files:1,fileSize:1024*1024,parts:2} }); if (!part) throw new ThemeAssetError("请选择美化文件",400,"THEME_IMPORT_FILE_REQUIRED");
    const extension = path.extname(String(part.filename || "")).toLowerCase(); if (![".docx",".txt",".css"].includes(extension)) throw new ThemeAssetError("只支持 DOCX/TXT/CSS",415,"THEME_IMPORT_TYPE_UNSUPPORTED");
    const buffer = await part.toBuffer(); if (part.file.truncated || buffer.length > 1024*1024) throw new ThemeAssetError("美化文件不能超过 1MB",413,"THEME_IMPORT_TOO_LARGE");
    const text = extension === ".docx" ? extractDocxText(buffer) : buffer.toString("utf8").replace(/\0/gu,"").slice(0,200*1024);
    return {ok:true,data:{filename:path.basename(part.filename).slice(0,180),format:extension.slice(1),text}};
  }));
  app.get("/api/theme/assets/preview/:id", run((req,reply)=>{const file=previewStore.resolve(req.params.id);return reply.header("Cache-Control","private, max-age=3600").header("X-Content-Type-Options","nosniff").type(file.mimeType).send(fs.createReadStream(file.filename));}));
  app.get("/api/theme/assets/:id", run((req,reply)=>{const file=store.resolve(req.params.id);return reply.header("Cache-Control","public, max-age=31536000, immutable").header("X-Content-Type-Options","nosniff").type(file.mimeType).send(fs.createReadStream(file.filename));}));
}
module.exports = { registerThemeAssetRoutes };
