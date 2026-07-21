"use strict";

const { StateStoreError } = require("./state-store");

const SAFE_KEYS = new Set(["chat.turn_completed", "ai_job.completed", "memory.created", "proactive.feedback_received"]);

class StateProjector {
  constructor({ stateStore, scopeType = "companion", scopeId = "default" } = {}) {
    if (!stateStore || typeof stateStore.set !== "function") throw new TypeError("stateStore 必填");
    this.stateStore = stateStore;
    this.scopeType = scopeType;
    this.scopeId = scopeId;
  }

  project(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new StateStoreError("Event 格式无效");
    if (typeof event.id !== "string" || !event.id || typeof event.eventType !== "string" || !event.eventType) {
      throw new StateStoreError("Event id/eventType 必填");
    }
    if (!SAFE_KEYS.has(event.eventType)) return [];
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new StateStoreError("Event occurredAt 无效", 400, "STATE_TIME_INVALID");
    const timestamp = occurredAt.toISOString();
    const definition = this.definition(event, timestamp);
    if (!definition) return [];
    const current = this.stateStore.get(this.scopeType, this.scopeId, definition.stateKey);
    const newerOrEqual = event.eventType === "proactive.feedback_received"
      ? current?.validFrom && current.validFrom > timestamp
      : current?.validFrom && current.validFrom >= timestamp;
    if (current?.sourceEventId === event.id || newerOrEqual) return [];
    const state = this.stateStore.set({
      scopeType: this.scopeType,
      scopeId: this.scopeId,
      stateKey: definition.stateKey,
      value: definition.value,
      sourceKind: "event",
      sourceEventId: event.id,
      sourceMemoryId: definition.sourceMemoryId || null,
      confidence: 1,
      validFrom: timestamp
    });
    return [state];
  }

  definition(event, timestamp) {
    if (event.eventType === "chat.turn_completed") {
      return { stateKey: "last_user_interaction_at", value: { timestamp } };
    }
    if (event.eventType === "ai_job.completed") {
      return { stateKey: "last_ai_job_completed_at", value: { jobType: String(event.payload?.jobType || "unknown"), timestamp } };
    }
    if (event.eventType === "memory.created") {
      return {
        stateKey: "recent_memory_created_at",
        value: { memoryId: String(event.subjectId || ""), type: String(event.payload?.type || "MEMORY") },
        sourceMemoryId: event.subjectType === "memory" && event.subjectId ? String(event.subjectId) : null
      };
    }
    if (event.eventType === "proactive.feedback_received" && event.payload?.feedbackType === "disable_future") {
      return { stateKey: "proactive_contact.enabled", value: false };
    }
    return null;
  }
}

module.exports = { StateProjector };
