"use strict";

const MAX_SCAN_ITEMS = 10000;
const MAX_TOPICS = 10;

function allMemory(memoryStore) {
  const items = [];
  let page = 1;
  while (items.length < MAX_SCAN_ITEMS) {
    const result = memoryStore.list({ page, limit: 100, status: "active", sort: "importance" });
    items.push(...result.items);
    if (page >= result.meta.totalPages) break;
    page++;
  }
  return items;
}

function allEvents(eventStore) {
  const items = [];
  let page = 1;
  while (items.length < MAX_SCAN_ITEMS) {
    const result = eventStore.list({ page, limit: 100, sort: "newest" });
    items.push(...result.items);
    if (page >= result.meta.totalPages) break;
    page++;
  }
  return items;
}

function interactionStyle(memories) {
  for (const memory of memories) {
    const text = `${memory.title || ""}\n${memory.content || ""}`;
    if (!/(偏好|喜欢|希望|倾向|回复|解释|交流方式|互动方式)/u.test(text)) continue;
    if (/(简洁|简短|精炼|直接回复|短回复)/u.test(text)) return { value: "concise", source: "memory" };
    if (/(详细解释|详细回复|细致解释|展开说明|完整解释)/u.test(text)) return { value: "detailed", source: "memory" };
    if (/(自然交流|自然沟通|自然对话)/u.test(text)) return { value: "natural", source: "memory" };
  }
  return { value: "unspecified", source: "default" };
}

function stateValue(states, key) {
  return states.find(state => state.stateKey === key)?.value;
}

function boolValue(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && typeof value.enabled === "boolean") return value.enabled;
  return fallback;
}

function countValue(value) {
  const raw = typeof value === "number" ? value : value && typeof value === "object" ? value.count : 0;
  const count = Number(raw);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function publicConfigValue(value) {
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 24).map(publicConfigValue);
  if (!value || typeof value !== "object") return null;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(secret|token|password|prompt|stack|error|content|session|reasoning)/i.test(key)) continue;
    clean[key] = publicConfigValue(item);
  }
  return clean;
}

function safeTopic(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= 100 ? text : null;
}

function recentTopics(events) {
  const topics = [];
  const seen = new Set();
  for (const event of events) {
    const allowed = event.eventType === "memory.created" || event.eventType.startsWith("project.");
    if (!allowed) continue;
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : {};
    const topic = safeTopic(payload.topic) || safeTopic(payload.projectName) || safeTopic(payload.title) ||
      (event.eventType === "memory.created" ? safeTopic(payload.type) : safeTopic(event.subjectId));
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    topics.push(topic);
    if (topics.length >= MAX_TOPICS) break;
  }
  return topics;
}

function latestTimestamp(memories, events, states, fallback) {
  const values = [
    ...memories.map(item => item.updatedAt),
    ...events.map(item => item.occurredAt || item.createdAt),
    ...states.map(item => item.updatedAt)
  ].filter(Boolean).map(value => new Date(value)).filter(value => !Number.isNaN(value.getTime()));
  if (!values.length) return fallback().toISOString();
  return new Date(Math.max(...values.map(value => value.getTime()))).toISOString();
}

class RelationshipViewService {
  constructor({ memoryStore, eventStore, stateStore, clock = () => new Date() } = {}) {
    if (!memoryStore || typeof memoryStore.list !== "function") throw new TypeError("memoryStore 必填");
    if (!eventStore || typeof eventStore.list !== "function") throw new TypeError("eventStore 必填");
    if (!stateStore || typeof stateStore.list !== "function") throw new TypeError("stateStore 必填");
    if (typeof clock !== "function") throw new TypeError("clock 必须是函数");
    this.memoryStore = memoryStore;
    this.eventStore = eventStore;
    this.stateStore = stateStore;
    this.clock = clock;
  }

  get() {
    const memories = allMemory(this.memoryStore);
    const events = allEvents(this.eventStore);
    const states = this.stateStore.list("companion", "default");
    const enabledState = stateValue(states, "proactive_contact_enabled");
    const quietHours = stateValue(states, "proactive_contact_quiet_hours");
    const cooldown = stateValue(states, "proactive_contact_cooldown");
    const interactionCount = countValue(stateValue(states, "interaction_count"));
    const level = interactionCount <= 10 ? 1 : interactionCount <= 50 ? 2 : 3;
    return {
      interactionStyle: interactionStyle(memories),
      proactiveContact: {
        enabled: boolValue(enabledState, false),
        ...(quietHours !== undefined ? { quietHours: publicConfigValue(quietHours) } : {}),
        ...(cooldown !== undefined ? { cooldown: publicConfigValue(cooldown) } : {}),
        source: enabledState === undefined && quietHours === undefined && cooldown === undefined ? "default" : "state"
      },
      familiarity: { level, basis: "interaction_count" },
      recentTopics: recentTopics(events),
      importantMemoryIds: memories.filter(memory => Number(memory.importance) >= 4).map(memory => memory.id),
      updatedAt: latestTimestamp(memories, events, states, this.clock)
    };
  }
}

module.exports = { RelationshipViewService, interactionStyle, recentTopics };
