"use strict";

const crypto = require("node:crypto");

const MEMORY_TYPES = new Set(["MEMORY", "EVENT", "MOMENT", "PROMISE", "WISHLIST", "NOTE"]);
const MEMORY_STATUSES = new Set(["active", "archived", "deleted"]);
const MAX_TITLE = 200;
const MAX_CONTENT = 20000;
const MAX_SOURCE = 200;
const MAX_AUTHOR = 100;
const MAX_COMMENT = 5000;

class StructuredMemoryError extends Error {
  constructor(message, statusCode = 400, code = "MEMORY_ERROR") {
    super(message);
    this.name = "StructuredMemoryError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function hashContent(content) {
  const normalized = String(content).trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function text(value, field, max, options = {}) {
  if (value == null && options.nullable) return null;
  if (typeof value !== "string") throw new StructuredMemoryError(`${field} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized && !options.allowEmpty) throw new StructuredMemoryError(`${field} 不能为空`);
  if (normalized.length > max) throw new StructuredMemoryError(`${field} 不能超过 ${max} 字符`);
  return normalized || null;
}

function memoryType(value, fallback = "MEMORY") {
  const type = String(value || fallback).trim().toUpperCase();
  if (!MEMORY_TYPES.has(type)) throw new StructuredMemoryError("不支持的记忆类型");
  return type;
}

function memoryStatus(value, fallback = "active") {
  const status = String(value || fallback).trim().toLowerCase();
  if (!MEMORY_STATUSES.has(status)) throw new StructuredMemoryError("不支持的记忆状态");
  return status;
}

function importance(value, fallback = 3) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new StructuredMemoryError("importance 必须是 1 到 5 的整数");
  }
  return number;
}

function isoDate(value, field = "日期", options = {}) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new StructuredMemoryError(`${field} 必须是日期字符串`);
  const raw = value.trim();
  const expanded = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${options.endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : raw;
  const parsed = new Date(expanded);
  if (Number.isNaN(parsed.getTime())) throw new StructuredMemoryError(`${field} 格式无效`);
  return parsed.toISOString();
}

function publicItem(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    source: row.source,
    sourceSessionId: row.source_session_id,
    importance: Number(row.importance),
    status: row.status,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function publicComment(row) {
  return {
    id: row.id,
    memoryId: row.memory_id,
    author: row.author,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLegacyItem(item) {
  const raw = typeof item === "string" ? { content: item } : item;
  const content = text(String(raw.content ?? raw.summary ?? raw.text ?? raw.title ?? ""), "content", MAX_CONTENT);
  return {
    type: memoryType(raw.type, "MEMORY"),
    title: typeof raw.title === "string" && raw.title.trim() && raw.title.trim() !== content
      ? text(raw.title, "title", MAX_TITLE, { nullable: true })
      : null,
    content,
    source: text(String(raw.source || "memory.json"), "source", MAX_SOURCE, { nullable: true }),
    sourceSessionId: null,
    importance: importance(raw.importance),
    occurredAt: isoDate(raw.occurredAt || raw.occurred_at || raw.time, "time")
  };
}

class StructuredMemoryStore {
  constructor(options) {
    if (!options?.database) throw new TypeError("database 必填");
    this.db = options.database;
    this.filename = options.filename || null;
  }

  validateSourceSession(id) {
    if (id == null || id === "") return null;
    if (typeof id !== "string" || id.length > 64) throw new StructuredMemoryError("sourceSessionId 格式无效");
    const session = this.db.prepare("SELECT id FROM chat_sessions WHERE id=?").get(id);
    if (!session) throw new StructuredMemoryError("sourceSessionId 对应的 Session 不存在", 400, "SOURCE_SESSION_NOT_FOUND");
    return id;
  }

  get(id, options = {}) {
    const row = this.db.prepare("SELECT * FROM memory_items WHERE id = ?").get(String(id));
    if (!row || (!options.includeDeleted && row.deleted_at)) {
      throw new StructuredMemoryError("记忆不存在", 404, "MEMORY_NOT_FOUND");
    }
    return publicItem(row);
  }

  list(query = {}) {
    const page = query.page == null ? 1 : Number(query.page);
    const limit = query.limit == null ? 20 : Number(query.limit);
    if (!Number.isInteger(page) || page < 1) throw new StructuredMemoryError("page 必须是正整数");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new StructuredMemoryError("limit 必须是 1 到 100 的整数");
    const where = [];
    const params = [];
    const status = memoryStatus(query.status, "active");
    if (status === "deleted") where.push("deleted_at IS NOT NULL");
    else {
      where.push("deleted_at IS NULL");
      where.push("status = ?");
      params.push(status);
    }
    if (query.type) { where.push("type = ?"); params.push(memoryType(query.type)); }
    if (query.keyword != null && query.keyword !== "") {
      const keyword = text(String(query.keyword), "keyword", 200).replace(/[\\%_]/g, value => `\\${value}`);
      where.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')");
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const dateFrom = isoDate(query.dateFrom, "dateFrom");
    const dateTo = isoDate(query.dateTo, "dateTo", { endOfDay: true });
    if (dateFrom) { where.push("occurred_at >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("occurred_at <= ?"); params.push(dateTo); }
    if (dateFrom && dateTo && dateFrom > dateTo) throw new StructuredMemoryError("dateFrom 不能晚于 dateTo");
    const orders = {
      newest: "COALESCE(occurred_at, created_at) DESC, id DESC",
      oldest: "COALESCE(occurred_at, created_at) ASC, id ASC",
      updated: "updated_at DESC, id DESC",
      importance: "importance DESC, updated_at DESC"
    };
    const sort = query.sort || "newest";
    if (!orders[sort]) throw new StructuredMemoryError("sort 参数无效");
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM memory_items ${whereSql}`).get(...params).count);
    const rows = this.db.prepare(`SELECT * FROM memory_items ${whereSql} ORDER BY ${orders[sort]} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    return {
      items: rows.map(publicItem),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  create(input, options = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new StructuredMemoryError("请求体必须是对象");
    const content = text(input.content, "content", MAX_CONTENT);
    const item = {
      id: options.id || crypto.randomUUID(),
      type: memoryType(input.type),
      title: input.title == null || input.title === "" ? null : text(input.title, "title", MAX_TITLE, { nullable: true }),
      content,
      source: input.source == null || input.source === "" ? null : text(input.source, "source", MAX_SOURCE, { nullable: true }),
      sourceSessionId: this.validateSourceSession(input.sourceSessionId),
      importance: importance(input.importance),
      status: memoryStatus(input.status),
      occurredAt: isoDate(input.occurredAt, "occurredAt")
    };
    const timestamp = options.timestamp || new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO memory_items
        (id,type,title,content,source,source_session_id,importance,status,occurred_at,created_at,updated_at,deleted_at,content_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(item.id, item.type, item.title, item.content, item.source, item.sourceSessionId,
        item.importance, item.status, item.occurredAt, timestamp, timestamp,
        item.status === "deleted" ? timestamp : null, hashContent(content));
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE/.test(error.message)) {
        throw new StructuredMemoryError("相同内容的记忆已存在", 409, "MEMORY_DUPLICATE");
      }
      throw error;
    }
    return this.get(item.id, { includeDeleted: true });
  }

  update(id, input) {
    const current = this.get(id, { includeDeleted: true });
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new StructuredMemoryError("请求体必须是对象");
    const next = {
      type: input.type === undefined ? current.type : memoryType(input.type),
      title: input.title === undefined ? current.title : (input.title === null || input.title === "" ? null : text(input.title, "title", MAX_TITLE, { nullable: true })),
      content: input.content === undefined ? current.content : text(input.content, "content", MAX_CONTENT),
      source: input.source === undefined ? current.source : (input.source === null || input.source === "" ? null : text(input.source, "source", MAX_SOURCE, { nullable: true })),
      sourceSessionId: input.sourceSessionId === undefined ? current.sourceSessionId : this.validateSourceSession(input.sourceSessionId),
      importance: input.importance === undefined ? current.importance : importance(input.importance),
      status: input.status === undefined ? current.status : memoryStatus(input.status),
      occurredAt: input.occurredAt === undefined ? current.occurredAt : isoDate(input.occurredAt, "occurredAt")
    };
    const updatedAt = new Date().toISOString();
    try {
      this.db.prepare(`UPDATE memory_items SET type=?,title=?,content=?,source=?,source_session_id=?,importance=?,status=?,occurred_at=?,updated_at=?,content_hash=? WHERE id=?`)
        .run(next.type, next.title, next.content, next.source, next.sourceSessionId, next.importance,
          next.status, next.occurredAt, updatedAt, hashContent(next.content), id);
    } catch (error) {
      if (/UNIQUE/.test(error.message)) throw new StructuredMemoryError("相同内容的记忆已存在", 409, "MEMORY_DUPLICATE");
      throw error;
    }
    return this.get(id, { includeDeleted: true });
  }

  softDelete(id) {
    this.get(id, { includeDeleted: true });
    const timestamp = new Date().toISOString();
    this.db.prepare("UPDATE memory_items SET status='deleted', deleted_at=?, updated_at=? WHERE id=?")
      .run(timestamp, timestamp, id);
  }

  restore(id) {
    const current = this.get(id, { includeDeleted: true });
    if (!current.deletedAt) throw new StructuredMemoryError("记忆未被删除", 409, "MEMORY_NOT_DELETED");
    const timestamp = new Date().toISOString();
    this.db.prepare("UPDATE memory_items SET status='active', deleted_at=NULL, updated_at=? WHERE id=?").run(timestamp, id);
    return this.get(id);
  }

  stats() {
    const total = Number(this.db.prepare("SELECT COUNT(*) AS count FROM memory_items WHERE deleted_at IS NULL").get().count);
    const deleted = Number(this.db.prepare("SELECT COUNT(*) AS count FROM memory_items WHERE deleted_at IS NOT NULL").get().count);
    const byType = Object.fromEntries([...MEMORY_TYPES].map(type => [type, 0]));
    for (const row of this.db.prepare("SELECT type,COUNT(*) AS count FROM memory_items WHERE deleted_at IS NULL GROUP BY type").all()) {
      byType[row.type] = Number(row.count);
    }
    return { total, deleted, byType };
  }

  listComments(memoryId) {
    this.get(memoryId, { includeDeleted: true });
    return this.db.prepare("SELECT * FROM memory_comments WHERE memory_id=? AND deleted_at IS NULL ORDER BY created_at ASC")
      .all(memoryId).map(publicComment);
  }

  createComment(memoryId, input) {
    this.get(memoryId);
    const content = text(input?.content, "content", MAX_COMMENT);
    const author = input?.author == null || input.author === "" ? null : text(input.author, "author", MAX_AUTHOR, { nullable: true });
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    this.db.prepare("INSERT INTO memory_comments (id,memory_id,author,content,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id, memoryId, author, content, timestamp, timestamp);
    return publicComment(this.db.prepare("SELECT * FROM memory_comments WHERE id=?").get(id));
  }

  updateComment(memoryId, commentId, input) {
    this.get(memoryId, { includeDeleted: true });
    const current = this.db.prepare("SELECT * FROM memory_comments WHERE id=? AND memory_id=? AND deleted_at IS NULL").get(commentId, memoryId);
    if (!current) throw new StructuredMemoryError("评论不存在", 404, "COMMENT_NOT_FOUND");
    const content = input?.content === undefined ? current.content : text(input.content, "content", MAX_COMMENT);
    const author = input?.author === undefined ? current.author : (input.author === null || input.author === "" ? null : text(input.author, "author", MAX_AUTHOR, { nullable: true }));
    this.db.prepare("UPDATE memory_comments SET author=?,content=?,updated_at=? WHERE id=?")
      .run(author, content, new Date().toISOString(), commentId);
    return publicComment(this.db.prepare("SELECT * FROM memory_comments WHERE id=?").get(commentId));
  }

  deleteComment(memoryId, commentId) {
    this.get(memoryId, { includeDeleted: true });
    const timestamp = new Date().toISOString();
    const result = this.db.prepare("UPDATE memory_comments SET deleted_at=?,updated_at=? WHERE id=? AND memory_id=? AND deleted_at IS NULL")
      .run(timestamp, timestamp, commentId, memoryId);
    if (!result.changes) throw new StructuredMemoryError("评论不存在", 404, "COMMENT_NOT_FOUND");
  }

  async synchronizeImport(mode, legacyItems, writeJson, job = {}) {
    if (!new Set(["merge", "replace"]).has(mode)) throw new StructuredMemoryError("mode 必须是 merge 或 replace");
    const normalized = legacyItems.map(mapLegacyItem);
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    let importedCount = 0;
    let skippedCount = Number(job.skippedCount || 0);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (mode === "replace") {
        const timestamp = new Date().toISOString();
        this.db.prepare("UPDATE memory_items SET status='deleted',deleted_at=?,updated_at=? WHERE deleted_at IS NULL")
          .run(timestamp, timestamp);
      }
      for (const item of normalized) {
        const hash = hashContent(item.content);
        const existing = this.db.prepare("SELECT id,deleted_at FROM memory_items WHERE content_hash=?").get(hash);
        if (existing) {
          if (mode === "replace") {
            this.db.prepare(`UPDATE memory_items SET type=?,title=?,content=?,source=?,importance=?,status='active',occurred_at=?,updated_at=?,deleted_at=NULL WHERE id=?`)
              .run(item.type, item.title, item.content, item.source, item.importance, item.occurredAt, new Date().toISOString(), existing.id);
            importedCount++;
          } else skippedCount++;
          continue;
        }
        this.create(item);
        importedCount++;
      }
      await writeJson(this.exportLegacyItems());
      const completedAt = new Date().toISOString();
      this.db.prepare(`INSERT INTO memory_import_jobs (id,mode,source_name,imported_count,skipped_count,backup_file,status,created_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(jobId, mode, job.sourceName || null, importedCount, skippedCount,
        job.backupFile || null, "completed", createdAt, completedAt);
      this.db.exec("COMMIT");
      return { importedCount, skippedCount, jobId };
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.prepare(`INSERT INTO memory_import_jobs (id,mode,source_name,imported_count,skipped_count,backup_file,status,created_at,completed_at,error_message)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(jobId, mode, job.sourceName || null, 0, skippedCount,
        job.backupFile || null, "failed", createdAt, new Date().toISOString(), String(error.message).slice(0, 500));
      throw error;
    }
  }

  exportLegacyItems() {
    return this.db.prepare("SELECT * FROM memory_items WHERE deleted_at IS NULL ORDER BY created_at ASC").all().map(row => ({
      ...(row.occurred_at ? { time: row.occurred_at } : {}),
      ...(row.title ? { title: row.title } : {}),
      content: row.content,
      type: row.type,
      importance: Number(row.importance)
    }));
  }
}

module.exports = {
  MEMORY_TYPES,
  StructuredMemoryError,
  StructuredMemoryStore,
  hashContent,
  isoDate,
  mapLegacyItem
};
