"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'interrupted', 'error')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id, id DESC);
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('MEMORY','EVENT','MOMENT','PROMISE','WISHLIST','NOTE')),
        title TEXT,
        content TEXT NOT NULL,
        source TEXT,
        source_session_id TEXT,
        importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
        occurred_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        content_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY (source_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS memory_comments (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        author TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS memory_import_jobs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        source_name TEXT,
        imported_count INTEGER,
        skipped_count INTEGER,
        backup_file TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memory_items_type ON memory_items(type);
      CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items(status);
      CREATE INDEX IF NOT EXISTS idx_memory_items_occurred ON memory_items(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_memory_items_updated ON memory_items(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_items_source_session ON memory_items(source_session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_comments_memory ON memory_comments(memory_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_import_jobs_created ON memory_import_jobs(created_at DESC);
    `
  },
  {
    version: 3,
    sql: `
      ALTER TABLE chat_messages ADD COLUMN thinking TEXT;
      ALTER TABLE chat_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text','image','sticker'));
      ALTER TABLE chat_messages ADD COLUMN sticker_id TEXT REFERENCES stickers(id) ON DELETE SET NULL;
      CREATE TABLE chat_attachments (
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
      CREATE TABLE stickers (
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
      CREATE INDEX idx_chat_attachments_session ON chat_attachments(session_id, created_at);
      CREATE INDEX idx_chat_attachments_message ON chat_attachments(message_id);
      CREATE INDEX idx_stickers_status_updated ON stickers(status, updated_at DESC);
    `
  },
  {
    version: 4,
    sql: `
      CREATE TABLE session_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        covered_until_message_id INTEGER,
        source_message_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','superseded','deleted')),
        model_provider TEXT,
        model_name TEXT,
        prompt_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE memory_candidates (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        source_message_start_id INTEGER,
        source_message_end_id INTEGER,
        type TEXT NOT NULL
          CHECK (type IN ('MEMORY','EVENT','MOMENT','PROMISE','WISHLIST','NOTE')),
        title TEXT,
        content TEXT NOT NULL,
        occurred_at TEXT,
        importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
        confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','approved','rejected','duplicate','deleted')),
        approved_memory_id TEXT,
        content_hash TEXT,
        model_provider TEXT,
        model_name TEXT,
        prompt_version TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by TEXT,
        deleted_at TEXT,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (approved_memory_id) REFERENCES memory_items(id) ON DELETE SET NULL
      );
      CREATE TABLE ai_jobs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL CHECK (job_type IN ('session_summary','memory_extraction')),
        session_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
        input_message_count INTEGER NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        provider TEXT,
        model TEXT,
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_session_summaries_session_status
        ON session_summaries(session_id, status, updated_at DESC);
      CREATE INDEX idx_session_summaries_covered
        ON session_summaries(session_id, covered_until_message_id);
      CREATE INDEX idx_memory_candidates_status_created
        ON memory_candidates(status, created_at DESC);
      CREATE INDEX idx_memory_candidates_type_status
        ON memory_candidates(type, status);
      CREATE INDEX idx_memory_candidates_session
        ON memory_candidates(session_id, created_at DESC);
      CREATE INDEX idx_memory_candidates_hash
        ON memory_candidates(content_hash);
      CREATE INDEX idx_ai_jobs_status_created
        ON ai_jobs(status, created_at DESC);
      CREATE INDEX idx_ai_jobs_type_session
        ON ai_jobs(job_type, session_id, created_at DESC);
      CREATE UNIQUE INDEX idx_ai_jobs_one_running
        ON ai_jobs(job_type, session_id) WHERE status = 'running' AND session_id IS NOT NULL;
    `
  },
  {
    version: 5,
    sql: `
      ALTER TABLE session_summaries ADD COLUMN source_job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL;
      ALTER TABLE memory_candidates ADD COLUMN source_job_id TEXT REFERENCES ai_jobs(id) ON DELETE SET NULL;
      CREATE INDEX idx_session_summaries_source_job ON session_summaries(source_job_id);
      CREATE INDEX idx_memory_candidates_source_job ON memory_candidates(source_job_id);
    `
  }
];

function configureDatabase(db) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
}

function applyMigrations(db, options = {}) {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map(row => Number(row.version)));
  const newlyApplied = [];
  for (const migration of (options.migrations || MIGRATIONS)) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
      newlyApplied.push(migration.version);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return newlyApplied;
}

function openDatabase(filename, options = {}) {
  const resolved = path.resolve(filename || path.join(__dirname, "chat-sessions.sqlite"));
  const db = new DatabaseSync(resolved);
  applyMigrations(db, options);
  return { db, filename: resolved };
}

module.exports = { MIGRATIONS, applyMigrations, configureDatabase, openDatabase };
