"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 200000;

class SessionError extends Error {
  constructor(message, statusCode = 400, code = "SESSION_ERROR") {
    super(message);
    this.name = "SessionError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function validateId(id) {
  if (!SESSION_ID_RE.test(String(id || ""))) {
    throw new SessionError("无效的 Session ID", 400, "INVALID_SESSION_ID");
  }
  return id;
}

function normalizeTitle(value, fallback = "新会话") {
  const title = String(value ?? "").trim() || fallback;
  if (title.length > MAX_TITLE_LENGTH) {
    throw new SessionError(`会话标题不能超过 ${MAX_TITLE_LENGTH} 字符`);
  }
  return title;
}

function publicSession(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count || 0)
  };
}

function publicMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    thinking: row.thinking || null,
    type: row.message_type || "text",
    attachments: row.attachments || [],
    sticker: row.sticker_id ? {
      id: row.sticker_id,
      url: `/api/v1/chat/media/stickers/${row.sticker_id}`,
      label: row.sticker_label || "Sticker",
      mimeType: row.sticker_mime_type || null
    } : null,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at || null
  };
}

class SessionStore {
  constructor(options = {}) {
    this.filename = path.resolve(options.filename || path.join(__dirname, "chat-sessions.sqlite"));
    this.db = options.database || new DatabaseSync(this.filename);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stickers (
        id TEXT PRIMARY KEY,
        storage_name TEXT NOT NULL UNIQUE,
        original_name TEXT,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size > 0),
        label TEXT,
        tags TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL DEFAULT '',
        thinking TEXT,
        message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image','sticker')),
        sticker_id TEXT REFERENCES stickers(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'interrupted', 'error')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT
      );
      CREATE TABLE IF NOT EXISTS chat_attachments (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
        message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image','sticker')),
        storage_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size > 0),
        width INTEGER,
        height INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id, id DESC);
    `);
  }

  close() {
    this.db.close();
  }

  createSession(title) {
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    this.db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, normalizeTitle(title), timestamp, timestamp);
    return this.getSession(id);
  }

  getSession(id) {
    validateId(id);
    const row = this.db.prepare(`
      SELECT s.*, COUNT(m.id) AS message_count
      FROM chat_sessions s
      LEFT JOIN chat_messages m ON m.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(id);
    if (!row) throw new SessionError("Session 不存在", 404, "SESSION_NOT_FOUND");
    return publicSession(row);
  }

  listSessions(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    return this.db.prepare(`
      SELECT s.*, COUNT(m.id) AS message_count
      FROM chat_sessions s
      LEFT JOIN chat_messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT ?
    `).all(limit).map(publicSession);
  }

  renameSession(id, title) {
    validateId(id);
    const timestamp = nowIso();
    const result = this.db.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(normalizeTitle(title, ""), timestamp, id);
    if (!result.changes) throw new SessionError("Session 不存在", 404, "SESSION_NOT_FOUND");
    return this.getSession(id);
  }

  deleteSession(id) {
    validateId(id);
    const result = this.db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
    if (!result.changes) throw new SessionError("Session 不存在", 404, "SESSION_NOT_FOUND");
  }

  listMessages(id, options = {}) {
    this.getSession(id);
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    const before = options.before == null || options.before === "" ? Number.MAX_SAFE_INTEGER : Number(options.before);
    if (!Number.isSafeInteger(before) || before < 1) {
      throw new SessionError("before 必须是正整数消息 ID");
    }
    const rows = this.db.prepare(`
      SELECT m.id, m.role, m.content, m.thinking, m.message_type, m.sticker_id,
             m.status, m.created_at, m.completed_at,
             s.label AS sticker_label, s.mime_type AS sticker_mime_type
      FROM chat_messages m
      LEFT JOIN stickers s ON s.id = m.sticker_id
      WHERE m.session_id = ? AND m.id < ?
      ORDER BY m.id DESC
      LIMIT ?
    `).all(id, before, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor = hasMore ? page[page.length - 1].id : null;
    const messages = page.reverse().map(row => {
      const attachments = this.db.prepare(`
        SELECT id, kind, mime_type, size, width, height
        FROM chat_attachments WHERE message_id = ? ORDER BY created_at, id
      `).all(row.id).map(item => ({
        id: item.id,
        kind: item.kind,
        url: `/api/v1/chat/media/${item.id}`,
        mimeType: item.mime_type,
        size: Number(item.size),
        width: item.width == null ? null : Number(item.width),
        height: item.height == null ? null : Number(item.height)
      }));
      return publicMessage({ ...row, attachments });
    });
    return { messages, nextCursor, hasMore };
  }

  addMessage(id, role, content, status = "completed", options = {}) {
    this.getSession(id);
    if (!new Set(["user", "assistant"]).has(role)) throw new SessionError("无效的消息角色");
    const normalized = typeof content === "string" ? content : JSON.stringify(content);
    if (!normalized.trim() && status === "completed") throw new SessionError("消息内容不能为空");
    if (normalized.length > MAX_MESSAGE_LENGTH) throw new SessionError("消息内容过长", 413, "MESSAGE_TOO_LARGE");
    const timestamp = nowIso();
    const completedAt = status === "completed" ? timestamp : null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        INSERT INTO chat_messages (session_id, role, content, thinking, message_type, sticker_id, status, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, role, normalized, options.thinking || null, options.type || "text", options.stickerId || null, status, timestamp, completedAt);
      for (const attachmentId of options.attachmentIds || []) {
        const linked = this.db.prepare(`
          UPDATE chat_attachments SET session_id = ?, message_id = ?
          WHERE id = ? AND message_id IS NULL AND (session_id IS NULL OR session_id = ?)
        `).run(id, Number(result.lastInsertRowid), attachmentId, id);
        if (!linked.changes) throw new SessionError("图片附件无效或已被使用", 400, "INVALID_ATTACHMENT");
      }
      this.db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(timestamp, id);
      this.db.exec("COMMIT");
      return Number(result.lastInsertRowid);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateMessage(id, status, content, errorCode = null, thinking = null) {
    if (!new Set(["completed", "interrupted", "error"]).has(status)) {
      throw new SessionError("无效的消息状态");
    }
    const normalized = String(content || "");
    if (normalized.length > MAX_MESSAGE_LENGTH) throw new SessionError("消息内容过长", 413, "MESSAGE_TOO_LARGE");
    const completedAt = status === "completed" ? nowIso() : null;
    const result = this.db.prepare(`
      UPDATE chat_messages
      SET content = ?, thinking = ?, status = ?, completed_at = ?, error_code = ?
      WHERE id = ? AND role = 'assistant' AND status = 'pending'
    `).run(normalized, thinking || null, status, completedAt, errorCode, id);
    if (!result.changes) throw new SessionError("待完成消息不存在", 409, "MESSAGE_STATE_CONFLICT");
  }
}

module.exports = { SessionError, SessionStore };
