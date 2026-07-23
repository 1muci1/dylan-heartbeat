"use strict";

const crypto = require("node:crypto");
const {
  MemoryImportError,
  hashMemoryImportItem,
  normalizeMemoryImportItem,
  parseMemoryImportEnvelope
} = require("./memory-import-contract");
const { hashContent } = require("./structured-memory-store");

const DEFAULT_PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_EXISTING_SCAN = 10000;
const SENSITIVE_PATTERN = /(?:\bapi[\s_-]*key\b|\b(?:access|bearer|device)?[\s_-]*token\b|\bpassword\b|\bpasswd\b|\bcookie\b|\bprivate[\s_-]*key\b|\botp\b|\bverification[\s_-]*code\b|\bcredit[\s_-]*card\b|\bbank[\s_-]*account\b|\bmedical[\s_-]*diagnosis\b|API\s*密钥|访问令牌|密码|私钥|验证码|身份证|银行卡|银行账号|精确住址|门禁|医疗诊断|设备\s*token)/iu;

function normalizeComparable(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function categoryOfMemory(memory) {
  const marker = /^memory-import:v1:(fact|preference|event|relationship):[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.exec(memory.source || "");
  if (marker) return marker[1];
  if (memory.type === "EVENT" || memory.type === "MOMENT") return "event";
  if (memory.type === "WISHLIST") return "preference";
  if (memory.type === "PROMISE") return "relationship";
  return "fact";
}

function listAllMemories(store) {
  const items = [];
  for (const status of ["active", "archived", "deleted"]) {
    let page = 1;
    while (items.length < MAX_EXISTING_SCAN) {
      const result = store.list({ page, limit: 100, status, sort: "importance" });
      items.push(...result.items);
      if (page >= result.meta.totalPages) break;
      page++;
    }
  }
  return items.slice(0, MAX_EXISTING_SCAN);
}

function classifyMemoryImportItem(item, existingMemories) {
  const contentHash = hashContent(item.content);
  const duplicate = existingMemories.find(memory => hashContent(memory.content) === contentHash);
  if (duplicate) {
    return { decision: "duplicate", reasonCode: "MEMORY_IMPORT_DUPLICATE", existingMemoryIds: [duplicate.id] };
  }
  if (SENSITIVE_PATTERN.test(`${item.title}\n${item.content}`)) {
    return { decision: "sensitive", reasonCode: "MEMORY_IMPORT_SENSITIVE", existingMemoryIds: [] };
  }
  const title = normalizeComparable(item.title);
  const conflicts = existingMemories.filter(memory =>
    categoryOfMemory(memory) === item.category &&
    normalizeComparable(memory.title) === title &&
    hashContent(memory.content) !== contentHash
  ).slice(0, 5);
  if (conflicts.length) {
    return {
      decision: "conflict",
      reasonCode: "MEMORY_IMPORT_CONFLICT",
      existingMemoryIds: conflicts.map(memory => memory.id)
    };
  }
  return { decision: "ready", reasonCode: "MEMORY_IMPORT_READY", existingMemoryIds: [] };
}

function publicPreview(preview) {
  return {
    previewId: preview.previewId,
    importId: preview.importId,
    sourceId: preview.sourceId,
    expiresAt: preview.expiresAt,
    items: preview.items.map(item => ({
      id: item.id,
      externalId: item.externalId,
      category: item.category,
      title: item.title,
      content: item.content,
      importance: item.importance,
      occurredAt: item.occurredAt,
      itemHash: item.itemHash,
      decision: item.decision,
      reasonCode: item.reasonCode,
      existingMemoryIds: [...item.existingMemoryIds]
    }))
  };
}

class MemoryImportPreviewService {
  constructor({ store, ttlMs = DEFAULT_PREVIEW_TTL_MS, clock = () => Date.now() } = {}) {
    if (!store || typeof store.list !== "function") throw new TypeError("StructuredMemoryStore 必填");
    if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new TypeError("ttlMs 必须是正整数");
    if (typeof clock !== "function") throw new TypeError("clock 必须是函数");
    this.store = store;
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.previews = new Map();
  }

  create(document) {
    const envelope = parseMemoryImportEnvelope(document);
    const existing = listAllMemories(this.store);
    const items = document.items.map((input, index) => {
      const fallback = {
        id: `${envelope.importId}:${index + 1}`,
        externalId: typeof input?.externalId === "string" ? input.externalId.trim() : null,
        category: typeof input?.category === "string" ? input.category : null,
        title: null,
        content: null,
        importance: Number.isInteger(Number(input?.importance)) ? Number(input.importance) : null,
        occurredAt: input?.occurredAt ?? null,
        itemHash: null,
        decision: "invalid",
        reasonCode: "MEMORY_IMPORT_ITEM_INVALID",
        existingMemoryIds: []
      };
      try {
        const normalized = normalizeMemoryImportItem(input);
        const classification = classifyMemoryImportItem(normalized, existing);
        return { ...fallback, ...normalized, itemHash: hashMemoryImportItem(normalized), ...classification };
      } catch {
        return fallback;
      }
    });
    const now = this.clock();
    const preview = {
      previewId: crypto.randomUUID(),
      importId: envelope.importId,
      sourceId: envelope.source.sourceId,
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      expiresAtMs: now + this.ttlMs,
      items,
      committed: new Map()
    };
    this.previews.set(preview.previewId, preview);
    return publicPreview(preview);
  }

  get(previewId) {
    const preview = this.getInternal(previewId);
    return publicPreview(preview);
  }

  getInternal(previewId) {
    const id = String(previewId || "");
    const preview = this.previews.get(id);
    if (!preview) throw new MemoryImportError("Preview 不存在", "MEMORY_IMPORT_PREVIEW_EXPIRED");
    if (this.clock() >= preview.expiresAtMs) {
      this.previews.delete(id);
      throw new MemoryImportError("Preview 已过期", "MEMORY_IMPORT_PREVIEW_EXPIRED");
    }
    return preview;
  }

  reclassify(item) {
    return classifyMemoryImportItem(item, listAllMemories(this.store));
  }
}

module.exports = {
  DEFAULT_PREVIEW_TTL_MS,
  MemoryImportPreviewService,
  categoryOfMemory,
  classifyMemoryImportItem
};
