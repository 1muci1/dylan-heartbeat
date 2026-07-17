"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { MEMORY_TYPES, hashContent, isoDate } = require("./structured-memory-store");

const SEED_FIELDS = new Set(["schemaVersion", "seedId", "mode", "source", "reviewed", "memories"]);
const MEMORY_FIELDS = new Set(["type", "title", "content", "importance", "occurredAt", "source"]);
const SENSITIVE_PATTERN = /(?:\bapi[\s_-]*key\b|\b(?:access[\s_-]*)?token\b|\bpassword\b|\bpasswd\b|\bcookie\b|\bprivate[\s_-]*key\b|\bdevice[\s_-]*token\b|API\s*密钥|访问令牌|密码|私钥|设备\s*token)/iu;

class MemorySeedError extends Error {
  constructor(message, code = "MEMORY_SEED_INVALID") {
    super(message);
    this.name = "MemorySeedError";
    this.code = code;
  }
}

function rejectUnknownFields(value, allowed, context) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new MemorySeedError(`${context} 包含不允许的字段：${key}`, "MEMORY_SEED_FIELD_FORBIDDEN");
  }
}

function parseSeedDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new MemorySeedError("Seed 顶层必须是对象");
  rejectUnknownFields(document, SEED_FIELDS, "Seed");
  if (document.schemaVersion !== 1) throw new MemorySeedError("schemaVersion 必须为 1");
  if (typeof document.seedId !== "string" || !document.seedId.trim() || document.seedId.length > 100) throw new MemorySeedError("seedId 格式无效");
  if (document.mode !== "merge") throw new MemorySeedError("mode 首期只允许 merge");
  if (typeof document.source !== "string" || !document.source.trim() || document.source.length > 200) throw new MemorySeedError("source 格式无效");
  if (typeof document.reviewed !== "boolean") throw new MemorySeedError("reviewed 必须是布尔值");
  if (!Array.isArray(document.memories)) throw new MemorySeedError("memories 必须是数组");
  document.memories.forEach((memory, index) => {
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) throw new MemorySeedError(`memories[${index}] 必须是对象`);
    rejectUnknownFields(memory, MEMORY_FIELDS, `memories[${index}]`);
  });
  return document;
}

function validateMemory(memory) {
  const type = String(memory.type || "").trim().toUpperCase();
  if (!MEMORY_TYPES.has(type)) throw new MemorySeedError("type 无效");
  if (typeof memory.title !== "string" || !memory.title.trim() || memory.title.trim().length > 200) throw new MemorySeedError("title 必须是 1 到 200 字符的字符串");
  if (typeof memory.content !== "string" || !memory.content.trim() || memory.content.trim().length > 20000) throw new MemorySeedError("content 必须是 1 到 20000 字符的字符串");
  const importance = Number(memory.importance);
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new MemorySeedError("importance 必须是 1 到 5 的整数");
  if (memory.source !== undefined && (typeof memory.source !== "string" || !memory.source.trim() || memory.source.trim().length > 200)) throw new MemorySeedError("memory source 格式无效");
  return {
    type,
    title: memory.title.trim(),
    content: memory.content.trim(),
    importance,
    occurredAt: isoDate(memory.occurredAt, "occurredAt")
  };
}

function previewSeedDocument(document, database) {
  const seed = parseSeedDocument(document);
  if (!database?.prepare) throw new TypeError("database 必填");
  return seed.memories.map((memory, index) => {
    const base = {
      id: `${seed.seedId.trim()}:${index + 1}`,
      type: typeof memory.type === "string" ? memory.type.trim().toUpperCase() : null,
      title: typeof memory.title === "string" ? memory.title.trim() : null,
      content: typeof memory.content === "string" ? memory.content.trim() : null,
      importance: Number.isInteger(Number(memory.importance)) ? Number(memory.importance) : null,
      occurredAt: memory.occurredAt ?? null
    };
    let normalized;
    try {
      normalized = validateMemory(memory);
      Object.assign(base, normalized);
    } catch (error) {
      return { ...base, decision: "invalid", reason: error.message };
    }
    if (SENSITIVE_PATTERN.test(`${normalized.title}\n${normalized.content}`)) {
      return { ...base, decision: "sensitive", reason: "内容包含明显禁止的敏感凭据信息" };
    }
    const existing = database.prepare("SELECT id FROM memory_items WHERE content_hash=?").get(hashContent(normalized.content));
    if (existing) return { ...base, decision: "duplicate", reason: `已存在相同记忆：${existing.id}` };
    return { ...base, decision: "ready", reason: "格式有效，未发现重复或明显敏感内容" };
  });
}

async function previewSeedFile(seedFile, database) {
  let document;
  try {
    document = JSON.parse(await fs.promises.readFile(seedFile, "utf8"));
  } catch (error) {
    throw new MemorySeedError(`Seed 文件读取失败：${error.message}`);
  }
  return previewSeedDocument(document, database);
}

class MemorySeedPreviewRegistry {
  constructor() {
    this.previews = new Map();
  }

  create(document, database) {
    const seed = parseSeedDocument(document);
    const items = previewSeedDocument(seed, database);
    const previewId = crypto.randomUUID();
    this.previews.set(previewId, {
      seedId: seed.seedId.trim(),
      previewId,
      items: items.map(item => ({ ...item, source: "manual-seed" }))
    });
    return { seedId: seed.seedId.trim(), previewId, items };
  }

  get(previewId) {
    const preview = this.previews.get(String(previewId));
    if (!preview) throw new MemorySeedError("previewId 无效或已过期", "MEMORY_SEED_PREVIEW_NOT_FOUND");
    return {
      seedId: preview.seedId,
      previewId: preview.previewId,
      items: preview.items.map(item => ({ ...item }))
    };
  }
}

module.exports = {
  MemorySeedError,
  MemorySeedPreviewRegistry,
  parseSeedDocument,
  previewSeedDocument,
  previewSeedFile
};
