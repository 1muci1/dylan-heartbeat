"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { backup: backupDatabase } = require("node:sqlite");

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_ITEMS = 5000;
const DEFAULT_MAX_STRING_LENGTH = 20000;
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;
const BODY_KEYS = ["content", "summary", "text", "title"];
const CONTAINER_KEYS = ["memories", "items", "data", "messages"];
const BACKUP_RE = /^memory-(\d{8}T\d{6}\.\d{3}Z)-([a-f0-9]{8})\.json$/;

class MemoryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryValidationError";
    this.statusCode = 400;
  }
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function extractItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") {
    throw new MemoryValidationError("data 必须是数组或包含 memories/items/data/messages 的对象");
  }
  for (const key of CONTAINER_KEYS) {
    if (Array.isArray(value[key])) return value[key];
  }
  throw new MemoryValidationError("未找到有效的 memories/items/data/messages 数组");
}

function normalizeItems(value, limits) {
  const source = extractItems(value);
  if (source.length === 0) throw new MemoryValidationError("记忆数据不能为空");
  if (source.length > limits.maxItems) {
    throw new MemoryValidationError(`记忆条目不能超过 ${limits.maxItems} 条`);
  }

  const items = [];
  let skippedCount = 0;
  for (const raw of source) {
    let item;
    let content;
    if (typeof raw === "string") {
      content = raw.trim();
      item = { content };
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const bodyKey = BODY_KEYS.find(key => typeof raw[key] === "string");
      if (!bodyKey) {
        skippedCount++;
        continue;
      }
      for (const [key, field] of Object.entries(raw)) {
        if (typeof field === "string" && field.length > limits.maxStringLength) {
          throw new MemoryValidationError(`条目字段 ${key} 超过 ${limits.maxStringLength} 字符`);
        }
      }
      content = raw[bodyKey].trim();
      item = { ...raw, content };
    } else {
      skippedCount++;
      continue;
    }

    if (!content) {
      skippedCount++;
      continue;
    }
    if (content.length > limits.maxStringLength) {
      throw new MemoryValidationError(`记忆正文超过 ${limits.maxStringLength} 字符`);
    }
    items.push(item);
  }
  if (items.length === 0) throw new MemoryValidationError("清理后没有可导入的记忆");
  return { items, skippedCount };
}

function dedupeKey(item) {
  return item.content.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function validateStoredDocument(document, limits) {
  const source = extractItems(document);
  if (source.length === 0) return [];
  const normalized = normalizeItems(document, limits);
  return normalized.items;
}

function describeDocument(document) {
  if (Array.isArray(document)) return { kind: "array" };
  if (document && typeof document === "object") {
    const key = CONTAINER_KEYS.find(candidate => Array.isArray(document[candidate]));
    if (key) return { kind: "object", key, template: { ...document } };
  }
  throw new MemoryValidationError("memory.json 顶层结构不受支持");
}

function documentWithItems(shape, items) {
  if (shape.kind === "array") return items;
  return { ...shape.template, [shape.key]: items };
}

function createMemoryStore(options = {}) {
  const memoryFile = path.resolve(options.memoryFile || path.join(__dirname, "memory.json"));
  const backupDir = path.resolve(options.backupDir || path.join(path.dirname(memoryFile), "memory-backups"));
  const limits = {
    maxItems: options.maxItems || DEFAULT_MAX_ITEMS,
    maxStringLength: options.maxStringLength || DEFAULT_MAX_STRING_LENGTH
  };
  const fileOps = options.fileOps || fs.promises;
  const structuredStore = options.structuredStore || null;
  const database = options.database || null;
  const databaseFile = options.databaseFile || null;

  async function readState() {
    let document;
    try {
      document = JSON.parse(await fileOps.readFile(memoryFile, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) throw new MemoryValidationError("memory.json 不是合法 JSON");
      throw error;
    }
    return {
      document,
      shape: describeDocument(document),
      items: validateStoredDocument(document, limits)
    };
  }

  async function readItems() {
    return (await readState()).items;
  }

  async function atomicWrite(items, shape) {
    await fileOps.mkdir(path.dirname(memoryFile), { recursive: true });
    const tempFile = path.join(
      path.dirname(memoryFile),
      `.${path.basename(memoryFile)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
    );
    const payload = JSON.stringify(documentWithItems(shape, items), null, 2) + "\n";
    try {
      await fileOps.writeFile(tempFile, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fileOps.rename(tempFile, memoryFile);
    } catch (error) {
      try { await fileOps.unlink(tempFile); } catch {}
      throw error;
    }
  }

  async function createBackup(document) {
    await fileOps.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "");
    const name = `memory-${stamp}-${crypto.randomBytes(4).toString("hex")}.json`;
    const target = path.join(backupDir, name);
    await fileOps.writeFile(target, JSON.stringify(document, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    return name;
  }

  async function createDatabaseBackup() {
    if (!database || !databaseFile) return null;
    await fileOps.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "");
    const name = `memory-db-${stamp}-${crypto.randomBytes(4).toString("hex")}.sqlite`;
    await backupDatabase(database, path.join(backupDir, name));
    return name;
  }

  async function importItems(mode, data) {
    if (mode !== "merge" && mode !== "replace") {
      throw new MemoryValidationError("mode 必须是 merge 或 replace");
    }
    const current = await readState();
    const normalized = normalizeItems(data, limits);
    const seen = new Set(mode === "merge" ? current.items.map(dedupeKey) : []);
    const accepted = [];
    let skippedCount = normalized.skippedCount;
    for (const item of normalized.items) {
      const key = dedupeKey(item);
      if (seen.has(key)) {
        skippedCount++;
        continue;
      }
      seen.add(key);
      accepted.push(item);
    }
    const finalItems = mode === "merge" ? [...current.items, ...accepted] : accepted;
    if (finalItems.length > limits.maxItems) {
      throw new MemoryValidationError(`导入后记忆不能超过 ${limits.maxItems} 条`);
    }
    if (finalItems.length === 0) throw new MemoryValidationError("导入结果不能为空");

    const backupFile = await createBackup(current.document);
    const databaseBackupFile = await createDatabaseBackup();
    if (structuredStore) {
      let syncResult;
      try {
        syncResult = await structuredStore.synchronizeImport(
          mode,
          mode === "merge" ? accepted : finalItems,
          items => atomicWrite(items, current.shape),
          { sourceName: "admin-import", skippedCount, backupFile }
        );
      } catch (error) {
        await atomicWrite(current.items, current.shape);
        throw error;
      }
      return {
        importedCount: syncResult.importedCount,
        totalCount: structuredStore.stats().total,
        skippedCount: syncResult.skippedCount,
        backupFile,
        databaseBackupFile
      };
    }
    await atomicWrite(finalItems, current.shape);
    return {
      importedCount: accepted.length,
      totalCount: finalItems.length,
      skippedCount,
      backupFile,
      ...(databaseBackupFile ? { databaseBackupFile } : {})
    };
  }

  async function listBackups() {
    let names;
    try {
      names = await fileOps.readdir(backupDir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const backups = [];
    for (const id of names.filter(name => BACKUP_RE.test(name)).sort().reverse()) {
      const stat = await fileOps.stat(path.join(backupDir, id));
      if (stat.isFile()) backups.push({ id, size: stat.size, createdAt: stat.mtime.toISOString() });
    }
    return backups;
  }

  async function restore(id) {
    if (typeof id !== "string" || !BACKUP_RE.test(id) || path.basename(id) !== id) {
      throw new MemoryValidationError("无效的备份 id");
    }
    const backupPath = path.join(backupDir, id);
    let backupDocument;
    try {
      backupDocument = JSON.parse(await fileOps.readFile(backupPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        const notFound = new MemoryValidationError("备份不存在");
        notFound.statusCode = 404;
        throw notFound;
      }
      if (error instanceof SyntaxError) throw new MemoryValidationError("备份不是合法 JSON");
      throw error;
    }
    const restoredItems = validateStoredDocument(backupDocument, limits);
    const current = await readState();
    const backupFile = await createBackup(current.document);
    const databaseBackupFile = await createDatabaseBackup();
    if (structuredStore) {
      try {
        await structuredStore.synchronizeImport(
          "replace",
          restoredItems,
          items => atomicWrite(items, current.shape),
          { sourceName: `backup:${id}`, backupFile }
        );
      } catch (error) {
        await atomicWrite(current.items, current.shape);
        throw error;
      }
      return { totalCount: structuredStore.stats().total, backupFile, databaseBackupFile };
    }
    await atomicWrite(restoredItems, current.shape);
    return { totalCount: restoredItems.length, backupFile, ...(databaseBackupFile ? { databaseBackupFile } : {}) };
  }

  return { readItems, importItems, listBackups, restore, createDatabaseBackup };
}

function registerMemoryAdmin(app, options = {}) {
  const expectedKey = options.apiKey || process.env.GATEWAY_API_KEY;
  const store = options.store || createMemoryStore(options);
  const structuredStore = options.structuredStore || null;
  const bodyLimit = options.bodyLimit || DEFAULT_BODY_LIMIT;

  function bearerAuth(req, reply, done) {
    const auth = req.headers.authorization || "";
    if (!expectedKey) {
      reply.code(503).send({ error: "GATEWAY_API_KEY 未配置" });
      return;
    }
    if (!safeEqual(auth, `Bearer ${expectedKey}`)) {
      reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "Invalid gateway API key" });
      return;
    }
    done();
  }

  app.post("/admin/memory/import", { preHandler: bearerAuth, bodyLimit }, async (req, reply) => {
    try {
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new MemoryValidationError("请求体必须是 JSON 对象");
      }
      return await store.importItems(body.mode, body.data);
    } catch (error) {
      req.log.warn({ err: error }, "memory import failed");
      return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : "记忆导入失败" });
    }
  });

  app.get("/admin/memory/export", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      const items = structuredStore ? structuredStore.exportLegacyItems() : await store.readItems();
      return { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), count: items.length, items };
    } catch (error) {
      req.log.warn({ err: error }, "memory export failed");
      return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : "记忆导出失败" });
    }
  });

  app.get("/admin/memory/backups", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return { backups: await store.listBackups() };
    } catch (error) {
      req.log.warn({ err: error }, "memory backup listing failed");
      return reply.code(500).send({ error: "备份列表读取失败" });
    }
  });

  app.post("/admin/memory/backups/:id/restore", { preHandler: bearerAuth }, async (req, reply) => {
    try {
      return await store.restore(req.params.id);
    } catch (error) {
      req.log.warn({ err: error }, "memory restore failed");
      return reply.code(error.statusCode || 500).send({ error: error.statusCode ? error.message : "记忆恢复失败" });
    }
  });
}

module.exports = {
  DEFAULT_BODY_LIMIT,
  MemoryValidationError,
  createMemoryStore,
  registerMemoryAdmin
};
