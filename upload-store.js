"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { UploadParseError, extensionOf } = require("./file-extractors");

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".dll", ".js", ".cjs", ".mjs", ".html", ".htm"
]);
const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".docx", ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".webp", ".gif"
]);

class UploadError extends Error {
  constructor(message, statusCode = 400, code = "UPLOAD_PARSE_FAILED") {
    super(message);
    this.name = "UploadError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function safeDisplayName(value) {
  const basename = path.basename(String(value || "file").replace(/[\0-\x1f\x7f]/g, "")).trim();
  return (basename || "file").slice(0, 180);
}

class UploadStore {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.UPLOAD_STORE_DIR || "runtime-data/uploads");
    this.indexFile = path.resolve(options.indexFile || process.env.UPLOAD_INDEX_FILE || "runtime-data/upload-index.json");
    this.maxFileSize = Number(options.maxFileSize) || MAX_FILE_SIZE;
  }

  readIndex() {
    try {
      const value = JSON.parse(fs.readFileSync(this.indexFile, "utf8"));
      return value && value.files ? value : { version: 1, files: {} };
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, files: {} };
      throw new UploadError("上传索引暂时不可用", 500, "UPLOAD_STORE_FAILED");
    }
  }

  writeIndex(index) {
    try { atomicJson(this.indexFile, index); }
    catch { throw new UploadError("上传索引暂时不可用", 500, "UPLOAD_STORE_FAILED"); }
  }

  save({ buffer, originalName, mime, extraction }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new UploadError("上传文件为空", 400, "UPLOAD_EMPTY");
    if (buffer.length > this.maxFileSize) throw new UploadError("单个文件不能超过 10 MiB", 413, "UPLOAD_TOO_LARGE");
    const safeName = safeDisplayName(originalName);
    const extension = extensionOf(safeName);
    if (DANGEROUS_EXTENSIONS.has(extension) || !ALLOWED_EXTENSIONS.has(extension)) {
      throw new UploadError("这种文件类型不允许上传", 415, "UPLOAD_TYPE_UNSUPPORTED");
    }
    const fileId = crypto.randomUUID();
    const storageName = `${fileId}${extension}`;
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    const destination = path.join(this.rootDir, storageName);
    const temporary = path.join(this.rootDir, `.${storageName}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, buffer, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, destination);
    const record = {
      fileId, safeName, storageName, mime: String(mime || "application/octet-stream"),
      size: buffer.length, createdAt: new Date().toISOString(),
      kind: extraction.kind, extractedText: extraction.extractedText || "",
      extractedTextLength: extraction.extractedTextLength || 0,
      extractedTextPreview: extraction.extractedTextPreview || "",
      canUseInChat: extraction.canUseInChat === true
    };
    try {
      const index = this.readIndex();
      index.files[fileId] = record;
      this.writeIndex(index);
    } catch (error) {
      try { fs.unlinkSync(destination); } catch {}
      throw error;
    }
    return this.publicRecord(record);
  }

  saveAsset(buffer, extension) {
    const normalized = String(extension || "").toLowerCase();
    if (!new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]).has(normalized)) {
      throw new UploadError("压缩包里包含不支持的图片", 415, "UPLOAD_TYPE_UNSUPPORTED");
    }
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > this.maxFileSize) {
      throw new UploadError("表情图片为空或过大", 413, "UPLOAD_TOO_LARGE");
    }
    const assetId = crypto.randomUUID();
    const storageName = `${assetId}${normalized}`;
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    const destination = path.join(this.rootDir, storageName);
    const temporary = path.join(this.rootDir, `.${storageName}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, buffer, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, destination);
    return { assetId, storageName };
  }

  resolveAsset(storageName) {
    const safeName = path.basename(String(storageName || ""));
    if (safeName !== storageName || !/^[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)$/i.test(safeName)) {
      throw new UploadError("无效的表情资源", 400, "UPLOAD_INVALID");
    }
    const filename = path.resolve(this.rootDir, safeName);
    if (!filename.startsWith(`${this.rootDir}${path.sep}`) || !fs.existsSync(filename)) {
      throw new UploadError("表情资源不存在", 404, "UPLOAD_NOT_FOUND");
    }
    return filename;
  }

  get(fileId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(fileId || ""))) throw new UploadError("无效的文件 ID", 400, "UPLOAD_INVALID");
    const record = this.readIndex().files[fileId];
    if (!record) throw new UploadError("文件不存在或已失效", 404, "UPLOAD_NOT_FOUND");
    return { ...record };
  }

  readBuffer(fileId) {
    const record = this.get(fileId);
    const filename = path.resolve(this.rootDir, record.storageName);
    if (!filename.startsWith(`${this.rootDir}${path.sep}`)) throw new UploadError("无效的存储路径", 400, "UPLOAD_INVALID");
    return { record, buffer: fs.readFileSync(filename), filename };
  }

  publicRecord(record) {
    return {
      ok: true, fileId: record.fileId, name: record.safeName, mime: record.mime,
      size: record.size, kind: record.kind, extractedTextPreview: record.extractedTextPreview,
      extractedTextLength: record.extractedTextLength, canUseInChat: record.canUseInChat
    };
  }

  chatContext(fileId) {
    const record = this.get(fileId);
    if (!record.canUseInChat || !record.extractedText) {
      return `[附件：${record.safeName}，${record.mime}]\n这个文件已上传，但暂时不能提取文字内容。`;
    }
    return `[附件：${record.safeName}，${record.mime}]\n${record.extractedText}`;
  }
}

function normalizeUploadError(error) {
  if (error instanceof UploadError) return error;
  if (error instanceof UploadParseError) return new UploadError(error.message, error.statusCode, error.code);
  if (error && typeof error.code === "string" && Number(error.statusCode) >= 400) {
    return new UploadError(error.message || "文件处理失败", Number(error.statusCode), error.code);
  }
  return new UploadError("文件处理暂时失败", 500, "UPLOAD_PARSE_FAILED");
}

module.exports = {
  ALLOWED_EXTENSIONS,
  DANGEROUS_EXTENSIONS,
  MAX_FILE_SIZE,
  UploadError,
  UploadStore,
  atomicJson,
  normalizeUploadError,
  safeDisplayName
};
