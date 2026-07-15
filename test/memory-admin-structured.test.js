"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase } = require("../database");
const { createMemoryStore, registerMemoryAdmin } = require("../memory-admin");
const { StructuredMemoryStore } = require("../structured-memory-store");

test("P1 merge/replace/export/backup restore stay JSON-compatible and synchronize SQLite", async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "heartbeat-memory-dual-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const memoryFile = path.join(dir, "memory.json");
  const backupDir = path.join(dir, "backups");
  const databaseFile = path.join(dir, "database.sqlite");
  await fs.promises.writeFile(memoryFile, JSON.stringify({ memories: [{ content: "old memory" }] }, null, 2));
  const connection = openDatabase(databaseFile);
  const structuredStore = new StructuredMemoryStore({ database: connection.db, filename: databaseFile });
  structuredStore.create({ content: "old memory", source: "fixture" });
  const store = createMemoryStore({ memoryFile, backupDir, structuredStore, database: connection.db, databaseFile });
  const app = Fastify({ logger: false });
  registerMemoryAdmin(app, { store, structuredStore, apiKey: "token" });
  await app.ready();
  t.after(async () => { await app.close(); connection.db.close(); });
  const headers = { authorization: "Bearer token" };

  const merged = await app.inject({
    method: "POST", url: "/admin/memory/import", headers,
    payload: { mode: "merge", data: [{ content: "new memory" }, { content: "old memory" }] }
  });
  assert.equal(merged.statusCode, 200, merged.body);
  assert.equal(merged.json().importedCount, 1);
  assert.equal(merged.json().totalCount, 2);
  assert.ok(merged.json().databaseBackupFile);
  const databaseBackup = new DatabaseSync(path.join(backupDir, merged.json().databaseBackupFile), { readOnly: true });
  assert.equal(Number(databaseBackup.prepare("SELECT COUNT(*) AS count FROM memory_items WHERE deleted_at IS NULL").get().count), 1);
  databaseBackup.close();

  const replaced = await app.inject({
    method: "POST", url: "/admin/memory/import", headers,
    payload: { mode: "replace", data: [{ content: "replacement" }] }
  });
  assert.equal(replaced.statusCode, 200, replaced.body);
  assert.equal(structuredStore.stats().total, 1);
  assert.equal(JSON.parse(await fs.promises.readFile(memoryFile, "utf8")).memories[0].content, "replacement");

  const exported = await app.inject({ method: "GET", url: "/admin/memory/export", headers });
  assert.equal(exported.json().items[0].content, "replacement");

  const restored = await app.inject({
    method: "POST", url: `/admin/memory/backups/${replaced.json().backupFile}/restore`, headers
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(structuredStore.stats().total, 2);
  assert.ok(structuredStore.exportLegacyItems().some(item => item.content === "old memory"));
  assert.ok((await fs.promises.readdir(backupDir)).some(name => name.startsWith("memory-db-")));
});
