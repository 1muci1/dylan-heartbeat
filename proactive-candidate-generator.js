"use strict";

const DEFAULT_INACTIVITY_HOURS = 7 * 24;
const INACTIVITY_CANDIDATE_HOURS = 24;

function stateEntry(state, key) {
  if (Array.isArray(state)) return state.find(item => item?.stateKey === key);
  if (!state || typeof state !== "object") return undefined;
  if (!Object.prototype.hasOwnProperty.call(state, key)) return undefined;
  const raw = state[key];
  return raw && typeof raw === "object" && raw.stateKey === key ? raw : { value: raw };
}

function stateValue(state, key) {
  return stateEntry(state, key)?.value;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validDate(value) {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeKey(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : fallback;
}

function eventExpiry(event) {
  return validDate(event.expiresAt)?.toISOString() || "";
}

function dedupe(candidates) {
  const eventIds = new Set();
  const byTopic = new Map();
  for (const candidate of candidates) {
    if (candidate.eventId && eventIds.has(candidate.eventId)) continue;
    if (candidate.eventId) eventIds.add(candidate.eventId);
    const existing = byTopic.get(candidate.topicKey);
    if (!existing || candidate.priority > existing.priority) byTopic.set(candidate.topicKey, candidate);
  }
  return [...byTopic.values()];
}

class ProactiveCandidateGenerator {
  generate(context = {}) {
    const events = Array.isArray(context.events) ? context.events : [];
    const now = validDate(context.now ?? new Date());
    if (!now) throw new TypeError("context.now 必须是有效时间");
    const candidates = [];

    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const eventId = safeKey(event.id, "");
      if (!eventId) continue;
      if (event.eventType === "project.milestone_reached") {
        candidates.push({
          type: "project_milestone",
          eventId,
          topicKey: `project:${safeKey(event.subjectId, eventId)}`,
          priority: 2,
          expiresAt: eventExpiry(event),
          reasonCode: "PROJECT_MILESTONE"
        });
      } else if (event.eventType === "memory.created") {
        const importance = Number(objectValue(event.payload).importance ?? event.importance);
        if (Number.isInteger(importance) && importance >= 4) {
          candidates.push({
            type: "important_memory",
            eventId,
            topicKey: `memory:${safeKey(event.subjectId, eventId)}`,
            priority: 3,
            expiresAt: eventExpiry(event),
            reasonCode: "IMPORTANT_MEMORY"
          });
        }
      }
    }

    const pendingEntry = stateEntry(context.state, "pending_follow_up");
    const pending = objectValue(pendingEntry?.value);
    if (pendingEntry && pending.enabled !== false && pending.resolved !== true) {
      const sourceId = safeKey(pendingEntry.sourceEventId, "pending-follow-up");
      const topicKey = safeKey(pending.topicKey, `follow-up:${sourceId}`);
      candidates.push({
        type: "follow_up",
        eventId: sourceId,
        topicKey,
        priority: 2,
        expiresAt: validDate(pending.expiresAt)?.toISOString() || "",
        reasonCode: "FOLLOW_UP"
      });
    }

    const interactionEntry = stateEntry(context.state, "last_user_interaction_at");
    const interaction = objectValue(interactionEntry?.value);
    const lastInteraction = validDate(interaction.timestamp ?? interactionEntry?.value);
    const configuredThreshold = Number(stateValue(context.state, "inactivity_threshold_hours"));
    const thresholdHours = Number.isFinite(configuredThreshold) && configuredThreshold > 0
      ? configuredThreshold : DEFAULT_INACTIVITY_HOURS;
    if (lastInteraction && now.getTime() - lastInteraction.getTime() >= thresholdHours * 3600000) {
      const timestamp = lastInteraction.toISOString();
      candidates.push({
        type: "inactivity_check",
        eventId: safeKey(interactionEntry?.sourceEventId, `state:last-user-interaction:${timestamp}`),
        topicKey: `inactivity:${timestamp}`,
        priority: 4,
        expiresAt: new Date(now.getTime() + INACTIVITY_CANDIDATE_HOURS * 3600000).toISOString(),
        reasonCode: "INACTIVITY"
      });
    }

    return dedupe(candidates);
  }
}

module.exports = { DEFAULT_INACTIVITY_HOURS, ProactiveCandidateGenerator, dedupe };
