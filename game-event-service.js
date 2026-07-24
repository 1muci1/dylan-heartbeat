"use strict";

const { EventStoreError } = require("./event-store");

const GAME_EVENT_SOURCE = "game-event-service";
const GAME_EVENT_TYPES = Object.freeze([
  "mood_selected",
  "mini_game_completed",
  "room_interaction"
]);
const INPUT_FIELDS = new Set(["eventType", "title", "metadata"]);
const SENSITIVE_KEY = /(?:secret|token|password|prompt|stack|error|memory|chat|provider|account|key)/i;
const MAX_METADATA_BYTES = 4 * 1024;

function gameError(message, code = "GAME_EVENT_INVALID", statusCode = 400) {
  return new EventStoreError(message, statusCode, code);
}

function validateMetadata(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw gameError("metadata 必须是对象");
  }
  if (depth > 3) throw gameError("metadata 嵌套过深");
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 80 || SENSITIVE_KEY.test(key)) {
      throw gameError("metadata 包含不允许的字段", "GAME_EVENT_METADATA_FORBIDDEN");
    }
    if (item == null || typeof item === "boolean") output[key] = item;
    else if (typeof item === "number" && Number.isFinite(item)) output[key] = item;
    else if (typeof item === "string" && item.length <= 500) output[key] = item;
    else if (Array.isArray(item) && item.length <= 10) {
      output[key] = item.map(entry => {
        if (entry == null || typeof entry === "boolean") return entry;
        if (typeof entry === "number" && Number.isFinite(entry)) return entry;
        if (typeof entry === "string" && entry.length <= 200) return entry;
        throw gameError("metadata 数组值无效");
      });
    } else if (item && typeof item === "object") output[key] = validateMetadata(item, depth + 1);
    else throw gameError("metadata 值无效");
  }
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_METADATA_BYTES) {
    throw gameError("metadata 超过大小限制", "GAME_EVENT_METADATA_TOO_LARGE");
  }
  return output;
}

class GameEventService {
  constructor({ eventStore } = {}) {
    if (!eventStore || typeof eventStore.create !== "function") throw new TypeError("EventStore 必填");
    this.eventStore = eventStore;
  }

  create(input, { source = GAME_EVENT_SOURCE } = {}) {
    if (source !== GAME_EVENT_SOURCE) {
      throw gameError("source 无权创建游戏 Event", "GAME_EVENT_SOURCE_FORBIDDEN", 403);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw gameError("游戏 Event 输入必须是对象");
    }
    const unknown = Object.keys(input).find(field => !INPUT_FIELDS.has(field));
    if (unknown) throw gameError(`不允许传入字段：${unknown}`);
    if (!GAME_EVENT_TYPES.includes(input.eventType)) throw gameError("eventType 无效");
    if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 120) {
      throw gameError("title 格式无效");
    }
    const metadata = validateMetadata(input.metadata);
    return this.eventStore.create({
      eventType: input.eventType,
      subjectType: "game",
      subjectId: input.eventType,
      payload: {
        title: input.title.trim(),
        metadata
      }
    }, { source: GAME_EVENT_SOURCE });
  }
}

module.exports = {
  GAME_EVENT_SOURCE,
  GAME_EVENT_TYPES,
  GameEventService,
  MAX_METADATA_BYTES,
  validateMetadata
};
