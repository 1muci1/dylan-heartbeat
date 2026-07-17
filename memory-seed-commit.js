"use strict";

const { MemorySeedError } = require("./memory-seed-preview");

class MemorySeedCommitter {
  constructor({ store, previewRegistry }) {
    if (!store || typeof store.create !== "function") throw new TypeError("StructuredMemoryStore 必填");
    if (!previewRegistry || typeof previewRegistry.get !== "function") throw new TypeError("previewRegistry 必填");
    this.store = store;
    this.previewRegistry = previewRegistry;
  }

  commit(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new MemorySeedError("Commit 输入必须是对象");
    const allowed = new Set(["seedId", "previewId", "approvedItemIds"]);
    const unknown = Object.keys(input).find(key => !allowed.has(key));
    if (unknown) throw new MemorySeedError(`Commit 包含不允许的字段：${unknown}`, "MEMORY_SEED_COMMIT_FIELD_FORBIDDEN");
    if (typeof input.seedId !== "string" || !input.seedId.trim()) throw new MemorySeedError("seedId 格式无效");
    if (typeof input.previewId !== "string" || !input.previewId.trim()) throw new MemorySeedError("previewId 格式无效");
    if (!Array.isArray(input.approvedItemIds) || input.approvedItemIds.some(id => typeof id !== "string" || !id)) {
      throw new MemorySeedError("approvedItemIds 必须是字符串数组");
    }

    const preview = this.previewRegistry.get(input.previewId);
    if (preview.seedId !== input.seedId.trim()) throw new MemorySeedError("seedId 与 Preview 不匹配", "MEMORY_SEED_PREVIEW_MISMATCH");
    const approvedIds = [...new Set(input.approvedItemIds)];
    const byId = new Map(preview.items.map(item => [item.id, item]));
    const missing = approvedIds.find(id => !byId.has(id));
    if (missing) throw new MemorySeedError(`approved item id 不属于该 Preview：${missing}`, "MEMORY_SEED_ITEM_NOT_FOUND");

    const result = {
      seedId: preview.seedId,
      created: 0,
      skipped: 0,
      duplicates: [],
      failed: [],
      results: []
    };
    for (const id of approvedIds) {
      const item = byId.get(id);
      if (item.decision === "invalid" || item.decision === "sensitive") {
        result.skipped++;
        result.failed.push({ id, reason: `Preview decision 为 ${item.decision}：${item.reason}` });
        result.results.push({ id, status: "failed", reason: item.reason });
        continue;
      }
      try {
        const memory = this.store.create({
          type: item.type,
          title: item.title,
          content: item.content,
          importance: item.importance,
          occurredAt: item.occurredAt,
          source: "manual-seed"
        });
        result.created++;
        result.results.push({ id, status: "created", memoryId: memory.id });
      } catch (error) {
        if (error.code === "MEMORY_DUPLICATE") {
          result.skipped++;
          result.duplicates.push({ id, reason: error.message });
          result.results.push({ id, status: "duplicate", reason: error.message });
          continue;
        }
        result.skipped++;
        result.failed.push({ id, reason: error.message });
        result.results.push({ id, status: "failed", reason: error.message });
      }
    }
    return result;
  }
}

module.exports = { MemorySeedCommitter };
