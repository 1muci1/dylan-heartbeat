"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ProactiveSendGate } = require("../proactive-send-gate");

const NOW = "2026-07-18T12:00:00.000Z";
const response = overrides => ({ action: "proactive_contact", text: "项目完成了，要一起看看下一步吗？", reasonCode: "PROJECT_MILESTONE", ...overrides });
const candidate = overrides => ({ eventId: "event-1", topicKey: "project:alpha", expiresAt: "2026-07-18T14:00:00.000Z", ...overrides });

test("valid response produces a delivery preparation object without sending", () => {
  const gate = new ProactiveSendGate();
  assert.deepEqual(gate.evaluate({ response: response(), candidate: candidate({ relatedEventIds: ["event-2", "event-1"] }), state: {}, now: NOW }), {
    allowed: true,
    reasonCode: "SEND_ALLOWED",
    delivery: {
      channel: "push",
      text: "项目完成了，要一起看看下一步吗？",
      reasonCode: "PROJECT_MILESTONE",
      relatedEventIds: ["event-1", "event-2"]
    }
  });
});

test("fixed validation order rejects no_action and invalid text first", () => {
  const gate = new ProactiveSendGate();
  assert.deepEqual(gate.evaluate({ response: response({ action: "no_action", text: "" }), state: { proactive_contact_enabled: false }, now: NOW }),
    { allowed: false, reasonCode: "NO_CONTACT_ACTION" });
  for (const text of ["", "   ", "x".repeat(501), null]) {
    assert.deepEqual(gate.evaluate({ response: response({ text }), state: { proactive_contact_enabled: false }, now: NOW }),
      { allowed: false, reasonCode: "INVALID_TEXT" });
  }
});

test("kill switch rejects before all later policy checks", () => {
  const result = new ProactiveSendGate().evaluate({ response: response(), candidate: candidate({ expiresAt: NOW }),
    state: { proactiveContact: { enabled: false }, quietHours: { start: "00:00", end: "23:59" } }, now: NOW });
  assert.deepEqual(result, { allowed: false, reasonCode: "CONTACT_DISABLED" });
});

test("quiet hours support overnight windows", () => {
  const result = new ProactiveSendGate().evaluate({ response: response(), candidate: candidate(),
    state: { quietHours: { start: "22:00", end: "08:00", timezoneOffsetMinutes: 0 } }, now: "2026-07-18T23:00:00Z" });
  assert.deepEqual(result, { allowed: false, reasonCode: "QUIET_HOURS" });
});

test("daily budget rejects at the configured limit", () => {
  const result = new ProactiveSendGate().evaluate({ response: response(), candidate: candidate(),
    state: { proactive_contact_count_today: 2, proactive_contact_daily_limit: 2 }, now: NOW });
  assert.deepEqual(result, { allowed: false, reasonCode: "DAILY_LIMIT" });
});

test("cooldown reads last_companion_contact_at", () => {
  const result = new ProactiveSendGate().evaluate({ response: response(), candidate: candidate(), state: {
    last_companion_contact_at: { timestamp: "2026-07-18T11:30:00Z" }, proactive_contact_cooldown_minutes: 60
  }, now: NOW });
  assert.deepEqual(result, { allowed: false, reasonCode: "COOLDOWN" });
});

test("expired candidates are rejected", () => {
  assert.deepEqual(new ProactiveSendGate().evaluate({ response: response(), candidate: candidate({ expiresAt: NOW }), state: {}, now: NOW }),
    { allowed: false, reasonCode: "EXPIRED" });
});

test("duplicate topic or reasonCode is rejected", () => {
  const gate = new ProactiveSendGate();
  assert.deepEqual(gate.evaluate({ response: response(), candidate: candidate(), state: { last_topic_key: "project:alpha" }, now: NOW }),
    { allowed: false, reasonCode: "DUPLICATE_TOPIC" });
  assert.deepEqual(gate.evaluate({ response: response(), candidate: candidate(), state: { last_reason_code: "PROJECT_MILESTONE" }, now: NOW }),
    { allowed: false, reasonCode: "DUPLICATE_TOPIC" });
});

test("gate is immutable and has no model, database, State, Memory, or Bark dependency", () => {
  const input = { response: response(), candidate: candidate(), state: { familiarity: 99, memoryCount: 100 }, now: new Date(NOW) };
  const before = structuredClone(input);
  const gate = new ProactiveSendGate({
    model: { generate() { throw new Error("MODEL_MUST_NOT_RUN"); } },
    database: new Proxy({}, { get() { throw new Error("DATABASE_MUST_NOT_RUN"); } })
  });
  assert.equal(gate.evaluate(input).allowed, true);
  assert.deepEqual(input, before);
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-send-gate.js"), "utf8");
  assert.doesNotMatch(source, /require\(|fetch\(|Bark|model|memoryStore|stateStore|eventStore|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b/i);
});
