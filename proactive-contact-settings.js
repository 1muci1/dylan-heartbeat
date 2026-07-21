"use strict";

const ENABLED_KEY = "proactive_contact.enabled";
const QUIET_HOURS_KEY = "proactive_contact.quiet_hours";
const SCOPE_TYPE = "companion";
const SCOPE_ID = "default";
const UPDATE_FIELDS = new Set(["enabled", "quietHours"]);

class ProactiveContactSettingsError extends Error {
  constructor(message, statusCode = 400, code = "PROACTIVE_SETTINGS_INVALID") {
    super(message);
    this.name = "ProactiveContactSettingsError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function validTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateQuietHours(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProactiveContactSettingsError("quietHours 格式无效");
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("start") || !keys.includes("end") ||
      !validTime(value.start) || !validTime(value.end)) {
    throw new ProactiveContactSettingsError("quietHours 必须包含有效的 start 和 end");
  }
  return { start: value.start, end: value.end };
}

class ProactiveContactSettings {
  constructor({ stateStore, eventStore } = {}) {
    if (!stateStore || typeof stateStore.get !== "function" || typeof stateStore.set !== "function") {
      throw new TypeError("stateStore 必填");
    }
    if (!eventStore || typeof eventStore.create !== "function") throw new TypeError("eventStore 必填");
    this.stateStore = stateStore;
    this.eventStore = eventStore;
  }

  getSettings() {
    const enabled = this.stateStore.get(SCOPE_TYPE, SCOPE_ID, ENABLED_KEY);
    const quietHours = this.stateStore.get(SCOPE_TYPE, SCOPE_ID, QUIET_HOURS_KEY);
    return {
      enabled: enabled ? enabled.value : true,
      quietHours: quietHours ? quietHours.value : { start: "23:00", end: "08:00" }
    };
  }

  updateSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ProactiveContactSettingsError("设置格式无效");
    }
    const keys = Object.keys(input);
    const unknown = keys.find(key => !UPDATE_FIELDS.has(key));
    if (unknown) throw new ProactiveContactSettingsError(`不允许修改字段：${unknown}`);
    if (keys.length === 0) throw new ProactiveContactSettingsError("至少提供一项设置");
    const changes = [];
    if (Object.hasOwn(input, "enabled")) {
      if (typeof input.enabled !== "boolean") throw new ProactiveContactSettingsError("enabled 必须是 boolean");
      changes.push([ENABLED_KEY, input.enabled]);
    }
    if (Object.hasOwn(input, "quietHours")) changes.push([QUIET_HOURS_KEY, validateQuietHours(input.quietHours)]);

    for (const [key, value] of changes) {
      this.stateStore.set({ scopeType: SCOPE_TYPE, scopeId: SCOPE_ID, stateKey: key, value, sourceKind: "user", confidence: 1 });
      this.eventStore.create({
        eventType: "preference.changed",
        subjectType: SCOPE_TYPE,
        subjectId: SCOPE_ID,
        payload: { key }
      }, { source: "proactive-settings-api" });
    }
    return this.getSettings();
  }
}

module.exports = { ENABLED_KEY, QUIET_HOURS_KEY, ProactiveContactSettings, ProactiveContactSettingsError, validateQuietHours };
