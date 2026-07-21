"use strict";

const crypto = require("node:crypto");

const SET_FIELDS = new Set([
  "scopeType", "scopeId", "stateKey", "value", "sourceKind", "sourceEventId", "sourceMemoryId",
  "confidence", "validFrom", "expiresAt"
]);
const MAX_TEXT = 200;
const MAX_VALUE_BYTES = 16 * 1024;

class StateStoreError extends Error {
  constructor(message, statusCode = 400, code = "STATE_INVALID") {
    super(message);
    this.name = "StateStoreError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_TEXT) {
    throw new StateStoreError(`${field} 格式无效`);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value == null || value === "") return null;
  return requiredText(value, field);
}

function isoTime(value, field, fallback) {
  const raw = value == null || value === "" ? fallback : value;
  if (!(typeof raw === "string" || raw instanceof Date)) throw new StateStoreError(`${field} 格式无效`, 400, "STATE_TIME_INVALID");
  const parsed = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new StateStoreError(`${field} 格式无效`, 400, "STATE_TIME_INVALID");
  return parsed.toISOString();
}

function serializeValue(value) {
  let json;
  try {
    json = JSON.stringify(value, (_key, item) => {
      if (["undefined", "function", "symbol", "bigint"].includes(typeof item)) throw new TypeError("非 JSON 值");
      if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError("非有限数值");
      return item;
    });
  } catch {
    throw new StateStoreError("value 不是有效 JSON", 400, "STATE_VALUE_INVALID");
  }
  if (json === undefined || Buffer.byteLength(json, "utf8") > MAX_VALUE_BYTES) {
    throw new StateStoreError("value 不是有效 JSON 或超过大小限制", 400, "STATE_VALUE_INVALID");
  }
  const parsed = JSON.parse(json);
  const valueType = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
  return { json, valueType };
}

function publicState(row) {
  return row ? {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    stateKey: row.state_key,
    value: JSON.parse(row.value_json),
    valueType: row.value_type,
    confidence: row.confidence == null ? null : Number(row.confidence),
    sourceKind: row.source_kind,
    sourceEventId: row.source_event_id,
    sourceMemoryId: row.source_memory_id,
    validFrom: row.valid_from,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    version: Number(row.version)
  } : null;
}

function sanitizePublicValue(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(secret|token|password|prompt|stack|error)/i.test(key)) continue;
    clean[key] = sanitizePublicValue(item);
  }
  return clean;
}

function publicStateView(state) {
  return {
    stateKey: state.stateKey,
    value: sanitizePublicValue(state.value),
    valueType: state.valueType,
    confidence: state.confidence,
    sourceKind: state.sourceKind,
    sourceEventId: state.sourceEventId,
    updatedAt: state.updatedAt,
    expiresAt: state.expiresAt
  };
}

class StateStore {
  constructor({ database, clock = () => new Date(), idFactory = () => crypto.randomUUID() } = {}) {
    if (!database) throw new TypeError("database 必填");
    if (typeof clock !== "function" || typeof idFactory !== "function") throw new TypeError("clock 和 idFactory 必须是函数");
    this.db = database;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  get(scopeType, scopeId, key) {
    const row = this.db.prepare("SELECT * FROM companion_state WHERE scope_type=? AND scope_id=? AND state_key=?")
      .get(requiredText(scopeType, "scopeType"), requiredText(scopeId, "scopeId"), requiredText(key, "key"));
    return publicState(row);
  }

  set(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new StateStoreError("State 输入格式无效");
    const unknown = Object.keys(input).find(key => !SET_FIELDS.has(key));
    if (unknown) throw new StateStoreError(`不允许传入字段：${unknown}`);
    const scopeType = requiredText(input.scopeType, "scopeType");
    const scopeId = requiredText(input.scopeId, "scopeId");
    const stateKey = requiredText(input.stateKey, "stateKey");
    const sourceKind = requiredText(input.sourceKind, "sourceKind");
    const { json, valueType } = serializeValue(input.value);
    let confidence = null;
    if (input.confidence != null) {
      confidence = Number(input.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new StateStoreError("confidence 必须是 0 到 1");
    }
    const now = this.clock();
    const updatedAt = isoTime(now, "updatedAt");
    const validFrom = isoTime(input.validFrom, "validFrom", now);
    const expiresAt = input.expiresAt == null || input.expiresAt === "" ? null : isoTime(input.expiresAt, "expiresAt");
    if (expiresAt && expiresAt < validFrom) throw new StateStoreError("expiresAt 不能早于 validFrom", 400, "STATE_TIME_INVALID");
    const sourceEventId = optionalText(input.sourceEventId, "sourceEventId");
    const sourceMemoryId = optionalText(input.sourceMemoryId, "sourceMemoryId");
    const id = requiredText(this.idFactory(), "id");
    this.db.prepare(`INSERT INTO companion_state
      (id,scope_type,scope_id,state_key,value_json,value_type,confidence,source_kind,source_event_id,source_memory_id,
       valid_from,expires_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(scope_type,scope_id,state_key) DO UPDATE SET
        value_json=excluded.value_json,value_type=excluded.value_type,confidence=excluded.confidence,
        source_kind=excluded.source_kind,source_event_id=excluded.source_event_id,source_memory_id=excluded.source_memory_id,
        valid_from=excluded.valid_from,expires_at=excluded.expires_at,updated_at=excluded.updated_at,
        version=companion_state.version+1`).run(
      id, scopeType, scopeId, stateKey, json, valueType, confidence, sourceKind, sourceEventId, sourceMemoryId,
      validFrom, expiresAt, updatedAt
    );
    return this.get(scopeType, scopeId, stateKey);
  }

  list(scopeType, scopeId) {
    const rows = this.db.prepare("SELECT * FROM companion_state WHERE scope_type=? AND scope_id=? ORDER BY state_key ASC")
      .all(requiredText(scopeType, "scopeType"), requiredText(scopeId, "scopeId"));
    return rows.map(publicState);
  }

  getPublicState(scopeType = "companion", scopeId = "default") {
    return this.list(scopeType, scopeId).map(publicStateView);
  }
}

module.exports = { MAX_VALUE_BYTES, StateStore, StateStoreError, publicState, publicStateView, sanitizePublicValue };
