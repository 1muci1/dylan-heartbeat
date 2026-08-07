"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_SUGGESTIONS = 100;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ASK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STATUSES = new Set(["pending", "approved", "rejected", "expired"]);
const SAFE_FALLBACK_REASONS = new Set([
  "MODEL_DISABLED", "PROVIDER_CONFIG_MISSING", "TARGET_API_URL_MISSING",
  "TARGET_API_KEY_MISSING", "MODEL_HTTP_FAILED", "MODEL_TIMEOUT",
  "MODEL_EMPTY_RESPONSE", "MODEL_JSON_PARSE_FAILED", "MODEL_MOVE_MISSING",
  "MODEL_MOVE_NOT_NUMERIC", "MODEL_MOVE_OUT_OF_RANGE", "MODEL_MOVE_OCCUPIED",
  "MODEL_MOVE_NOT_IN_CANDIDATES", "GAME_ALREADY_OVER", "INTERNAL_ERROR"
]);
const FORBIDDEN_PATTERN = /(?:api[\s_-]*key|authorization|bearer\s+|prompt|raw(?:response|model)|movehistory|完整棋盘|\bboard\b)/iu;

class MemorySuggestionError extends Error {
  constructor(message, statusCode = 400, code = "MEMORY_SUGGESTION_INVALID") {
    super(message);
    this.name = "MemorySuggestionError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function text(value, field, max) {
  if (typeof value !== "string") throw new MemorySuggestionError(`${field} 必须是字符串`);
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > max || FORBIDDEN_PATTERN.test(normalized)) {
    throw new MemorySuggestionError(`${field} 不安全或长度无效`, 400, "MEMORY_SUGGESTION_UNSAFE");
  }
  return normalized;
}

function count(value, field) {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number < 0 || number > 10000) {
    throw new MemorySuggestionError(`${field} 无效`);
  }
  return number;
}

function safeGameMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MemorySuggestionError("metadata 无效");
  const game = String(input.game || "");
  const winner = String(input.winner || "");
  if (!new Set(["gomoku", "draw"]).has(game) || !new Set(["user", "chen", "draw"]).has(winner)) {
    throw new MemorySuggestionError("game 或 winner 无效");
  }
  return Object.freeze({
    game,
    winner,
    moves: count(input.moves, "moves"),
    chenSourceCount: count(input.chenSourceCount, "chenSourceCount"),
    fallbackCount: count(input.fallbackCount, "fallbackCount"),
    fallbackReasons: [...new Set((Array.isArray(input.fallbackReasons) ? input.fallbackReasons : [])
      .map(String).filter(reason => SAFE_FALLBACK_REASONS.has(reason)))].slice(0, 10)
  });
}

function gameLabels(metadata) {
  return {
    game: metadata.game === "gomoku" ? "五子棋" : "你画我猜",
    winner: metadata.winner === "user" ? "辞辞赢了" : metadata.winner === "chen" ? "沉赢了" : "平局"
  };
}

function buildGameSuggestion(input, now = new Date()) {
  const metadata = safeGameMetadata(input);
  const labels = gameLabels(metadata);
  const summary = `辞辞刚刚和沉玩了一局${labels.game}，${labels.winner}，共 ${metadata.moves} 步。`;
  const fallback = metadata.fallbackCount
    ? `其中 ${metadata.fallbackCount} 步因超时或异常由系统兜底。`
    : "";
  return Object.freeze({
    source: "game_result",
    kind: "relationship_memory",
    title: `辞辞和沉玩了一局${labels.game}`,
    summary,
    memoryText: `辞辞和沉一起玩过${labels.game}，${labels.winner}，共 ${metadata.moves} 步。沉有 ${metadata.chenSourceCount} 步根据局面选择落子。${fallback}`,
    metadata,
    createdAt: now.toISOString()
  });
}

function publicSuggestion(item) {
  return Object.freeze({
    id: item.id, status: item.status, createdAt: item.createdAt, source: item.source,
    kind: item.kind, title: item.title, summary: item.summary, memoryText: item.memoryText,
    metadata: Object.freeze({ ...item.metadata, fallbackReasons: Object.freeze([...(item.metadata.fallbackReasons || [])]) }),
    askedAt: item.askedAt || null, askCount: Number(item.askCount || 0),
    approvedAt: item.approvedAt || null, rejectedAt: item.rejectedAt || null,
    memoryId: item.memoryId || null
  });
}

function normalizeStoredItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item) || !STATUSES.has(item.status)) return null;
  try {
    const id = text(item.id, "id", 150);
    if (!/^suggestion-[A-Za-z0-9._-]+$/.test(id)) return null;
    const createdAt = new Date(item.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    const source = item.source === "game_result" ? item.source : null;
    const kind = item.kind === "relationship_memory" ? item.kind : null;
    if (!source || !kind) return null;
    return {
      id, status: item.status, createdAt: createdAt.toISOString(), source, kind,
      title: text(item.title, "title", 120), summary: text(item.summary, "summary", 500),
      memoryText: text(item.memoryText, "memoryText", 500), metadata: safeGameMetadata(item.metadata),
      askedAt: item.askedAt && !Number.isNaN(new Date(item.askedAt).getTime()) ? new Date(item.askedAt).toISOString() : null,
      askCount: Math.max(0, Math.min(1000, Number(item.askCount) || 0)),
      approvedAt: item.approvedAt && !Number.isNaN(new Date(item.approvedAt).getTime()) ? new Date(item.approvedAt).toISOString() : null,
      rejectedAt: item.rejectedAt && !Number.isNaN(new Date(item.rejectedAt).getTime()) ? new Date(item.rejectedAt).toISOString() : null,
      memoryId: typeof item.memoryId === "string" && /^[A-Za-z0-9._-]{1,150}$/.test(item.memoryId) ? item.memoryId : null
    };
  } catch {
    return null;
  }
}

class MemorySuggestionStore {
  constructor({ filename = path.join("runtime-data", "memory-suggestions.json"), writer, eventStore = null,
    clock = () => new Date(), idFactory = () => crypto.randomUUID(), maxSuggestions = MAX_SUGGESTIONS } = {}) {
    if (!writer || typeof writer.create !== "function") throw new TypeError("AgentMemoryWriter 必填");
    if (!Number.isInteger(maxSuggestions) || maxSuggestions < 1 || maxSuggestions > 100) throw new TypeError("maxSuggestions 无效");
    this.filename = filename;
    this.writer = writer;
    this.eventStore = eventStore;
    this.clock = clock;
    this.idFactory = idFactory;
    this.maxSuggestions = maxSuggestions;
    this.items = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filename, "utf8"));
      return Array.isArray(parsed) ? parsed.map(normalizeStoredItem).filter(Boolean).slice(-this.maxSuggestions) : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new MemorySuggestionError("Memory suggestion store 无法读取", 500, "MEMORY_SUGGESTION_STORE_FAILED");
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.items, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, this.filename);
    fs.chmodSync(this.filename, 0o600);
  }

  #record(eventType, item, payload) {
    if (!this.eventStore) return;
    this.eventStore.create({
      eventType, subjectType: "memory_candidate", subjectId: item.id, payload,
      dedupeKey: `memory-suggestion:${item.id}:${eventType}`,
      occurredAt: this.clock().toISOString()
    }, { source: "memory-candidate" });
  }

  list({ status, limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    return this.items.filter(item => !status || item.status === status).slice(-safeLimit).reverse().map(publicSuggestion);
  }

  get(id) {
    const item = this.items.find(entry => entry.id === String(id));
    if (!item) throw new MemorySuggestionError("Memory suggestion 不存在", 404, "MEMORY_SUGGESTION_NOT_FOUND");
    return item;
  }

  suggestGameResult(gameResult) {
    const now = this.clock();
    const suggestion = buildGameSuggestion(gameResult, now);
    const duplicate = [...this.items].reverse().find(item => item.source === "game_result" &&
      item.metadata?.game === suggestion.metadata.game && item.metadata?.winner === suggestion.metadata.winner &&
      now.getTime() - new Date(item.createdAt).getTime() < DEDUPE_WINDOW_MS);
    if (duplicate) return Object.freeze({ created: false, suggestion: publicSuggestion(duplicate) });
    const item = {
      id: `suggestion-${this.idFactory()}`, status: "pending", ...suggestion,
      askedAt: null, askCount: 0, approvedAt: null, rejectedAt: null, memoryId: null
    };
    this.#record("memory_candidate.created", item, { kind: item.kind, source: item.source });
    this.items.push(item);
    this.items = this.items.slice(-this.maxSuggestions);
    this.#save();
    return Object.freeze({ created: true, suggestion: publicSuggestion(item) });
  }

  latestPending(source = null) {
    const item = [...this.items].reverse().find(entry => entry.status === "pending" && (!source || entry.source === source));
    return item ? publicSuggestion(item) : null;
  }

  claimQuestion(source = "game_result") {
    const item = [...this.items].reverse().find(entry => entry.status === "pending" && entry.source === source);
    if (!item) return null;
    const now = this.clock();
    if (item.askedAt && now.getTime() - new Date(item.askedAt).getTime() < ASK_COOLDOWN_MS) return null;
    item.askedAt = now.toISOString();
    item.askCount = Number(item.askCount || 0) + 1;
    this.#save();
    return publicSuggestion(item);
  }

  approve(id) {
    const item = this.get(id);
    if (item.status !== "pending") throw new MemorySuggestionError("只有 pending suggestion 可以批准", 409, "MEMORY_SUGGESTION_NOT_PENDING");
    let memory;
    try {
      memory = this.writer.create({ category: "relationship", title: text(item.title, "title", 120),
        content: text(item.memoryText, "memoryText", 500), importance: 3 });
    } catch {
      throw new MemorySuggestionError("长期记忆暂时没有写入，请稍后再试", 503, "MEMORY_WRITE_FAILED");
    }
    const now = this.clock().toISOString();
    this.#record("memory_candidate.approved", item, { memoryId: memory?.id || null, kind: item.kind });
    item.status = "approved";
    item.approvedAt = now;
    item.memoryId = typeof memory?.id === "string" ? memory.id : null;
    this.#save();
    return publicSuggestion(item);
  }

  reject(id) {
    const item = this.get(id);
    if (item.status !== "pending") throw new MemorySuggestionError("只有 pending suggestion 可以拒绝", 409, "MEMORY_SUGGESTION_NOT_PENDING");
    const now = this.clock().toISOString();
    this.#record("memory_candidate.rejected", item, { reasonCode: "USER_REJECTED", kind: item.kind });
    item.status = "rejected";
    item.rejectedAt = now;
    this.#save();
    return publicSuggestion(item);
  }
}

function isMemorySuggestionApproval(value) {
  return /^(?:好[的呀啊]?[,， ]*)?(?:记下来|记住(?:它|这个|这件事)?|可以记|嗯[,， ]*记住|对[,， ]*这个要记|以后要记得|加到记忆里)[。！! ]*$/u.test(String(value || "").trim());
}

function isMemorySuggestionRejection(value) {
  return /^(?:好[的呀啊]?[,， ]*)?(?:不用记|别记|不要记|算了|这个不用|删掉这条建议)[。！! ]*$/u.test(String(value || "").trim());
}

module.exports = {
  ASK_COOLDOWN_MS, DEDUPE_WINDOW_MS, MAX_SUGGESTIONS, MemorySuggestionError,
  MemorySuggestionStore, buildGameSuggestion, isMemorySuggestionApproval,
  isMemorySuggestionRejection, safeGameMetadata
};
