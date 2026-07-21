"use strict";

const { STATE_KEYS } = require("./proactive-context-builder");

const PROACTIVE_RESPONSE_PROMPT_VERSION = "proactive-response-v1";
const PROACTIVE_RESPONSE_SYSTEM_PROMPT = [
  "你负责判断是否生成一条克制、简短的主动联系内容。",
  "只能依据提供的安全上下文，不得假设用户心理、情绪或关系亲密度。",
  "仅输出 JSON 对象，字段严格为 action、text、reasonCode。",
  "action 只能是 proactive_contact 或 no_action；text 最多 500 个字符。",
  "不要输出分析过程、系统提示、隐藏推理或额外字段。"
].join("\n");
const ACTIONS = new Set(["proactive_contact", "no_action"]);
const REASON_CODES = new Set([
  "PROJECT_MILESTONE", "IMPORTANT_MEMORY", "FOLLOW_UP", "INACTIVITY", "MODEL_NO_ACTION"
]);
const FORBIDDEN_KEY = /(?:payload|prompt|stack|error|secret|token|password|content|summary|embedding|metadata|chat|message|reasoning)/i;

class ProactiveResponseError extends Error {
  constructor(message, code, statusCode = 502) {
    super(message);
    this.name = "ProactiveResponseError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeValue(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1000);
  if (depth >= 3) return null;
  if (Array.isArray(value)) return value.slice(0, 10).map(item => safeValue(item, depth + 1));
  if (!plainObject(value)) return null;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!FORBIDDEN_KEY.test(key)) output[key] = safeValue(item, depth + 1);
  }
  return output;
}

function promptContext(context) {
  const input = plainObject(context) ? context : {};
  const trigger = plainObject(input.trigger) ? input.trigger : {};
  const stateInput = plainObject(input.state) ? input.state : {};
  const relationshipInput = plainObject(input.relationship) ? input.relationship : {};
  const state = {};
  for (const key of STATE_KEYS) if (Object.hasOwn(stateInput, key)) state[key] = safeValue(stateInput[key]);
  const relationship = {};
  if (Object.hasOwn(relationshipInput, "interactionStyle")) relationship.interactionStyle = safeValue(relationshipInput.interactionStyle);
  if (typeof relationshipInput.proactiveContact?.enabled === "boolean") relationship.proactiveContact = { enabled: relationshipInput.proactiveContact.enabled };
  if (Object.hasOwn(relationshipInput, "quietHours")) relationship.quietHours = safeValue(relationshipInput.quietHours);
  return {
    trigger: {
      eventId: typeof trigger.eventId === "string" ? trigger.eventId.slice(0, 200) : "",
      eventType: typeof trigger.eventType === "string" ? trigger.eventType.slice(0, 120) : "",
      reasonCode: typeof trigger.reasonCode === "string" ? trigger.reasonCode.slice(0, 120) : "",
      ...(typeof trigger.subjectType === "string" ? { subjectType: trigger.subjectType.slice(0, 100) } : {}),
      ...(typeof trigger.subjectId === "string" ? { subjectId: trigger.subjectId.slice(0, 200) } : {})
    },
    state,
    relationship,
    memories: (Array.isArray(input.memories) ? input.memories : []).slice(0, 5).filter(plainObject).map(memory => ({
      id: typeof memory.id === "string" ? memory.id.slice(0, 200) : "",
      type: typeof memory.type === "string" ? memory.type.slice(0, 80) : "",
      title: typeof memory.title === "string" ? memory.title.slice(0, 300) : "",
      importance: Number.isInteger(Number(memory.importance)) ? Math.min(5, Math.max(1, Number(memory.importance))) : 3
    })).filter(memory => memory.id),
    constraints: {
      maxLength: Number.isInteger(Number(input.constraints?.maxLength)) ? Number(input.constraints.maxLength) : 8000,
      channel: typeof input.constraints?.channel === "string" ? input.constraints.channel.slice(0, 80) : "proactive_contact"
    }
  };
}

function validateOutput(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); }
    catch { throw new ProactiveResponseError("模型输出不是有效 JSON", "MODEL_OUTPUT_INVALID", 422); }
  }
  if (!plainObject(value) || Object.keys(value).some(key => !["action", "text", "reasonCode"].includes(key))) {
    throw new ProactiveResponseError("模型输出结构无效", "MODEL_OUTPUT_INVALID", 422);
  }
  if (!ACTIONS.has(value.action) || typeof value.text !== "string" || value.text.length > 500 || !REASON_CODES.has(value.reasonCode)) {
    throw new ProactiveResponseError("模型输出字段无效", "MODEL_OUTPUT_INVALID", 422);
  }
  if (value.action === "no_action" && (value.text !== "" || value.reasonCode !== "MODEL_NO_ACTION")) {
    throw new ProactiveResponseError("no_action 输出无效", "MODEL_OUTPUT_INVALID", 422);
  }
  if (value.action === "proactive_contact" && !value.text.trim()) {
    throw new ProactiveResponseError("主动联系文本不能为空", "MODEL_OUTPUT_INVALID", 422);
  }
  return { action: value.action, text: value.text, reasonCode: value.reasonCode };
}

class ProactiveResponseAdapter {
  constructor({ adapter, model, timeoutMs = 60000 } = {}) {
    this.adapter = adapter;
    this.model = typeof model === "string" ? model.trim() : "";
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000;
  }

  async generate(context) {
    if (!this.adapter?.generate || !this.model) throw new ProactiveResponseError("主动回复模型不可用", "MODEL_UNAVAILABLE", 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await Promise.race([
        this.adapter.generate({ model: this.model, system: PROACTIVE_RESPONSE_SYSTEM_PROMPT, input: promptContext(context), signal: controller.signal }),
        new Promise((resolve, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }))
      ]);
      if (typeof response?.content !== "string") throw new ProactiveResponseError("模型响应不可用", "MODEL_UNAVAILABLE", 503);
      return validateOutput(response.content);
    } catch (error) {
      if (error?.code === "MODEL_OUTPUT_INVALID") throw error;
      throw new ProactiveResponseError("主动回复模型不可用", "MODEL_UNAVAILABLE", 503);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  ACTIONS, PROACTIVE_RESPONSE_PROMPT_VERSION, PROACTIVE_RESPONSE_SYSTEM_PROMPT,
  ProactiveResponseAdapter, ProactiveResponseError, REASON_CODES, promptContext, validateOutput
};
