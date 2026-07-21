"use strict";

const DEFAULT_MAX_CONTEXT_SIZE = 8000;
const STATE_KEYS = Object.freeze([
  "last_user_interaction_at",
  "current_focus_project",
  "pending_follow_up",
  "preferred_interaction_style"
]);
const FORBIDDEN_KEY = /(?:prompt|stack|error|secret|token|password|content|summary|embedding|metadata|mood|energy|familiarity|personality|emotion)/i;

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
    if (FORBIDDEN_KEY.test(key)) continue;
    output[key] = safeValue(item, depth + 1);
  }
  return output;
}

function text(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sizeOf(value) {
  return JSON.stringify(value).length;
}

class ProactiveContextBuilder {
  constructor({ maxContextSize = DEFAULT_MAX_CONTEXT_SIZE, channel = "proactive_contact" } = {}) {
    const limit = Number(maxContextSize);
    if (!Number.isInteger(limit) || limit < 256) throw new TypeError("maxContextSize 必须是至少 256 的整数");
    this.maxContextSize = limit;
    this.channel = text(channel, 80) || "proactive_contact";
  }

  build(jobContext = {}) {
    const input = plainObject(jobContext) ? jobContext : {};
    const event = plainObject(input.event) ? input.event : {};
    const stateInput = plainObject(input.state) ? input.state : {};
    const relationshipInput = plainObject(input.relationship) ? input.relationship : {};

    const state = {};
    for (const key of STATE_KEYS) {
      if (Object.hasOwn(stateInput, key)) state[key] = safeValue(stateInput[key]);
    }

    const relationship = {};
    if (Object.hasOwn(relationshipInput, "interactionStyle")) relationship.interactionStyle = safeValue(relationshipInput.interactionStyle);
    const proactive = plainObject(relationshipInput.proactiveContact) ? relationshipInput.proactiveContact : {};
    if (typeof proactive.enabled === "boolean") relationship.proactiveContact = { enabled: proactive.enabled };
    const quietHours = Object.hasOwn(relationshipInput, "quietHours") ? relationshipInput.quietHours : proactive.quietHours;
    if (quietHours !== undefined) relationship.quietHours = safeValue(quietHours);

    const memories = (Array.isArray(input.memories) ? input.memories : [])
      .filter(plainObject)
      .map((memory, index) => ({
        id: text(memory.id, 200),
        type: text(memory.type, 80),
        title: text(memory.title, 300),
        importance: Number.isInteger(Number(memory.importance)) ? Math.min(5, Math.max(1, Number(memory.importance))) : 3,
        _index: index
      }))
      .filter(memory => memory.id)
      .sort((a, b) => b.importance - a.importance || a._index - b._index)
      .slice(0, 5)
      .map(({ _index, ...memory }) => memory);

    const result = {
      trigger: {
        eventId: text(event.eventId ?? event.id, 200),
        eventType: text(event.eventType, 120),
        reasonCode: text(event.reasonCode ?? input.reasonCode, 120),
        ...(text(event.subjectType, 100) ? { subjectType: text(event.subjectType, 100) } : {}),
        ...(text(event.subjectId, 200) ? { subjectId: text(event.subjectId, 200) } : {})
      },
      state,
      relationship,
      memories,
      constraints: { maxLength: this.maxContextSize, channel: this.channel }
    };

    while (sizeOf(result) > this.maxContextSize && result.memories.length) result.memories.pop();
    for (const key of ["quietHours", "interactionStyle", "proactiveContact"]) {
      if (sizeOf(result) <= this.maxContextSize) break;
      delete result.relationship[key];
    }
    for (const key of [...STATE_KEYS].reverse()) {
      if (sizeOf(result) <= this.maxContextSize) break;
      delete result.state[key];
    }
    if (sizeOf(result) > this.maxContextSize) {
      for (const key of ["subjectId", "subjectType", "reasonCode", "eventType", "eventId"]) {
        if (sizeOf(result) <= this.maxContextSize) break;
        result.trigger[key] = text(result.trigger[key], 32);
      }
    }
    return result;
  }
}

module.exports = { DEFAULT_MAX_CONTEXT_SIZE, ProactiveContextBuilder, STATE_KEYS };
