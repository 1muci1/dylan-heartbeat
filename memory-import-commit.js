"use strict";

const {
  MemoryImportError,
  createMemoryImportSourceMarker,
  hashMemoryImportItem,
  mapMemoryImportCategoryToType
} = require("./memory-import-contract");

const COMMIT_FIELDS = new Set(["previewId", "importId", "approvedItems"]);
const APPROVED_ITEM_FIELDS = new Set(["id", "itemHash"]);

function rejectUnknown(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryImportError(`${context} 必须是对象`, "MEMORY_IMPORT_APPROVAL_REQUIRED");
  }
  const key = Object.keys(value).find(field => !allowed.has(field));
  if (key) throw new MemoryImportError(`${context} 包含不允许的字段`, "MEMORY_IMPORT_SELECTION_MISMATCH");
}

class MemoryImportCommitService {
  constructor({ store, previewService } = {}) {
    if (!store || typeof store.create !== "function") throw new TypeError("StructuredMemoryStore 必填");
    if (!previewService || typeof previewService.getInternal !== "function") throw new TypeError("MemoryImportPreviewService 必填");
    this.store = store;
    this.previewService = previewService;
  }

  commit(input) {
    rejectUnknown(input, COMMIT_FIELDS, "Commit");
    if (typeof input.previewId !== "string" || typeof input.importId !== "string" || !Array.isArray(input.approvedItems)) {
      throw new MemoryImportError("Commit 确认信息无效", "MEMORY_IMPORT_APPROVAL_REQUIRED");
    }
    const preview = this.previewService.getInternal(input.previewId);
    if (preview.importId !== input.importId) {
      throw new MemoryImportError("Commit 与 Preview 不匹配", "MEMORY_IMPORT_SELECTION_MISMATCH");
    }
    const selected = new Map();
    for (const approved of input.approvedItems) {
      rejectUnknown(approved, APPROVED_ITEM_FIELDS, "approvedItem");
      if (typeof approved.id !== "string" || typeof approved.itemHash !== "string" || selected.has(approved.id)) {
        throw new MemoryImportError("approvedItems 无效", "MEMORY_IMPORT_SELECTION_MISMATCH");
      }
      selected.set(approved.id, approved.itemHash);
    }
    const byId = new Map(preview.items.map(item => [item.id, item]));
    for (const [id, itemHash] of selected) {
      const item = byId.get(id);
      if (!item || item.decision !== "ready") {
        throw new MemoryImportError("只允许提交 ready item", "MEMORY_IMPORT_SELECTION_MISMATCH");
      }
      const currentHash = hashMemoryImportItem(item);
      if (item.itemHash !== currentHash || itemHash !== currentHash) {
        throw new MemoryImportError("Item hash 不匹配", "MEMORY_IMPORT_SELECTION_MISMATCH");
      }
    }

    const results = [];
    for (const [id] of selected) {
      const item = byId.get(id);
      const committed = preview.committed.get(id);
      if (committed) {
        results.push({ id, status: "already_committed", memoryId: committed.memoryId });
        continue;
      }
      const classification = this.previewService.reclassify(item);
      if (classification.decision !== "ready") {
        results.push({ id, status: "skipped", reasonCode: classification.reasonCode });
        continue;
      }
      try {
        const memory = this.store.create({
          type: mapMemoryImportCategoryToType(item.category),
          title: item.title,
          content: item.content,
          importance: item.importance,
          occurredAt: item.occurredAt,
          source: createMemoryImportSourceMarker(item.category, preview.sourceId)
        }, { eventContext: { source: "memory-import-runtime" } });
        preview.committed.set(id, { memoryId: memory.id });
        results.push({ id, status: "created", memoryId: memory.id });
      } catch (error) {
        if (error?.code === "MEMORY_DUPLICATE") {
          results.push({ id, status: "skipped", reasonCode: "MEMORY_IMPORT_DUPLICATE" });
        } else {
          results.push({ id, status: "failed", reasonCode: "MEMORY_IMPORT_COMMIT_FAILED" });
        }
      }
    }
    return {
      previewId: preview.previewId,
      importId: preview.importId,
      created: results.filter(item => item.status === "created").length,
      results
    };
  }
}

module.exports = { MemoryImportCommitService };
