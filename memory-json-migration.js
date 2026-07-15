"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { openDatabase } = require("./database");
const { StructuredMemoryStore } = require("./structured-memory-store");

function extractLegacyItems(document) {
  if (Array.isArray(document)) return document;
  if (document && typeof document === "object") {
    for (const key of ["memories", "items", "data", "messages"]) {
      if (Array.isArray(document[key])) return document[key];
    }
  }
  throw new Error("memory.json 顶层结构不受支持");
}

async function migrateMemoryJson(options) {
  const databaseFile = path.resolve(options.databaseFile);
  const memoryFile = path.resolve(options.memoryFile);
  const backupDir = path.resolve(options.backupDir);
  await fs.promises.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "");
  const suffix = crypto.randomBytes(4).toString("hex");
  const memoryBackupFile = `memory-pre-migration-${stamp}-${suffix}.json`;
  const databaseBackupFile = `database-pre-migration-${stamp}-${suffix}.sqlite`;
  await fs.promises.copyFile(memoryFile, path.join(backupDir, memoryBackupFile), fs.constants.COPYFILE_EXCL);
  const sourceDb = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    await backup(sourceDb, path.join(backupDir, databaseBackupFile));
  } finally {
    sourceDb.close();
  }

  const document = JSON.parse(await fs.promises.readFile(memoryFile, "utf8"));
  const items = extractLegacyItems(document);
  const connection = openDatabase(databaseFile);
  const store = new StructuredMemoryStore({ database: connection.db, filename: connection.filename });
  try {
    const before = store.stats().total;
    const result = await store.synchronizeImport("merge", items, async () => {
      if (options.failAfterImport) throw new Error("simulated migration failure");
    }, {
      sourceName: path.basename(memoryFile),
      backupFile: memoryBackupFile
    });
    const after = store.stats().total;
    return {
      status: "completed",
      sourceCount: items.length,
      importedCount: result.importedCount,
      skippedCount: result.skippedCount,
      totalBefore: before,
      totalAfter: after,
      memoryBackupFile,
      databaseBackupFile,
      jobId: result.jobId
    };
  } finally {
    connection.db.close();
  }
}

module.exports = { extractLegacyItems, migrateMemoryJson };
