"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"], ["image/gif", ".gif"]
]);
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class MediaError extends Error {
  constructor(message, statusCode = 400, code = "MEDIA_ERROR") {
    super(message); this.name = "MediaError"; this.statusCode = statusCode; this.code = code;
  }
}

function detectImage(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { mimeType: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    return { mimeType: "image/gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", width: null, height: null };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { mimeType: "image/jpeg", height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (offset + 4 > buffer.length) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
    return { mimeType: "image/jpeg", width: null, height: null };
  }
  throw new MediaError("文件内容不是允许的图片格式", 415, "INVALID_IMAGE_SIGNATURE");
}

function cleanText(value, name, max) {
  const text = String(value || "").trim();
  if (text.length > max) throw new MediaError(`${name} 不能超过 ${max} 字符`);
  return text;
}

class MediaStore {
  constructor({ database, imageDir, stickerDir }) {
    this.db = database;
    this.imageDir = path.resolve(imageDir);
    this.stickerDir = path.resolve(stickerDir);
  }

  ensureDirectories() {
    fs.mkdirSync(this.imageDir, { recursive: true, mode: 0o750 });
    fs.mkdirSync(this.stickerDir, { recursive: true, mode: 0o750 });
  }

  saveBuffer(buffer, declaredMime, kind, metadata = {}) {
    const detected = detectImage(buffer);
    if (!MIME_EXTENSIONS.has(declaredMime) || detected.mimeType !== declaredMime) {
      throw new MediaError("声明的 MIME 与实际图片格式不一致", 415, "MIME_MISMATCH");
    }
    const id = crypto.randomUUID();
    const storageName = `${id}${MIME_EXTENSIONS.get(detected.mimeType)}`;
    const directory = kind === "sticker" ? this.stickerDir : this.imageDir;
    this.ensureDirectories();
    const temporary = path.join(directory, `.${storageName}.${crypto.randomUUID()}.tmp`);
    const destination = path.join(directory, storageName);
    fs.writeFileSync(temporary, buffer, { flag: "wx", mode: 0o640 });
    try { fs.renameSync(temporary, destination); } catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
    const timestamp = new Date().toISOString();
    try {
      if (kind === "sticker") {
        this.db.prepare(`INSERT INTO stickers
          (id, storage_name, original_name, mime_type, size, label, tags, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
          .run(id, storageName, path.basename(metadata.originalName || "").slice(0, 180) || null,
            detected.mimeType, buffer.length, cleanText(metadata.label, "label", 100) || null,
            cleanText(metadata.tags, "tags", 500) || null, timestamp, timestamp);
      } else {
        this.db.prepare(`INSERT INTO chat_attachments
          (id, session_id, kind, storage_name, mime_type, size, width, height, created_at)
          VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?)`)
          .run(id, metadata.sessionId || null, storageName, detected.mimeType, buffer.length,
            detected.width, detected.height, timestamp);
      }
    } catch (error) { try { fs.unlinkSync(destination); } catch {} throw error; }
    return kind === "sticker" ? this.getSticker(id, true) : this.getImage(id);
  }

  getImage(id) {
    if (!ID_RE.test(String(id || ""))) throw new MediaError("无效的媒体 ID", 400, "INVALID_MEDIA_ID");
    const row = this.db.prepare("SELECT * FROM chat_attachments WHERE id = ? AND kind = 'image'").get(id);
    if (!row) throw new MediaError("图片不存在", 404, "IMAGE_NOT_FOUND");
    return { id: row.id, url: `/api/v1/chat/media/${row.id}`, mimeType: row.mime_type,
      size: Number(row.size), width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height), storageName: row.storage_name };
  }

  publicSticker(row) {
    return { id: row.id, url: `/api/v1/chat/media/stickers/${row.id}`, mimeType: row.mime_type,
      size: Number(row.size), label: row.label || "", tags: row.tags || "", status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }

  getSticker(id, includeDeleted = false) {
    if (!ID_RE.test(String(id || ""))) throw new MediaError("无效的 Sticker ID", 400, "INVALID_STICKER_ID");
    const row = this.db.prepare(`SELECT * FROM stickers WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`).get(id);
    if (!row) throw new MediaError("Sticker 不存在", 404, "STICKER_NOT_FOUND");
    return { ...this.publicSticker(row), storageName: row.storage_name };
  }

  listStickers({ keyword = "", status = "active" } = {}) {
    if (!new Set(["active", "deleted", "all"]).has(status)) throw new MediaError("无效的 status");
    const where = [];
    const params = [];
    if (status === "active") where.push("deleted_at IS NULL");
    if (status === "deleted") where.push("deleted_at IS NOT NULL");
    const term = cleanText(keyword, "keyword", 100);
    if (term) { where.push("(label LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"); const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`; params.push(like, like); }
    return this.db.prepare(`SELECT * FROM stickers ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`).all(...params).map(row => this.publicSticker(row));
  }

  updateSticker(id, values = {}) {
    this.getSticker(id, true);
    const label = cleanText(values.label, "label", 100);
    const tags = cleanText(values.tags, "tags", 500);
    this.db.prepare("UPDATE stickers SET label = ?, tags = ?, updated_at = ? WHERE id = ?")
      .run(label || null, tags || null, new Date().toISOString(), id);
    return this.getSticker(id, true);
  }

  deleteSticker(id) {
    this.getSticker(id);
    const now = new Date().toISOString();
    this.db.prepare("UPDATE stickers SET status='deleted', deleted_at=?, updated_at=? WHERE id=?").run(now, now, id);
    return this.getSticker(id, true);
  }

  restoreSticker(id) {
    this.getSticker(id, true);
    this.db.prepare("UPDATE stickers SET status='active', deleted_at=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    return this.getSticker(id);
  }

  resolveFile(kind, id) {
    const item = kind === "sticker" ? this.getSticker(id, true) : this.getImage(id);
    const root = kind === "sticker" ? this.stickerDir : this.imageDir;
    const filename = path.resolve(root, item.storageName);
    if (!filename.startsWith(`${root}${path.sep}`)) throw new MediaError("无效的存储路径", 400, "INVALID_STORAGE_PATH");
    return { filename, mimeType: item.mimeType };
  }
}

module.exports = { MediaError, MediaStore, detectImage };
