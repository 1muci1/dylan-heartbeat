#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { migrateMemoryJson } = require("../memory-json-migration");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const root = path.resolve(__dirname, "..");
migrateMemoryJson({
  databaseFile: argument("db", path.join(root, "chat-sessions.sqlite")),
  memoryFile: argument("memory", path.join(root, "memory.json")),
  backupDir: argument("backup-dir", path.join(root, "memory-backups"))
}).then(report => {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}).catch(error => {
  process.stderr.write(`迁移失败：${error.message}\n`);
  process.exitCode = 1;
});
