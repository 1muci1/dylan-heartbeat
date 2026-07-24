"use strict";

const { MEMORY_IMPORT_CATEGORIES } = require("./memory-import-contract");

const AGENT_MEMORY_SOURCE = "agent-memory-runtime:v1";
const PROPOSAL_FIELDS = new Set(["category", "title", "content", "importance"]);
const CATEGORY_TO_TYPE = Object.freeze({
  fact: "MEMORY",
  preference: "WISHLIST",
  event: "EVENT",
  relationship: "PROMISE"
});
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20000;
const SENSITIVE_PATTERN = /(?:\bapi[\s_-]*key\b|\b(?:access|bearer|device)?[\s_-]*token\b|\bpassword\b|\bpasswd\b|\bcookie\b|\bprivate[\s_-]*key\b|\botp\b|\bverification[\s_-]*code\b|API\s*密钥|访问令牌|密码|私钥|验证码|设备\s*token)/iu;

class AgentMemoryWriterError extends Error {
  constructor(message, code = "AGENT_MEMORY_PROPOSAL_INVALID") {
    super(message);
    this.name = "AgentMemoryWriterError";
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new AgentMemoryWriterError(`${field} 必须是字符串`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AgentMemoryWriterError(`${field} 长度无效`);
  }
  return normalized;
}

function normalizeProposal(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentMemoryWriterError("proposal 必须是对象");
  }
  const unknown = Object.keys(input).find(field => !PROPOSAL_FIELDS.has(field));
  if (unknown) {
    throw new AgentMemoryWriterError(`proposal 包含不允许的字段：${unknown}`, "AGENT_MEMORY_FIELD_FORBIDDEN");
  }
  const category = String(input.category || "");
  if (!MEMORY_IMPORT_CATEGORIES.includes(category)) {
    throw new AgentMemoryWriterError("category 无效");
  }
  const title = requiredText(input.title, "title", MAX_TITLE_LENGTH);
  const content = requiredText(input.content, "content", MAX_CONTENT_LENGTH);
  const importance = Number(input.importance);
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new AgentMemoryWriterError("importance 必须是 1 到 5");
  }
  if (SENSITIVE_PATTERN.test(`${title}\n${content}`)) {
    throw new AgentMemoryWriterError("proposal 包含敏感信息", "AGENT_MEMORY_SENSITIVE");
  }
  return Object.freeze({ category, title, content, importance });
}

class AgentMemoryWriter {
  #store;

  constructor({ store } = {}) {
    if (!store || typeof store.create !== "function") {
      throw new TypeError("StructuredMemoryStore 必填");
    }
    this.#store = store;
  }

  create(proposal) {
    const normalized = normalizeProposal(proposal);
    return this.#store.create({
      type: CATEGORY_TO_TYPE[normalized.category],
      title: normalized.title,
      content: normalized.content,
      importance: normalized.importance,
      source: AGENT_MEMORY_SOURCE
    });
  }
}

module.exports = {
  AGENT_MEMORY_SOURCE,
  AgentMemoryWriter,
  AgentMemoryWriterError,
  CATEGORY_TO_TYPE,
  normalizeProposal
};
