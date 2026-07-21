"use strict";

const DEFAULT_DAILY_LIMIT = 3;
const DEFAULT_COOLDOWN_MINUTES = 60;

function stateValue(state, key) {
  if (Array.isArray(state)) return state.find(item => item?.stateKey === key)?.value;
  if (!state || typeof state !== "object") return undefined;
  const value = state[key];
  return value && typeof value === "object" && "value" in value && "stateKey" in value ? value.value : value;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && typeof value.enabled === "boolean") return value.enabled;
  return undefined;
}

function nonNegativeInteger(value, fallback) {
  const raw = value && typeof value === "object" ? value.count ?? value.limit ?? value.minutes : value;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function isoDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} 必须是有效时间`);
  return date;
}

function minutesOfDay(text) {
  if (typeof text !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return null;
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + minute;
}

function quietHoursResult(config, now) {
  const quiet = objectValue(config);
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  if (start === null || end === null || start === end) return null;
  const offset = Number.isInteger(quiet.timezoneOffsetMinutes) && Math.abs(quiet.timezoneOffsetMinutes) <= 14 * 60
    ? quiet.timezoneOffsetMinutes : 0;
  const localNow = new Date(now.getTime() + offset * 60000);
  const current = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const inside = start < end ? current >= start && current < end : current >= start || current < end;
  if (!inside) return null;
  const endDayOffset = start < end || current < end ? 0 : 1;
  const localEnd = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + endDayOffset,
    Math.floor(end / 60), end % 60);
  return new Date(localEnd - offset * 60000).toISOString();
}

function reasonFor(type) {
  return String(type).trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "POLICY_ALLOWED";
}

class BehaviorPolicyEngine {
  evaluate(candidate, context = {}) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("candidate 必须是对象");
    if (typeof candidate.type !== "string" || !candidate.type.trim()) throw new TypeError("candidate.type 必填");
    const priority = Number(candidate.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new TypeError("candidate.priority 必须是 1 到 5");
    const now = isoDate(context.now ?? new Date(), "context.now");
    const state = context.state;
    const relationshipContact = objectValue(context.relationship?.proactiveContact);

    const enabled = booleanValue(stateValue(state, "proactive_contact_enabled")) ?? booleanValue(relationshipContact.enabled);
    if (enabled === false) return { allowed: false, reasonCode: "CONTACT_DISABLED" };

    const quietHours = stateValue(state, "quiet_hours") ?? stateValue(state, "proactive_contact_quiet_hours") ?? relationshipContact.quietHours;
    const quietUntil = quietHoursResult(quietHours, now);
    if (quietUntil) return { allowed: false, reasonCode: "QUIET_HOURS", retryAfter: quietUntil };

    const count = nonNegativeInteger(stateValue(state, "proactive_contact_count_today"), 0);
    const dailyLimit = nonNegativeInteger(stateValue(state, "proactive_contact_daily_limit"), DEFAULT_DAILY_LIMIT);
    if (count >= dailyLimit) return { allowed: false, reasonCode: "DAILY_LIMIT" };

    const lastContactRaw = stateValue(state, "last_proactive_contact_at");
    const cooldownMinutes = nonNegativeInteger(
      stateValue(state, "proactive_contact_cooldown_minutes") ?? stateValue(state, "proactive_contact_cooldown") ?? relationshipContact.cooldown,
      DEFAULT_COOLDOWN_MINUTES
    );
    if (lastContactRaw != null && cooldownMinutes > 0) {
      const timestamp = objectValue(lastContactRaw).timestamp ?? lastContactRaw;
      const lastContact = isoDate(timestamp, "last_proactive_contact_at");
      const retryAt = new Date(lastContact.getTime() + cooldownMinutes * 60000);
      if (now < retryAt) return { allowed: false, reasonCode: "COOLDOWN", retryAfter: retryAt.toISOString() };
    }

    if (candidate.expiresAt != null && candidate.expiresAt !== "" && now >= isoDate(candidate.expiresAt, "candidate.expiresAt")) {
      return { allowed: false, reasonCode: "EXPIRED" };
    }

    const lastTopic = stateValue(state, "last_topic_key");
    const lastTopicKey = objectValue(lastTopic).topicKey ?? lastTopic;
    if (candidate.topicKey != null && candidate.topicKey !== "" && candidate.topicKey === lastTopicKey) {
      return { allowed: false, reasonCode: "DUPLICATE_TOPIC" };
    }

    return { allowed: true, action: "proactive_contact", reasonCode: reasonFor(candidate.type), priority };
  }
}

module.exports = { BehaviorPolicyEngine, DEFAULT_COOLDOWN_MINUTES, DEFAULT_DAILY_LIMIT };
