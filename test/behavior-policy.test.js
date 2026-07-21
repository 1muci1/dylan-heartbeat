"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { BehaviorPolicyEngine } = require("../behavior-policy");

const NOW = "2026-07-18T12:00:00.000Z";
const candidate = overrides => ({
  type: "project.milestone", priority: 2, eventId: "event-1", topicKey: "project-alpha",
  expiresAt: "2026-07-18T14:00:00.000Z", ...overrides
});

test("normal candidate is allowed with a deterministic action", () => {
  const result = new BehaviorPolicyEngine().evaluate(candidate(), {
    state: { proactive_contact_enabled: true }, relationship: { familiarity: { level: 3 } }, now: NOW
  });
  assert.deepEqual(result, { allowed: true, action: "proactive_contact", reasonCode: "PROJECT_MILESTONE", priority: 2 });
});

test("kill switch rejects contact", () => {
  const result = new BehaviorPolicyEngine().evaluate(candidate(), { state: { proactive_contact_enabled: false }, now: NOW });
  assert.deepEqual(result, { allowed: false, reasonCode: "CONTACT_DISABLED" });
});

test("quiet hours reject with the next safe time, including overnight windows", () => {
  const result = new BehaviorPolicyEngine().evaluate(candidate(), {
    state: { quiet_hours: { start: "22:00", end: "08:00", timezoneOffsetMinutes: 0 } }, now: "2026-07-18T23:30:00Z"
  });
  assert.deepEqual(result, { allowed: false, reasonCode: "QUIET_HOURS", retryAfter: "2026-07-19T08:00:00.000Z" });
});

test("daily budget rejects when its configured limit is reached", () => {
  const result = new BehaviorPolicyEngine().evaluate(candidate(), {
    state: { proactive_contact_count_today: 2, proactive_contact_daily_limit: 2 }, now: NOW
  });
  assert.deepEqual(result, { allowed: false, reasonCode: "DAILY_LIMIT" });
});

test("cooldown rejects until its deterministic retry time", () => {
  const result = new BehaviorPolicyEngine().evaluate(candidate(), {
    state: { last_proactive_contact_at: { timestamp: "2026-07-18T11:30:00Z" }, proactive_contact_cooldown_minutes: 60 }, now: NOW
  });
  assert.deepEqual(result, { allowed: false, reasonCode: "COOLDOWN", retryAfter: "2026-07-18T12:30:00.000Z" });
});

test("expired candidate is rejected", () => {
  const result = new BehaviorPolicyEngine().evaluate(candidate({ expiresAt: NOW }), { state: {}, now: NOW });
  assert.deepEqual(result, { allowed: false, reasonCode: "EXPIRED" });
});

test("duplicate topic is rejected", () => {
  const result = new BehaviorPolicyEngine().evaluate(candidate(), { state: { last_topic_key: { topicKey: "project-alpha" } }, now: NOW });
  assert.deepEqual(result, { allowed: false, reasonCode: "DUPLICATE_TOPIC" });
});

test("evaluation does not mutate inputs, access a database, or call a model", () => {
  const input = candidate();
  const context = {
    state: [{ stateKey: "proactive_contact_enabled", value: true }],
    relationship: { proactiveContact: { enabled: true }, familiarity: { level: 99 }, importantMemoryIds: ["memory-1"] },
    now: new Date(NOW)
  };
  const snapshot = structuredClone({ input, context });
  const database = new Proxy({}, { get() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); } });
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const engine = new BehaviorPolicyEngine({ database, model });
  assert.equal(engine.evaluate(input, context).allowed, true);
  assert.deepEqual({ input, context }, snapshot);
  assert.equal(model.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "behavior-policy.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|model-adapter|event-store|state-store|relationship-view)["']\)/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});
