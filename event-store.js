"use strict";

const crypto = require("node:crypto");
const { EVENT_DEFINITIONS } = require("./event-definitions");

const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_TYPE_LENGTH = 100;
const MAX_SOURCE_LENGTH = 100;
const MAX_REFERENCE_LENGTH = 200;
const CREATE_FIELDS = new Set([
  "eventType", "subjectType", "subjectId", "payload", "importance", "priority",
  "dedupeKey", "correlationId", "causationId", "occurredAt", "expiresAt"
]);

class EventStoreError extends Error {
  constructor(message, statusCode = 400, code = "EVENT_INVALID") {
    super(message);
    this.name = "EventStoreError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function optionalText(value, field, max = MAX_REFERENCE_LENGTH) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new EventStoreError(`${field} 格式无效`);
  }
  return value.trim();
}

function requiredText(value, field, max) {
  const normalized = optionalText(value, field, max);
  if (!normalized) throw new EventStoreError(`${field} 不能为空`);
  return normalized;
}

function boundedInteger(value, field, fallback) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new EventStoreError(`${field} 必须是 1 到 5 的整数`);
  }
  return number;
}

function isoTime(value, field, fallback) {
  const raw = value == null || value === "" ? fallback : value;
  if (!(typeof raw === "string" || raw instanceof Date)) {
    throw new EventStoreError(`${field} 格式无效`, 400, "EVENT_TIME_INVALID");
  }
  const parsed = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new EventStoreError(`${field} 格式无效`, 400, "EVENT_TIME_INVALID");
  }
  return parsed.toISOString();
}

function jsonPayload(value) {
  if (value === undefined) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EventStoreError("payload 必须是 JSON object", 400, "EVENT_PAYLOAD_INVALID");
  }
  let json;
  try {
    json = JSON.stringify(value, (_key, item) => {
      if (["bigint", "function", "symbol", "undefined"].includes(typeof item)) {
        throw new TypeError("payload 包含非 JSON 值");
      }
      if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError("payload 包含非有限数值");
      return item;
    });
  } catch {
    throw new EventStoreError("payload 不是有效 JSON object", 400, "EVENT_PAYLOAD_INVALID");
  }
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new EventStoreError("payload 超过大小限制", 400, "EVENT_PAYLOAD_INVALID");
  }
  return json;
}

function publicEvent(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    category: row.category,
    source: row.source,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    payload: JSON.parse(row.payload_json),
    importance: Number(row.importance),
    priority: Number(row.priority),
    dedupeKey: row.dedupe_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

class EventStore {
  constructor({ database, stateProjector = null, logger = null, clock = () => new Date(), idFactory = () => crypto.randomUUID(), definitions = EVENT_DEFINITIONS } = {}) {
    if (!database) throw new TypeError("database 必填");
    if (typeof clock !== "function" || typeof idFactory !== "function") throw new TypeError("clock 和 idFactory 必须是函数");
    this.db = database;
    this.clock = clock;
    this.idFactory = idFactory;
    this.definitions = definitions;
    this.stateProjector = stateProjector;
    this.logger = logger;
  }

  create(input, context = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new EventStoreError("Event 输入格式无效");
    const unknown = Object.keys(input).find(key => !CREATE_FIELDS.has(key));
    if (unknown) throw new EventStoreError(`不允许传入字段：${unknown}`);

    const eventType = requiredText(input.eventType, "eventType", MAX_TYPE_LENGTH);
    const definition = this.definitions[eventType];
    if (!definition) throw new EventStoreError("未知 eventType", 400, "EVENT_TYPE_UNKNOWN");
    if (!context || typeof context !== "object" || Array.isArray(context)) throw new EventStoreError("Event context 格式无效");
    const source = requiredText(context.source, "context.source", MAX_SOURCE_LENGTH);
    if (!definition.allowedSources.includes(source)) {
      throw new EventStoreError("source 无权创建该 Event", 403, "EVENT_SOURCE_FORBIDDEN");
    }
    const subjectType = optionalText(input.subjectType, "subjectType");
    const subjectId = optionalText(input.subjectId, "subjectId");
    if (Boolean(subjectType) !== Boolean(subjectId)) throw new EventStoreError("subjectType 和 subjectId 必须同时提供");

    const now = this.clock();
    const createdAt = isoTime(now, "createdAt");
    const occurredAt = isoTime(input.occurredAt, "occurredAt", now);
    const expiresAt = input.expiresAt == null || input.expiresAt === "" ? null : isoTime(input.expiresAt, "expiresAt");
    if (expiresAt && expiresAt < occurredAt) {
      throw new EventStoreError("expiresAt 不能早于 occurredAt", 400, "EVENT_TIME_INVALID");
    }

    const id = requiredText(this.idFactory(), "id", MAX_REFERENCE_LENGTH);
    const values = {
      eventType,
      category: definition.category,
      source,
      subjectType,
      subjectId,
      payloadJson: jsonPayload(input.payload),
      importance: boundedInteger(input.importance, "importance", 3),
      priority: boundedInteger(input.priority, "priority", 3),
      dedupeKey: optionalText(input.dedupeKey, "dedupeKey"),
      correlationId: optionalText(input.correlationId, "correlationId"),
      causationId: optionalText(input.causationId, "causationId"),
      occurredAt,
      createdAt,
      expiresAt
    };

    try {
      this.db.prepare(`INSERT INTO events
        (id,event_type,category,source,subject_type,subject_id,payload_json,importance,priority,dedupe_key,
         correlation_id,causation_id,occurred_at,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, values.eventType, values.category, values.source, values.subjectType, values.subjectId,
        values.payloadJson, values.importance, values.priority, values.dedupeKey, values.correlationId,
        values.causationId, values.occurredAt, values.createdAt, values.expiresAt
      );
    } catch (error) {
      if (values.dedupeKey && String(error.message).includes("events.dedupe_key")) {
        throw new EventStoreError("dedupeKey 已存在", 409, "EVENT_DUPLICATE");
      }
      throw error;
    }
    const event = this.get(id);
    if (this.stateProjector) {
      try {
        this.stateProjector.project(event);
      } catch (error) {
        this.logger?.error?.({ errorCode: error.code, eventId: event.id, eventType: event.eventType }, "Event State Projection 失败");
      }
    }
    return event;
  }

  get(id) {
    const normalized = requiredText(id, "id", MAX_REFERENCE_LENGTH);
    const row = this.db.prepare("SELECT * FROM events WHERE id=?").get(normalized);
    if (!row) throw new EventStoreError("Event 不存在", 404, "EVENT_NOT_FOUND");
    return publicEvent(row);
  }

  list(query = {}) {
    if (!query || typeof query !== "object" || Array.isArray(query)) throw new EventStoreError("查询格式无效");
    const page = Number(query.page ?? 1), limit = Number(query.limit ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new EventStoreError("分页参数无效");
    }
    const where = [], params = [];
    const filters = [
      ["eventType", "event_type"], ["category", "category"], ["source", "source"],
      ["subjectType", "subject_type"], ["subjectId", "subject_id"], ["correlationId", "correlation_id"]
    ];
    for (const [key, column] of filters) {
      if (query[key] != null && query[key] !== "") {
        where.push(`${column}=?`);
        params.push(requiredText(query[key], key, MAX_REFERENCE_LENGTH));
      }
    }
    if (query.occurredFrom != null && query.occurredFrom !== "") {
      where.push("occurred_at>=?");
      params.push(isoTime(query.occurredFrom, "occurredFrom"));
    }
    if (query.occurredTo != null && query.occurredTo !== "") {
      where.push("occurred_at<?");
      params.push(isoTime(query.occurredTo, "occurredTo"));
    }
    const orders = { newest: "occurred_at DESC,id DESC", oldest: "occurred_at ASC,id ASC" };
    const order = orders[query.sort || "newest"];
    if (!order) throw new EventStoreError("sort 无效");
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number(this.db.prepare(`SELECT COUNT(*) n FROM events ${whereSql}`).get(...params).n);
    const rows = this.db.prepare(`SELECT * FROM events ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    return { items: rows.map(publicEvent), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  existsByDedupeKey(key) {
    const normalized = requiredText(key, "dedupeKey", MAX_REFERENCE_LENGTH);
    return Boolean(this.db.prepare("SELECT 1 FROM events WHERE dedupe_key=?").get(normalized));
  }
}

module.exports = { EventStore, EventStoreError, MAX_PAYLOAD_BYTES, publicEvent };
