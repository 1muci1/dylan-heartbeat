"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, openDatabase } = require("../database");

test("migrations create required tables and are idempotent", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-migrations-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  t.after(() => connection.db.close());
  const versions = connection.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(row => Number(row.version));
  assert.deepEqual(versions, [1, 2, 3, 4, 5]);
  assert.deepEqual(applyMigrations(connection.db), []);
  const tables = new Set(connection.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const table of ["memory_items", "memory_comments", "memory_import_jobs", "schema_migrations", "chat_sessions", "chat_messages", "chat_attachments", "stickers", "session_summaries", "memory_candidates", "ai_jobs"]) {
    assert.ok(tables.has(table));
  }
});

test("a failed migration rolls back its schema and version marker", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-migration-rollback-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(dir, "database.sqlite"));
  t.after(() => db.close());
  assert.throws(() => applyMigrations(db, { migrations: [{ version: 99, sql: "CREATE TABLE should_rollback (id); INVALID SQL" }] }));
  const table = db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get();
  assert.equal(table, undefined);
  const version = db.prepare("SELECT version FROM schema_migrations WHERE version=99").get();
  assert.equal(version, undefined);
});

test("migration 4 preserves existing data and message content", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-migration-4-data-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(dir, "database.sqlite"));
  t.after(() => db.close());
  const migrations = require("../database").MIGRATIONS;
  applyMigrations(db, { migrations: migrations.slice(0, 3) });
  db.prepare("INSERT INTO chat_sessions VALUES (?,?,?,?)").run("s1", "old", "2026-01-01", "2026-01-01");
  db.prepare("INSERT INTO chat_messages (session_id,role,content,status,created_at) VALUES (?,?,?,?,?)").run("s1", "user", "unchanged", "completed", "2026-01-01");
  db.prepare("INSERT INTO memory_items (id,type,content,importance,status,created_at,updated_at,content_hash) VALUES (?,?,?,?,?,?,?,?)")
    .run("m1", "MEMORY", "keep", 3, "active", "2026-01-01", "2026-01-01", "hash");
  const tables = ["chat_sessions", "chat_messages", "memory_items", "chat_attachments"];
  const before = tables.map(table => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n));
  applyMigrations(db);
  assert.deepEqual(tables.map(table => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)), before);
  assert.equal(db.prepare("SELECT content FROM chat_messages WHERE id=1").get().content, "unchanged");
});

test("migration 5 adds source job audit columns without changing existing products", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-migration-5-data-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(dir, "database.sqlite"));
  t.after(() => db.close());
  const migrations = require("../database").MIGRATIONS;
  applyMigrations(db, { migrations: migrations.slice(0, 4) });
  db.prepare("INSERT INTO chat_sessions VALUES (?,?,?,?)").run("s1", "old", "2026-01-01", "2026-01-01");
  db.prepare(`INSERT INTO session_summaries
    (id,session_id,summary,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)`)
    .run("sum1", "s1", "keep summary", "2026-01-01", "2026-01-01");
  db.prepare(`INSERT INTO memory_candidates
    (id,session_id,type,content,status,created_at) VALUES (?,?,?,?,'pending',?)`)
    .run("candidate1", "s1", "NOTE", "keep candidate", "2026-01-01");
  assert.deepEqual(applyMigrations(db), [5]);
  assert.equal(db.prepare("SELECT summary,source_job_id FROM session_summaries WHERE id='sum1'").get().summary, "keep summary");
  assert.equal(db.prepare("SELECT content,source_job_id FROM memory_candidates WHERE id='candidate1'").get().content, "keep candidate");
  const summaryColumns = new Set(db.prepare("PRAGMA table_info(session_summaries)").all().map(row => row.name));
  const candidateColumns = new Set(db.prepare("PRAGMA table_info(memory_candidates)").all().map(row => row.name));
  assert.ok(summaryColumns.has("source_job_id"));
  assert.ok(candidateColumns.has("source_job_id"));
  assert.deepEqual(applyMigrations(db), []);
});
