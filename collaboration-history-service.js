"use strict";

const crypto = require("node:crypto");

const HISTORY_INPUT_FIELDS = Object.freeze([
  "roomId",
  "topic",
  "participants",
  "summary"
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const CONTEXT_MARKER_PATTERN = /(?:<memory_reference_data|<identity_reference_data|<agent_identity_boundary|\bmemory\s+context\b|只读的长期记忆参考)/iu;
const MAX_TOPIC_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 4000;
const MAX_PARTICIPANTS = 20;

class CollaborationHistoryError extends Error {
  constructor(message, code = "COLLABORATION_HISTORY_INVALID") {
    super(message);
    this.name = "CollaborationHistoryError";
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new CollaborationHistoryError(`${field} 格式无效`);
  }
  const normalized = value.trim();
  if (CONTEXT_MARKER_PATTERN.test(normalized)) {
    throw new CollaborationHistoryError(
      `${field} 包含不允许的上下文标记`,
      "COLLABORATION_HISTORY_CONTEXT_FORBIDDEN"
    );
  }
  return normalized;
}

function validId(value, field) {
  if (typeof value !== "string" || !ID_PATTERN.test(value.trim())) {
    throw new CollaborationHistoryError(
      `${field} 格式无效`,
      "COLLABORATION_HISTORY_ID_INVALID"
    );
  }
  return value.trim();
}

function normalizeParticipants(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARTICIPANTS) {
    throw new CollaborationHistoryError("participants 格式无效");
  }
  const participants = [...new Set(value.map(participant =>
    requiredText(participant, "participant", 64)
  ))];
  if (participants.length !== value.length) {
    throw new CollaborationHistoryError(
      "participants 不允许重复",
      "COLLABORATION_HISTORY_PARTICIPANT_DUPLICATE"
    );
  }
  return participants;
}

function cloneRecord(record) {
  return {
    id: record.id,
    roomId: record.roomId,
    topic: record.topic,
    participants: [...record.participants],
    summary: record.summary,
    createdAt: record.createdAt
  };
}

class CollaborationHistoryService {
  #records = new Map();
  #idFactory;
  #now;

  constructor({
    idFactory = () => `council-history-${crypto.randomUUID()}`,
    now = () => new Date().toISOString()
  } = {}) {
    if (typeof idFactory !== "function" || typeof now !== "function") {
      throw new TypeError("idFactory 和 now 必须是函数");
    }
    this.#idFactory = idFactory;
    this.#now = now;
  }

  save(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new CollaborationHistoryError("History input 必须是 object");
    }
    const unknown = Object.keys(input).find(field => !HISTORY_INPUT_FIELDS.includes(field));
    if (unknown) throw new CollaborationHistoryError(`不允许 History 字段：${unknown}`);
    const missing = HISTORY_INPUT_FIELDS.find(field => !Object.hasOwn(input, field));
    if (missing) throw new CollaborationHistoryError(`History 缺少字段：${missing}`);

    const record = {
      id: validId(this.#idFactory(), "id"),
      roomId: validId(input.roomId, "roomId"),
      topic: requiredText(input.topic, "topic", MAX_TOPIC_LENGTH),
      participants: normalizeParticipants(input.participants),
      summary: requiredText(input.summary, "summary", MAX_SUMMARY_LENGTH),
      createdAt: this.#now()
    };
    if (this.#records.has(record.id)) {
      throw new CollaborationHistoryError(
        "History id 已存在",
        "COLLABORATION_HISTORY_CONFLICT"
      );
    }
    if (typeof record.createdAt !== "string" ||
        !record.createdAt ||
        Number.isNaN(Date.parse(record.createdAt))) {
      throw new CollaborationHistoryError("createdAt 格式无效");
    }
    this.#records.set(record.id, Object.freeze({
      ...record,
      participants: Object.freeze([...record.participants])
    }));
    return cloneRecord(record);
  }

  get(id) {
    const record = this.#records.get(validId(id, "id"));
    return record ? cloneRecord(record) : null;
  }

  list({ roomId } = {}) {
    const filter = roomId == null ? null : validId(roomId, "roomId");
    return [...this.#records.values()]
      .filter(record => !filter || record.roomId === filter)
      .map(cloneRecord);
  }
}

module.exports = {
  CONTEXT_MARKER_PATTERN,
  CollaborationHistoryError,
  CollaborationHistoryService,
  HISTORY_INPUT_FIELDS,
  ID_PATTERN,
  MAX_PARTICIPANTS,
  MAX_SUMMARY_LENGTH,
  MAX_TOPIC_LENGTH,
  cloneRecord,
  normalizeParticipants
};
