"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { extractDocxText } = require("./file-extractors");
const { ThemeAssetError } = require("./theme-asset-service");
function safeEqual(actual, expected) { const left = Buffer.from(String(actual)); const right = Buffer.from(String(expected)); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function registerThemeAssetRoutes(app, { localizer, store, previewService, previewStore, apiKey = process.env.GATEWAY_API_KEY } = {}) {
  const auth = (req, reply, done) => { if (!apiKey) return reply.code(503).send({ ok:false,error:{code:"GATEWAY_KEY_MISSING",message:"主题素材服务暂不可用"} }); if (!safeEqual(req.headers.authorization || "", `Bearer ${apiKey}`)) return reply.code(401).header("WWW-Authenticate","Bearer").send({ok:false,error:{code:"UNAUTHORIZED",message:"Unauthorized"}}); done(); };
  const run = handler => async (req, reply) => { try { return await handler(req, reply); } catch (raw) { const error = raw instanceof ThemeAssetError ? raw : raw?.code === "FST_REQ_FILE_TOO_LARGE" ? new ThemeAssetError("图片超过允许大小",413,"THEME_ASSET_TOO_LARGE") : new ThemeAssetError("主题素材服务暂不可用",500,"THEME_ASSET_INTERNAL_ERROR"); if (error.statusCode >= 500) req.log.error({ errorCode:error.code }, "theme asset operation failed"); return reply.code(error.statusCode).send({ok:false,error:{code:error.code,message:error.message}}); } };
  app.post("/api/theme/assets/localize", { preHandler: auth }, run(async req => ({ ok:true,data:await localizer.localize(req.body?.assets) })));
  app.post("/api/theme/assets/preview", { preHandler: auth }, run(async req => ({ ok:true,data:await previewService.preview(req.body?.assets) })));
  app.post("/api/theme/assets/upload", { preHandler: auth }, run(async req => {
    const part = await req.file({ limits:{files:1,fileSize:2*1024*1024,fields:2,parts:3} }); if (!part) throw new ThemeAssetError("请选择图片",400,"THEME_ASSET_FILE_REQUIRED");
    const buffer = await part.toBuffer(); if (part.file.truncated || buffer.length > 2*1024*1024) throw new ThemeAssetError("图片超过允许大小",413,"THEME_ASSET_TOO_LARGE");
    return { ok:true, data:store.upload(buffer, { mimeType:String(part.mimetype || "").toLowerCase(), filename:part.filename, category:req.query?.category || "other" }) };
  }));
  app.get("/api/theme/assets/library", { preHandler: auth }, run(async req => { const view=req.query?.view || (req.query?.includeDeleted === "1" ? "all" : "active"); return { ok:true,data:{items:store.list({view})} }; }));
  app.patch("/api/theme/assets/:id", { preHandler: auth }, run(async req => ({ ok:true,data:store.update(req.params.id, req.body) })));
  app.post("/api/theme/assets/:id/used", { preHandler: auth }, run(async req => ({ ok:true,data:store.markUsed(req.params.id) })));
  app.post("/api/theme/assets/duplicates/scan", { preHandler: auth }, run(async req => ({ ok:true,data:await store.scanDuplicateHashes({limit:req.body?.limit}) })));
  app.post("/api/theme/assets/:id/restore", { preHandler: auth }, run(async req => ({ ok:true,data:store.restore(req.params.id) })));
  app.delete("/api/theme/assets/:id", { preHandler: auth }, run(async req => ({ ok:true,data:store.delete(req.params.id) })));
  app.post("/api/theme/import/extract", { preHandler: auth }, run(async req => {
    const part = await req.file({ limits:{files:1,fileSize:1024*1024,parts:2} }); if (!part) throw new ThemeAssetError("请选择美化文件",400,"THEME_IMPORT_FILE_REQUIRED");
    const extension = path.extname(String(part.filename || "")).toLowerCase(); if (![".docx",".txt",".css"].includes(extension)) throw new ThemeAssetError("只支持 DOCX/TXT/CSS",415,"THEME_IMPORT_TYPE_UNSUPPORTED");
    const buffer = await part.toBuffer(); if (part.file.truncated || buffer.length > 1024*1024) throw new ThemeAssetError("美化文件不能超过 1MB",413,"THEME_IMPORT_TOO_LARGE");
    const text = extension === ".docx" ? extractDocxText(buffer) : buffer.toString("utf8").replace(/\0/gu,"").slice(0,200*1024);
    return {ok:true,data:{filename:path.basename(part.filename).slice(0,180),format:extension.slice(1),text}};
  }));
  app.get("/api/theme/assets/preview/:id", run((req,reply)=>{
    let file;
    try { file=previewStore.resolve(req.params.id); }
    catch (error) {
      if (error instanceof ThemeAssetError && ["THEME_ASSET_ID_INVALID","THEME_ASSET_NOT_FOUND"].includes(error.code)) throw new ThemeAssetError("预览不存在",404,"THEME_ASSET_NOT_FOUND");
      throw error;
    }
    return reply.header("Cache-Control","private, max-age=3600").header("X-Content-Type-Options","nosniff").type(file.mimeType).send(fs.createReadStream(file.filename));
  }));
  app.get("/api/theme/assets/trash/:id", { preHandler:auth }, run((req,reply)=>{const file=store.resolveTrash(req.params.id);return reply.header("Cache-Control","private, max-age=300").header("X-Content-Type-Options","nosniff").type(file.mimeType).send(fs.createReadStream(file.filename));}));
  app.get("/api/theme/assets/:id", run((req,reply)=>{const file=store.resolve(req.params.id);return reply.header("Cache-Control","public, max-age=31536000, immutable").header("X-Content-Type-Options","nosniff").type(file.mimeType).send(fs.createReadStream(file.filename));}));
}
module.exports = { registerThemeAssetRoutes };
