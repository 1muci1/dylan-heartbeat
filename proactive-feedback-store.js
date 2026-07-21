"use strict";

const crypto = require("node:crypto");

const FEEDBACK_TYPES = new Set(["liked", "dismissed", "not_relevant", "disable_future"]);
const RECORD_FIELDS = new Set(["deliveryId", "feedbackType"]);

class ProactiveFeedbackStoreError extends Error {
  constructor(message, statusCode = 400, code = "PROACTIVE_FEEDBACK_INVALID") {
    super(message); this.name = "ProactiveFeedbackStoreError"; this.statusCode = statusCode; this.code = code;
  }
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) {
    throw new ProactiveFeedbackStoreError(`${field} 格式无效`);
  }
  return value.trim();
}

function publicFeedback(row) {
  return row ? { id: row.id, deliveryId: row.delivery_id, feedbackType: row.feedback_type, createdAt: row.created_at } : null;
}

class ProactiveFeedbackStore {
  constructor({ database, deliveryStore, eventStore, clock = () => new Date(), idFactory = () => crypto.randomUUID() } = {}) {
    if (!database) throw new TypeError("database 必填");
    if (!deliveryStore || typeof deliveryStore.get !== "function") throw new TypeError("deliveryStore 必填");
    if (!eventStore || typeof eventStore.create !== "function") throw new TypeError("eventStore 必填");
    this.db = database; this.deliveryStore = deliveryStore; this.eventStore = eventStore;
    this.clock = clock; this.idFactory = idFactory;
  }

  record(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ProactiveFeedbackStoreError("反馈格式无效");
    const unknown = Object.keys(input).find(key => !RECORD_FIELDS.has(key));
    if (unknown) throw new ProactiveFeedbackStoreError(`不允许字段：${unknown}`);
    const deliveryId = text(input.deliveryId, "deliveryId");
    const feedbackType = text(input.feedbackType, "feedbackType");
    if (!FEEDBACK_TYPES.has(feedbackType)) throw new ProactiveFeedbackStoreError("feedbackType 无效");
    try { this.deliveryStore.get(deliveryId); }
    catch (error) {
      if (error?.code === "DELIVERY_NOT_FOUND") throw new ProactiveFeedbackStoreError("Delivery 不存在", 404, "DELIVERY_NOT_FOUND");
      throw error;
    }
    const existing = this.getForDelivery(deliveryId);
    if (existing) {
      if (existing.feedbackType !== feedbackType) {
        throw new ProactiveFeedbackStoreError("Delivery 已有反馈且不允许覆盖", 409, "PROACTIVE_FEEDBACK_CONFLICT");
      }
      return existing;
    }
    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new ProactiveFeedbackStoreError("clock 返回时间无效");
    const id = text(this.idFactory(), "id");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO delivery_feedback (id,delivery_id,feedback_type,created_at) VALUES (?,?,?,?)")
        .run(id, deliveryId, feedbackType, now.toISOString());
      this.eventStore.create({
        eventType: "proactive.feedback_received", subjectType: "delivery", subjectId: deliveryId,
        payload: { deliveryId, feedbackType }, dedupeKey: `proactive-feedback:${deliveryId}`, occurredAt: now
      }, { source: "proactive-feedback-store" });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getForDelivery(deliveryId);
  }

  getForDelivery(id) {
    return publicFeedback(this.db.prepare("SELECT * FROM delivery_feedback WHERE delivery_id=?").get(text(id, "id")));
  }

  list(query = {}) {
    if (!query || typeof query !== "object" || Array.isArray(query)) throw new ProactiveFeedbackStoreError("查询格式无效");
    const unknown = Object.keys(query).find(key => !new Set(["page", "limit", "feedbackType"]).has(key));
    if (unknown) throw new ProactiveFeedbackStoreError(`不支持的查询参数：${unknown}`);
    const page = Number(query.page ?? 1), limit = Number(query.limit ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProactiveFeedbackStoreError("分页参数无效");
    const where = [], params = [];
    if (query.feedbackType != null) {
      const type = text(query.feedbackType, "feedbackType");
      if (!FEEDBACK_TYPES.has(type)) throw new ProactiveFeedbackStoreError("feedbackType 无效");
      where.push("feedback_type=?"); params.push(type);
    }
    const sql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number(this.db.prepare(`SELECT COUNT(*) n FROM delivery_feedback ${sql}`).get(...params).n);
    const rows = this.db.prepare(`SELECT * FROM delivery_feedback ${sql} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    return { items: rows.map(publicFeedback), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}

module.exports = { FEEDBACK_TYPES, ProactiveFeedbackStore, ProactiveFeedbackStoreError, publicFeedback };
