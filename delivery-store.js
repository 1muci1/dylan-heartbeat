"use strict";

const crypto = require("node:crypto");

const STATUSES = new Set(["pending", "sending", "sent", "failed", "cancelled"]);
const CREATE_FIELDS = new Set(["jobId", "eventId", "channel", "text", "reasonCode", "dedupeKey"]);

class DeliveryStoreError extends Error {
  constructor(message, statusCode = 400, code = "DELIVERY_INVALID") {
    super(message);
    this.name = "DeliveryStoreError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requiredText(value, field, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new DeliveryStoreError(`${field} 格式无效`);
  }
  return value.trim();
}

function optionalText(value, field, max = 200) {
  if (value == null || value === "") return null;
  return requiredText(value, field, max);
}

function publicDelivery(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    eventId: row.event_id,
    channel: row.channel,
    status: row.status,
    text: row.text,
    reasonCode: row.reason_code,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    failedAt: row.failed_at,
    attemptCount: Number(row.attempt_count || 0),
    lockedAt: row.locked_at,
    lockOwner: row.lock_owner,
    maxAttemptCount: Number(row.max_attempt_count ?? 3),
    nextRetryAt: row.next_retry_at,
    lastErrorCode: row.last_error_code
  };
}

class DeliveryStore {
  constructor({ database, clock = () => new Date(), idFactory = () => crypto.randomUUID(), workerId = () => crypto.randomUUID(), lockTimeoutMinutes = 10 } = {}) {
    if (!database) throw new TypeError("database 必填");
    this.db = database;
    this.clock = clock;
    this.idFactory = idFactory;
    this.workerId = typeof workerId === "function" ? requiredText(workerId(), "workerId") : requiredText(workerId, "workerId");
    const timeout = Number(lockTimeoutMinutes);
    if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError("lockTimeoutMinutes 必须大于 0");
    this.lockTimeoutMinutes = timeout;
  }

  create(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new DeliveryStoreError("Delivery 输入无效");
    const unknown = Object.keys(input).find(key => !CREATE_FIELDS.has(key));
    if (unknown) throw new DeliveryStoreError(`不允许传入字段：${unknown}`);
    const jobId = requiredText(input.jobId, "jobId");
    const eventId = optionalText(input.eventId, "eventId");
    const channel = requiredText(input.channel, "channel", 50);
    const text = requiredText(input.text, "text", 500);
    const reasonCode = requiredText(input.reasonCode, "reasonCode", 100);
    const dedupeKey = optionalText(input.dedupeKey, "dedupeKey");
    const id = requiredText(this.idFactory(), "id");
    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new DeliveryStoreError("clock 返回时间无效");
    try {
      this.db.prepare(`INSERT INTO deliveries
        (id,job_id,event_id,channel,status,text,reason_code,dedupe_key,created_at)
        VALUES (?,?,?,?,'pending',?,?,?,?)`)
        .run(id, jobId, eventId, channel, text, reasonCode, dedupeKey, now.toISOString());
    } catch (error) {
      if (dedupeKey && String(error.message).includes("deliveries.dedupe_key")) {
        throw new DeliveryStoreError("dedupeKey 已存在", 409, "DELIVERY_DUPLICATE");
      }
      throw error;
    }
    return this.get(id);
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM deliveries WHERE id=?").get(requiredText(id, "id"));
    if (!row) throw new DeliveryStoreError("Delivery 不存在", 404, "DELIVERY_NOT_FOUND");
    return publicDelivery(row);
  }

  list(query = {}) {
    if (!query || typeof query !== "object" || Array.isArray(query)) throw new DeliveryStoreError("查询格式无效");
    const page = Number(query.page ?? 1), limit = Number(query.limit ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DeliveryStoreError("分页参数无效");
    }
    const where = [], params = [];
    if (query.jobId) { where.push("job_id=?"); params.push(requiredText(query.jobId, "jobId")); }
    if (query.status) {
      const status = requiredText(query.status, "status", 20);
      if (!STATUSES.has(status)) throw new DeliveryStoreError("status 无效");
      where.push("status=?"); params.push(status);
    }
    if (query.channel) { where.push("channel=?"); params.push(requiredText(query.channel, "channel", 50)); }
    for (const [key, operator] of [["from", ">="], ["to", "<="]]) {
      if (!query[key]) continue;
      const date = new Date(query[key]);
      if (Number.isNaN(date.getTime())) throw new DeliveryStoreError(`${key} 时间无效`);
      where.push(`created_at${operator}?`); params.push(date.toISOString());
    }
    const orders = { newest: "created_at DESC,id DESC", oldest: "created_at ASC,id ASC" };
    const order = orders[query.sort ?? "newest"];
    if (!order) throw new DeliveryStoreError("sort 无效");
    const sql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number(this.db.prepare(`SELECT COUNT(*) n FROM deliveries ${sql}`).get(...params).n);
    const rows = this.db.prepare(`SELECT * FROM deliveries ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    return { items: rows.map(publicDelivery), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  markSent(id) {
    return this.mark(id, "sent");
  }

  markFailed(id, errorCode = null) {
    const normalized = errorCode == null ? null : requiredText(errorCode, "errorCode", 64);
    return this.mark(id, "failed", normalized);
  }

  mark(id, status, errorCode = null) {
    const delivery = this.get(id);
    if (delivery.status === "sent") throw new DeliveryStoreError("Delivery 已发送", 409, "DELIVERY_ALREADY_SENT");
    if (delivery.status === status) return delivery;
    if (delivery.status !== "sending") throw new DeliveryStoreError("Delivery 状态不可转换", 409, "DELIVERY_STATUS_INVALID");
    const now = this.clock().toISOString();
    this.db.prepare(`UPDATE deliveries SET status=?,sent_at=?,failed_at=?,last_error_code=?,locked_at=NULL,lock_owner=NULL WHERE id=? AND status='sending'`)
      .run(status, status === "sent" ? now : null, status === "failed" ? now : null, status === "failed" ? errorCode : delivery.lastErrorCode, delivery.id);
    return this.get(delivery.id);
  }

  scheduleRetry(id, options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new DeliveryStoreError("重试参数无效");
    const unknown = Object.keys(options).find(key => !new Set(["nextRetryAt", "lastErrorCode"]).has(key));
    if (unknown) throw new DeliveryStoreError(`不允许传入字段：${unknown}`);
    const delivery = this.get(id);
    if (delivery.status === "sent") throw new DeliveryStoreError("Delivery 已发送", 409, "DELIVERY_ALREADY_SENT");
    if (delivery.status !== "failed") throw new DeliveryStoreError("只有 failed Delivery 可以重试", 409, "DELIVERY_STATUS_INVALID");
    const nextRetry = new Date(requiredText(options.nextRetryAt, "nextRetryAt", 40));
    if (Number.isNaN(nextRetry.getTime())) throw new DeliveryStoreError("nextRetryAt 时间无效");
    const errorCode = requiredText(options.lastErrorCode, "lastErrorCode", 64);
    this.db.prepare(`UPDATE deliveries SET status='pending',next_retry_at=?,last_error_code=?,locked_at=NULL,lock_owner=NULL
      WHERE id=? AND status='failed'`).run(nextRetry.toISOString(), errorCode, delivery.id);
    return this.get(delivery.id);
  }

  claimPending(limit = 10) {
    const count = Number(limit);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new DeliveryStoreError("limit 必须是 1 到 100");
    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new DeliveryStoreError("clock 返回时间无效");
    const lockedAt = now.toISOString();
    const staleBefore = new Date(now.getTime() - this.lockTimeoutMinutes * 60000).toISOString();
    const claimed = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db.prepare(`SELECT id FROM deliveries
        WHERE (status='pending' AND (next_retry_at IS NULL OR next_retry_at<=?))
          OR (status='sending' AND (locked_at IS NULL OR locked_at<=?))
        ORDER BY created_at ASC,id ASC LIMIT ?`).all(lockedAt, staleBefore, count);
      const claim = this.db.prepare(`UPDATE deliveries
        SET status='sending',attempt_count=attempt_count+1,next_retry_at=NULL,locked_at=?,lock_owner=?
        WHERE id=? AND ((status='pending' AND (next_retry_at IS NULL OR next_retry_at<=?))
          OR (status='sending' AND (locked_at IS NULL OR locked_at<=?)))`);
      for (const row of rows) {
        if (claim.run(lockedAt, this.workerId, row.id, lockedAt, staleBefore).changes) claimed.push(row.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return claimed.map(id => this.get(id));
  }
}

module.exports = { DeliveryStore, DeliveryStoreError, STATUSES, publicDelivery };
