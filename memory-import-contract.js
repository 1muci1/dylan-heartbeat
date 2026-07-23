"use strict";

const crypto = require("node:crypto");
const { isoDate } = require("./structured-memory-store");

const MEMORY_IMPORT_FORMAT = "ai-companion-memory-import/v1";
const MEMORY_IMPORT_CATEGORIES = Object.freeze(["fact", "preference", "event", "relationship"]);
const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_IMPORT_ITEMS = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TOP_LEVEL_FIELDS = new Set(["format", "importId", "mode", "source", "items"]);
const SOURCE_FIELDS = new Set(["kind", "sourceId"]);
const ITEM_FIELDS = new Set(["externalId", "category", "title", "content", "importance", "occurredAt"]);
const SOURCE_KINDS = new Set(["user_export", "manual"]);
const CATEGORY_TO_TYPE = Object.freeze({
  fact: "MEMORY",
  preference: "MEMORY",
  event: "EVENT",
  relationship: "MEMORY"
});

class MemoryImportError extends Error {
  constructor(message, code = "MEMORY_IMPORT_FORMAT_INVALID") {
    super(message);
    this.name = "MemoryImportError";
    this.code = code;
  }
}

function object(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryImportError(`${context} 必须是对象`);
  }
  return value;
}

function rejectUnknownFields(value, allowed, context) {
  const field = Object.keys(value).find(key => !allowed.has(key));
  if (field) {
    throw new MemoryImportError(`${context} 包含不允许的字段：${field}`, "MEMORY_IMPORT_FIELD_FORBIDDEN");
  }
}

function safeId(value, field) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value.trim())) {
    throw new MemoryImportError(`${field} 格式无效`, "MEMORY_IMPORT_ITEM_INVALID");
  }
  return value.trim();
}

function text(value, field, max) {
  if (typeof value !== "string") {
    throw new MemoryImportError(`${field} 必须是字符串`, "MEMORY_IMPORT_ITEM_INVALID");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new MemoryImportError(`${field} 长度无效`, "MEMORY_IMPORT_ITEM_INVALID");
  }
  return normalized;
}

function parseMemoryImportEnvelope(document) {
  object(document, "Import");
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(document), "utf8");
  } catch {
    throw new MemoryImportError("Import 无法序列化");
  }
  if (bytes > MAX_IMPORT_BYTES) {
    throw new MemoryImportError("Import 超过大小限制", "MEMORY_IMPORT_TOO_LARGE");
  }
  rejectUnknownFields(document, TOP_LEVEL_FIELDS, "Import");
  if (document.format !== MEMORY_IMPORT_FORMAT) throw new MemoryImportError("Import format 无效");
  const importId = safeId(document.importId, "importId");
  if (document.mode !== "merge") throw new MemoryImportError("mode 首期只允许 merge");
  const source = object(document.source, "source");
  rejectUnknownFields(source, SOURCE_FIELDS, "source");
  if (!SOURCE_KINDS.has(source.kind)) throw new MemoryImportError("source.kind 无效");
  const sourceId = safeId(source.sourceId, "source.sourceId");
  if (!Array.isArray(document.items)) throw new MemoryImportError("items 必须是数组");
  if (document.items.length > MAX_IMPORT_ITEMS) {
    throw new MemoryImportError("items 超过数量限制", "MEMORY_IMPORT_TOO_LARGE");
  }
  return { format: MEMORY_IMPORT_FORMAT, importId, mode: "merge", source: { kind: source.kind, sourceId } };
}

function normalizeMemoryImportItem(input) {
  const item = object(input, "item");
  rejectUnknownFields(item, ITEM_FIELDS, "item");
  const externalId = safeId(item.externalId, "externalId");
  if (!MEMORY_IMPORT_CATEGORIES.includes(item.category)) {
    throw new MemoryImportError("category 无效", "MEMORY_IMPORT_ITEM_INVALID");
  }
  const category = item.category;
  const title = text(item.title, "title", MAX_TITLE_LENGTH);
  const content = text(item.content, "content", MAX_CONTENT_LENGTH);
  const importance = Number(item.importance);
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new MemoryImportError("importance 必须是 1 到 5", "MEMORY_IMPORT_ITEM_INVALID");
  }
  let occurredAt = null;
  try {
    occurredAt = isoDate(item.occurredAt, "occurredAt");
  } catch {
    throw new MemoryImportError("occurredAt 格式无效", "MEMORY_IMPORT_ITEM_INVALID");
  }
  if (category === "event" && !occurredAt) {
    throw new MemoryImportError("event 必须包含 occurredAt", "MEMORY_IMPORT_ITEM_INVALID");
  }
  return Object.freeze({ externalId, category, title, content, importance, occurredAt });
}

function parseMemoryImportDocument(document) {
  const envelope = parseMemoryImportEnvelope(document);
  return Object.freeze({
    ...envelope,
    source: Object.freeze({ ...envelope.source }),
    items: Object.freeze(document.items.map(normalizeMemoryImportItem))
  });
}

function createMemoryImportSourceMarker(category, sourceId) {
  if (!MEMORY_IMPORT_CATEGORIES.includes(category)) throw new MemoryImportError("category 无效");
  const normalizedSourceId = safeId(sourceId, "sourceId");
  return `memory-import:v1:${category}:${normalizedSourceId}`;
}

function mapMemoryImportCategoryToType(category) {
  const type = CATEGORY_TO_TYPE[category];
  if (!type) throw new MemoryImportError("category 无效");
  return type;
}

function hashMemoryImportItem(item) {
  const normalized = normalizeMemoryImportItem({
    externalId: item?.externalId,
    category: item?.category,
    title: item?.title,
    content: item?.content,
    importance: item?.importance,
    occurredAt: item?.occurredAt
  });
  const canonical = JSON.stringify([
    normalized.externalId,
    normalized.category,
    normalized.title,
    normalized.content,
    normalized.importance,
    normalized.occurredAt
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

module.exports = {
  MAX_CONTENT_LENGTH,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ITEMS,
  MAX_TITLE_LENGTH,
  MEMORY_IMPORT_CATEGORIES,
  MEMORY_IMPORT_FORMAT,
  MemoryImportError,
  createMemoryImportSourceMarker,
  hashMemoryImportItem,
  mapMemoryImportCategoryToType,
  normalizeMemoryImportItem,
  parseMemoryImportDocument,
  parseMemoryImportEnvelope
};
