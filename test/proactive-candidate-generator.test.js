"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { BehaviorPolicyEngine } = require("../behavior-policy");
const { ProactiveCandidateGenerator } = require("../proactive-candidate-generator");

const NOW = "2026-07-18T12:00:00.000Z";
const event = overrides => ({
  id: "event-1", eventType: "project.milestone_reached", subjectType: "project", subjectId: "alpha",
  payload: {}, importance: 3, occurredAt: "2026-07-18T10:00:00Z", expiresAt: null, ...overrides
});

test("project milestone produces a message-free candidate", () => {
  const result = new ProactiveCandidateGenerator().generate({ events: [event()], state: {}, relationship: {}, now: NOW });
  assert.deepEqual(result, [{
    type: "project_milestone", eventId: "event-1", topicKey: "project:alpha", priority: 2,
    expiresAt: "", reasonCode: "PROJECT_MILESTONE"
  }]);
  assert.doesNotMatch(JSON.stringify(result), /message|prompt|content/);
});

test("only high-importance memory.created events produce candidates", () => {
  const high = event({ id: "memory-high-event", eventType: "memory.created", subjectId: "memory-high", payload: { importance: 4, content: "hidden" } });
  const normal = event({ id: "memory-normal-event", eventType: "memory.created", subjectId: "memory-normal", payload: { importance: 3, content: "hidden" } });
  const result = new ProactiveCandidateGenerator().generate({ events: [high, normal], state: {}, now: NOW });
  assert.deepEqual(result, [{
    type: "important_memory", eventId: "memory-high-event", topicKey: "memory:memory-high", priority: 3,
    expiresAt: "", reasonCode: "IMPORTANT_MEMORY"
  }]);
  assert.doesNotMatch(JSON.stringify(result), /hidden|content/);
});

test("pending follow-up and deterministic inactivity state produce candidates", () => {
  const state = [
    { stateKey: "pending_follow_up", value: { topicKey: "project:follow-up", prompt: "hidden" }, sourceEventId: "follow-up-event" },
    { stateKey: "last_user_interaction_at", value: { timestamp: "2026-07-10T12:00:00Z", content: "hidden" }, sourceEventId: "interaction-event" }
  ];
  const result = new ProactiveCandidateGenerator().generate({ events: [], state, relationship: {}, now: NOW });
  assert.deepEqual(result, [
    { type: "follow_up", eventId: "follow-up-event", topicKey: "project:follow-up", priority: 2, expiresAt: "", reasonCode: "FOLLOW_UP" },
    { type: "inactivity_check", eventId: "interaction-event", topicKey: "inactivity:2026-07-10T12:00:00.000Z", priority: 4, expiresAt: "2026-07-19T12:00:00.000Z", reasonCode: "INACTIVITY" }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /hidden|prompt|content/);
});

test("duplicate event IDs are emitted once", () => {
  const duplicate = event();
  const result = new ProactiveCandidateGenerator().generate({ events: [duplicate, structuredClone(duplicate)], state: {}, now: NOW });
  assert.equal(result.length, 1);
});

test("same topic keeps the numerically highest priority candidate", () => {
  const events = [
    event({ id: "project-event", subjectId: "shared" }),
    event({ id: "memory-event", eventType: "memory.created", subjectId: "shared", payload: { importance: 5 } })
  ];
  const state = [{ stateKey: "pending_follow_up", value: { topicKey: "memory:shared" }, sourceEventId: "follow-event" }];
  const result = new ProactiveCandidateGenerator().generate({ events, state, now: NOW });
  assert.equal(result.filter(item => item.topicKey === "memory:shared").length, 1);
  assert.equal(result.find(item => item.topicKey === "memory:shared").priority, 3);
});

test("generation is pure and does not access database or model", () => {
  const context = { events: [event({ payload: { prompt: "hidden", content: "hidden" } })], state: {}, relationship: { familiarity: { level: 3 } }, now: new Date(NOW) };
  const snapshot = structuredClone(context);
  const database = new Proxy({}, { get() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); } });
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const generator = new ProactiveCandidateGenerator({ database, model });
  assert.equal(generator.generate(context).length, 1);
  assert.deepEqual(context, snapshot);
  assert.equal(model.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-candidate-generator.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|model-adapter|event-store|state-store)["']\)/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});

test("EventStore-shaped data flows through Generator and BehaviorPolicy without integration side effects", () => {
  const generator = new ProactiveCandidateGenerator();
  const policy = new BehaviorPolicyEngine();
  const candidates = generator.generate({ events: [event()], state: { proactive_contact_enabled: true }, now: NOW });
  assert.deepEqual(policy.evaluate(candidates[0], { state: { proactive_contact_enabled: true }, relationship: {}, now: NOW }), {
    allowed: true, action: "proactive_contact", reasonCode: "PROJECT_MILESTONE", priority: 2
  });
});
