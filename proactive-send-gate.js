"use strict";

const DEFAULT_DAILY_LIMIT = 3;
const DEFAULT_COOLDOWN_MINUTES = 60;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stateValue(state, key) {
  if (Array.isArray(state)) return state.find(item => item?.stateKey === key)?.value;
  if (!plainObject(state)) return undefined;
  const raw = state[key];
  return plainObject(raw) && raw.stateKey === key && Object.hasOwn(raw, "value") ? raw.value : raw;
}

function countValue(value, fallback) {
  const raw = plainObject(value) ? value.count ?? value.limit ?? value.minutes : value;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function dateValue(value) {
  const raw = value instanceof Date ? value : plainObject(value) ? value.timestamp ?? value.value : value;
  const date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesOfDay(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function inQuietHours(value, now) {
  if (!plainObject(value)) return false;
  const start = minutesOfDay(value.start), end = minutesOfDay(value.end);
  if (start === null || end === null || start === end) return false;
  const offset = Number.isInteger(value.timezoneOffsetMinutes) && Math.abs(value.timezoneOffsetMinutes) <= 840
    ? value.timezoneOffsetMinutes : 0;
  const local = new Date(now.getTime() + offset * 60000);
  const current = local.getUTCHours() * 60 + local.getUTCMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function relatedEventIds(candidate) {
  const values = [candidate?.eventId, ...(Array.isArray(candidate?.relatedEventIds) ? candidate.relatedEventIds : [])];
  return [...new Set(values.filter(value => typeof value === "string" && value.trim()).map(value => value.trim().slice(0, 200)))].slice(0, 10);
}

class ProactiveSendGate {
  evaluate({ response, candidate, state, now } = {}) {
    const safeResponse = plainObject(response) ? response : {};
    const safeCandidate = plainObject(candidate) ? candidate : {};
    const current = dateValue(now ?? new Date());
    if (!current) throw new TypeError("now 必须是有效时间");

    if (safeResponse.action !== "proactive_contact") return { allowed: false, reasonCode: "NO_CONTACT_ACTION" };
    if (typeof safeResponse.text !== "string" || !safeResponse.text.trim() || safeResponse.text.length > 500) {
      return { allowed: false, reasonCode: "INVALID_TEXT" };
    }

    const contact = plainObject(stateValue(state, "proactiveContact")) ? stateValue(state, "proactiveContact") : {};
    const enabled = typeof contact.enabled === "boolean" ? contact.enabled
      : stateValue(state, "proactive_contact.enabled") ?? stateValue(state, "proactive_contact_enabled");
    if (enabled === false) return { allowed: false, reasonCode: "CONTACT_DISABLED" };

    const quietHours = stateValue(state, "proactive_contact.quiet_hours") ?? stateValue(state, "quietHours") ?? stateValue(state, "quiet_hours")
      ?? stateValue(state, "proactive_contact_quiet_hours") ?? contact.quietHours;
    if (inQuietHours(quietHours, current)) return { allowed: false, reasonCode: "QUIET_HOURS" };

    const count = countValue(stateValue(state, "proactive_contact_count_today"), 0);
    const limit = countValue(stateValue(state, "proactive_contact_daily_limit"), DEFAULT_DAILY_LIMIT);
    if (count >= limit) return { allowed: false, reasonCode: "DAILY_LIMIT" };

    const lastContact = dateValue(stateValue(state, "last_companion_contact_at"));
    const cooldown = countValue(stateValue(state, "proactive_contact_cooldown_minutes") ?? contact.cooldownMinutes, DEFAULT_COOLDOWN_MINUTES);
    if (lastContact && cooldown > 0 && current < new Date(lastContact.getTime() + cooldown * 60000)) {
      return { allowed: false, reasonCode: "COOLDOWN" };
    }

    const expiresAt = safeCandidate.expiresAt == null || safeCandidate.expiresAt === "" ? null : dateValue(safeCandidate.expiresAt);
    if (expiresAt && current >= expiresAt) return { allowed: false, reasonCode: "EXPIRED" };

    const lastTopicRaw = stateValue(state, "last_topic_key");
    const lastTopic = plainObject(lastTopicRaw) ? lastTopicRaw.topicKey : lastTopicRaw;
    const lastReasonRaw = stateValue(state, "last_reason_code") ?? stateValue(state, "last_proactive_reason_code");
    const lastReason = plainObject(lastReasonRaw) ? lastReasonRaw.reasonCode : lastReasonRaw;
    if ((safeCandidate.topicKey && safeCandidate.topicKey === lastTopic)
      || (safeResponse.reasonCode && safeResponse.reasonCode === lastReason)) {
      return { allowed: false, reasonCode: "DUPLICATE_TOPIC" };
    }

    return {
      allowed: true,
      reasonCode: "SEND_ALLOWED",
      delivery: {
        channel: "push",
        text: safeResponse.text,
        reasonCode: safeResponse.reasonCode,
        relatedEventIds: relatedEventIds(safeCandidate)
      }
    };
  }
}

module.exports = { DEFAULT_COOLDOWN_MINUTES, DEFAULT_DAILY_LIMIT, ProactiveSendGate };
