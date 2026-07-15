"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { migrateMemoryJson } = require("../memory-json-migration");

test("memory.json migration backs up, imports, deduplicates, and rolls back failures", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-migrate-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const databaseFile = path.join(dir, "database.sqlite");
  const memoryFile = path.join(dir, "memory.json");
  const backupDir = path.join(dir, "backups");
  const original = { memories: [{ time: "2026-07-01 10:00", content: "first migrated" }, { content: "second migrated" }] };
  await fs.promises.writeFile(memoryFile, JSON.stringify(original, null, 2));
  const initial = openDatabase(databaseFile);
  initial.db.close();

  const first = await migrateMemoryJson({ databaseFile, memoryFile, backupDir });
  assert.equal(first.importedCount, 2);
  assert.equal(first.totalAfter, 2);
  assert.ok((await fs.promises.stat(path.join(backupDir, first.memoryBackupFile))).isFile());
  assert.ok((await fs.promises.stat(path.join(backupDir, first.databaseBackupFile))).isFile());
  assert.deepEqual(JSON.parse(await fs.promises.readFile(memoryFile, "utf8")), original);

  const second = await migrateMemoryJson({ databaseFile, memoryFile, backupDir });
  assert.equal(second.importedCount, 0);
  assert.equal(second.skippedCount, 2);
  assert.equal(second.totalAfter, 2);

  await fs.promises.writeFile(memoryFile, JSON.stringify({ memories: [{ content: "must rollback" }] }));
  await assert.rejects(
    migrateMemoryJson({ databaseFile, memoryFile, backupDir, failAfterImport: true }),
    /simulated migration failure/
  );
  const check = openDatabase(databaseFile);
  assert.equal(Number(check.db.prepare("SELECT COUNT(*) AS count FROM memory_items WHERE deleted_at IS NULL").get().count), 2);
  check.db.close();
});
