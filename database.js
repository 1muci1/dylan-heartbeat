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
  },
  {
    version: 6,
    sql: `
      ALTER TABLE ai_jobs ADD COLUMN prompt_tokens INTEGER
        CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0);
      ALTER TABLE ai_jobs ADD COLUMN completion_tokens INTEGER
        CHECK (completion_tokens IS NULL OR completion_tokens >= 0);
      ALTER TABLE ai_jobs ADD COLUMN total_tokens INTEGER
        CHECK (total_tokens IS NULL OR total_tokens >= 0);
      ALTER TABLE ai_jobs ADD COLUMN latency_ms INTEGER
        CHECK (latency_ms IS NULL OR latency_ms >= 0);
    `
  },
  {
    version: 7,
    sql: `
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        subject_type TEXT,
        subject_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(payload_json))
          CHECK (json_type(payload_json) = 'object'),
        importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
        priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
        dedupe_key TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        CHECK ((subject_type IS NULL AND subject_id IS NULL) OR (subject_type IS NOT NULL AND subject_id IS NOT NULL)),
        FOREIGN KEY (causation_id) REFERENCES events(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX idx_events_dedupe_key ON events(dedupe_key) WHERE dedupe_key IS NOT NULL;
      CREATE INDEX idx_events_occurred ON events(occurred_at DESC, id DESC);
      CREATE INDEX idx_events_type_occurred ON events(event_type, occurred_at DESC, id DESC);
      CREATE INDEX idx_events_category_occurred ON events(category, occurred_at DESC, id DESC);
      CREATE INDEX idx_events_subject ON events(subject_type, subject_id, occurred_at DESC);
      CREATE INDEX idx_events_correlation ON events(correlation_id, occurred_at ASC);
      CREATE INDEX idx_events_expires ON events(expires_at) WHERE expires_at IS NOT NULL;
    `
  },
  {
    version: 8,
    sql: `
      CREATE TABLE companion_state (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        state_key TEXT NOT NULL,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        value_type TEXT NOT NULL,
        confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
        source_kind TEXT NOT NULL,
        source_event_id TEXT,
        source_memory_id TEXT,
        valid_from TEXT NOT NULL,
        expires_at TEXT,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE(scope_type, scope_id, state_key),
        FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE SET NULL,
        FOREIGN KEY (source_memory_id) REFERENCES memory_items(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_companion_state_scope ON companion_state(scope_type, scope_id);
      CREATE INDEX idx_companion_state_key ON companion_state(state_key);
      CREATE INDEX idx_companion_state_source_event ON companion_state(source_event_id);
    `
  },
  {
    version: 9,
    foreignKeysOff: true,
    sql: `
      CREATE TABLE ai_jobs_v9 (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL CHECK (job_type IN ('session_summary','memory_extraction','proactive_response')),
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
        prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
        completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
        total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
        latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
      );
      INSERT INTO ai_jobs_v9 (
        id,job_type,session_id,status,input_message_count,attempt_count,provider,model,
        started_at,completed_at,error_code,error_message,created_at,
        prompt_tokens,completion_tokens,total_tokens,latency_ms
      ) SELECT
        id,job_type,session_id,status,input_message_count,attempt_count,provider,model,
        started_at,completed_at,error_code,error_message,created_at,
        prompt_tokens,completion_tokens,total_tokens,latency_ms
      FROM ai_jobs;
      DROP TABLE ai_jobs;
      ALTER TABLE ai_jobs_v9 RENAME TO ai_jobs;
      CREATE INDEX idx_ai_jobs_status_created
        ON ai_jobs(status, created_at DESC);
      CREATE INDEX idx_ai_jobs_type_session
        ON ai_jobs(job_type, session_id, created_at DESC);
      CREATE UNIQUE INDEX idx_ai_jobs_one_running
        ON ai_jobs(job_type, session_id) WHERE status = 'running' AND session_id IS NOT NULL;
    `
  },
  {
    version: 10,
    sql: `
      CREATE TABLE deliveries (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        event_id TEXT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','sent','failed','cancelled')),
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
        reason_code TEXT NOT NULL,
        dedupe_key TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        failed_at TEXT,
        FOREIGN KEY (job_id) REFERENCES ai_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_deliveries_job ON deliveries(job_id);
      CREATE INDEX idx_deliveries_status_created ON deliveries(status, created_at DESC);
      CREATE UNIQUE INDEX idx_deliveries_dedupe ON deliveries(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `
  },
  {
    version: 11,
    foreignKeysOff: true,
    sql: `
      CREATE TABLE deliveries_v11 (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        event_id TEXT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','sending','sent','failed','cancelled')),
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
        reason_code TEXT NOT NULL,
        dedupe_key TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        failed_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        locked_at TEXT,
        lock_owner TEXT,
        FOREIGN KEY (job_id) REFERENCES ai_jobs(id) ON DELETE CASCADE
      );
      INSERT INTO deliveries_v11 (
        id,job_id,event_id,channel,status,text,reason_code,dedupe_key,created_at,sent_at,failed_at,
        attempt_count,locked_at,lock_owner
      ) SELECT
        id,job_id,event_id,channel,status,text,reason_code,dedupe_key,created_at,sent_at,failed_at,
        0,NULL,NULL
      FROM deliveries;
      DROP TABLE deliveries;
      ALTER TABLE deliveries_v11 RENAME TO deliveries;
      CREATE INDEX idx_deliveries_job ON deliveries(job_id);
      CREATE INDEX idx_deliveries_status_created ON deliveries(status, created_at DESC);
      CREATE UNIQUE INDEX idx_deliveries_dedupe ON deliveries(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `
  },
  {
    version: 12,
    foreignKeysOff: true,
    sql: `
      CREATE TABLE deliveries_v12 (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        event_id TEXT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','sending','sent','failed','cancelled')),
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
        reason_code TEXT NOT NULL,
        dedupe_key TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        failed_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        locked_at TEXT,
        lock_owner TEXT,
        max_attempt_count INTEGER NOT NULL DEFAULT 3 CHECK (max_attempt_count >= 1),
        next_retry_at TEXT,
        last_error_code TEXT,
        FOREIGN KEY (job_id) REFERENCES ai_jobs(id) ON DELETE CASCADE
      );
      INSERT INTO deliveries_v12 (
        id,job_id,event_id,channel,status,text,reason_code,dedupe_key,created_at,sent_at,failed_at,
        attempt_count,locked_at,lock_owner,max_attempt_count,next_retry_at,last_error_code
      ) SELECT
        id,job_id,event_id,channel,status,text,reason_code,dedupe_key,created_at,sent_at,failed_at,
        attempt_count,locked_at,lock_owner,3,NULL,NULL
      FROM deliveries;
      DROP TABLE deliveries;
      ALTER TABLE deliveries_v12 RENAME TO deliveries;
      CREATE INDEX idx_deliveries_job ON deliveries(job_id);
      CREATE INDEX idx_deliveries_status_created ON deliveries(status, created_at DESC);
      CREATE INDEX idx_deliveries_retry ON deliveries(status, next_retry_at, created_at);
      CREATE UNIQUE INDEX idx_deliveries_dedupe ON deliveries(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `
  },
  {
    version: 13,
    sql: `
      CREATE TABLE delivery_feedback (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL,
        feedback_type TEXT NOT NULL
          CHECK (feedback_type IN ('liked','dismissed','not_relevant','disable_future')),
        created_at TEXT NOT NULL,
        UNIQUE(delivery_id),
        FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_delivery_feedback_delivery ON delivery_feedback(delivery_id);
      CREATE INDEX idx_delivery_feedback_type ON delivery_feedback(feedback_type);
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
    if (migration.foreignKeysOff) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      if (migration.foreignKeysOff && db.prepare("PRAGMA foreign_key_check").all().length) {
        throw new Error(`Migration ${migration.version} 产生外键不一致`);
      }
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
      newlyApplied.push(migration.version);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      if (migration.foreignKeysOff) db.exec("PRAGMA foreign_keys = ON");
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
