"use strict";

const { EventStoreError } = require("./event-store");

const GAME_EVENT_SOURCE = "game-event-service";
const GAME_EVENT_TYPES = Object.freeze([
  "mood_selected",
  "mini_game_completed",
  "game_result",
  "room_interaction"
]);
const INPUT_FIELDS = new Set(["eventType", "title", "metadata"]);
const SENSITIVE_KEY = /(?:secret|token|password|prompt|stack|error|memory|chat|provider|account|key)/i;
const MAX_METADATA_BYTES = 4 * 1024;
const GAME_RESULT_FIELDS = new Set([
  "game", "winner", "moves", "chenMoveCount", "chenSourceCount",
  "fallbackCount", "fallbackReasons", "endedAt", "summary"
]);
const FALLBACK_REASONS = new Set([
  "MODEL_DISABLED", "PROVIDER_CONFIG_MISSING", "TARGET_API_URL_MISSING",
  "TARGET_API_KEY_MISSING", "MODEL_HTTP_FAILED", "MODEL_TIMEOUT",
  "MODEL_EMPTY_RESPONSE", "MODEL_JSON_PARSE_FAILED", "MODEL_MOVE_MISSING",
  "MODEL_MOVE_NOT_NUMERIC", "MODEL_MOVE_OUT_OF_RANGE", "MODEL_MOVE_OCCUPIED",
  "MODEL_MOVE_NOT_IN_CANDIDATES", "INTERNAL_ERROR", "CLIENT_REQUEST_FAILED"
]);

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

function boundedCount(value, field, maximum = 500) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) throw gameError(`${field} 无效`);
  return number;
}

function validateGameResultMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw gameError("metadata 必须是对象");
  const unknown = Object.keys(value).find(key => !GAME_RESULT_FIELDS.has(key));
  if (unknown) throw gameError(`game_result 包含不允许的字段：${unknown}`, "GAME_RESULT_FIELD_FORBIDDEN");
  const game = String(value.game || "");
  const winner = String(value.winner || "");
  if (!['gomoku', 'draw'].includes(game)) throw gameError("game 无效");
  if (!['user', 'chen', 'draw'].includes(winner)) throw gameError("winner 无效");
  const fallbackReasons = Array.isArray(value.fallbackReasons)
    ? [...new Set(value.fallbackReasons.map(String))].slice(0, 10)
    : [];
  if (fallbackReasons.some(reason => !FALLBACK_REASONS.has(reason))) throw gameError("fallbackReasons 无效");
  const endedAt = new Date(value.endedAt || "");
  if (Number.isNaN(endedAt.getTime())) throw gameError("endedAt 无效");
  const summary = String(value.summary || "").trim();
  if (!summary || summary.length > 500) throw gameError("summary 无效");
  const output = {
    game,
    winner,
    moves: boundedCount(value.moves, "moves"),
    chenMoveCount: boundedCount(value.chenMoveCount, "chenMoveCount"),
    chenSourceCount: boundedCount(value.chenSourceCount, "chenSourceCount"),
    fallbackCount: boundedCount(value.fallbackCount, "fallbackCount"),
    fallbackReasons,
    endedAt: endedAt.toISOString(),
    summary
  };
  if (output.chenSourceCount + output.fallbackCount > output.chenMoveCount) {
    throw gameError("沉的落子统计无效");
  }
  return output;
}

function isRecentGameQuestion(content) {
  const text = String(content || "").trim().replace(/\s+/g, "");
  return /(?:刚刚|刚才|上一局|那局).*(?:记得|记忆|谁赢|结果|玩了什么|是不是你下)|(?:记得|记忆).*(?:刚刚|刚才|上一局|那局)|下棋结果/u.test(text);
}

function gameResultSentence(result) {
  const gameName = result?.game === "draw" ? "你画我猜" : "五子棋";
  const winner = result?.winner === "user" ? "辞辞赢了" : result?.winner === "chen" ? "我赢了" : "平局";
  const reasons = Array.isArray(result?.fallbackReasons) && result.fallbackReasons.length
    ? `，原因是 ${result.fallbackReasons.join("、")}`
    : "";
  return `刚刚那局是${gameName}，${winner}，一共 ${result?.moves || 0} 步。我有 ${result?.chenSourceCount || 0} 步是根据棋盘选的，系统兜底 ${result?.fallbackCount || 0} 步${reasons}。`;
}

function answerRecentGameQuestion(results) {
  if (!Array.isArray(results) || !results.length) {
    return "这局没有保存到结果记录里，所以我只能知道你刚刚说想玩游戏，不敢乱说谁赢了。";
  }
  return `记得。${gameResultSentence(results[0])}`;
}

function buildRecentGameContext(results) {
  if (!Array.isArray(results) || !results.length) return null;
  return {
    role: "system",
    content: `[最近游戏结果]\n${results.slice(0, 3).map(gameResultSentence).join("\n")}\n请依据这些结果自然接话，不要声称看不到棋局，也不要补造未记录的细节。`
  };
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
    const metadata = input.eventType === "game_result"
      ? validateGameResultMetadata(input.metadata)
      : validateMetadata(input.metadata);
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

  recentResults(limit = 3) {
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 3));
    return this.eventStore.list({ eventType: "game_result", page: 1, limit: safeLimit, sort: "newest" }).items
      .map(event => ({ ...event.payload.metadata, eventId: event.id, occurredAt: event.occurredAt }));
  }
}

module.exports = {
  GAME_EVENT_SOURCE,
  GAME_EVENT_TYPES,
  GameEventService,
  MAX_METADATA_BYTES,
  answerRecentGameQuestion,
  buildRecentGameContext,
  gameResultSentence,
  isRecentGameQuestion,
  validateGameResultMetadata,
  validateMetadata
};
