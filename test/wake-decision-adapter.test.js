"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { BehaviorPolicyEngine } = require("../behavior-policy");
const { ProactiveCandidateGenerator } = require("../proactive-candidate-generator");
const { ProactiveDecisionService } = require("../proactive-decision-service");
const { WakeDecisionAdapter } = require("../wake-decision-adapter");

const NOW = "2026-07-18T12:00:00.000Z";
const candidate = {
  type: "project_milestone", eventId: "event-1", topicKey: "project:alpha", priority: 2,
  expiresAt: "", reasonCode: "PROJECT_MILESTONE"
};

test("approved candidate maps to shouldContact=true", () => {
  const decision = { allowed: true, action: "proactive_contact", reasonCode: "PROJECT_MILESTONE", priority: 2 };
  const adapter = new WakeDecisionAdapter({
    decisionService: { evaluate: () => ({ candidates: [candidate], approved: [{ candidate, decision }], rejected: [] }) }
  });
  assert.deepEqual(adapter.evaluate({ events: [], state: {}, relationship: {}, now: NOW }), {
    shouldContact: true, reasonCode: "PROJECT_MILESTONE", candidate, decision
  });
});

test("policy rejection maps to shouldContact=false and preserves its reason", () => {
  const adapter = new WakeDecisionAdapter({
    decisionService: { evaluate: () => ({ candidates: [candidate], approved: [], rejected: [{ candidate, reasonCode: "QUIET_HOURS" }] }) }
  });
  assert.deepEqual(adapter.evaluate({ events: [], state: {}, relationship: {}, now: NOW }), {
    shouldContact: false, reasonCode: "QUIET_HOURS", candidate: null, decision: null
  });
});

test("no candidate maps to the stable empty rejection shape", () => {
  const adapter = new WakeDecisionAdapter({
    decisionService: { evaluate: () => ({ candidates: [], approved: [], rejected: [] }) }
  });
  assert.deepEqual(adapter.evaluate({ events: [], state: {}, relationship: {}, now: NOW }), {
    shouldContact: false, reasonCode: "", candidate: null, decision: null
  });
});

test("adapter protects its input from a mutating decision service", () => {
  const input = {
    events: [{ id: "event-1" }], state: { enabled: true },
    relationship: { proactiveContact: { enabled: true } }, now: new Date(NOW)
  };
  const snapshot = structuredClone(input);
  const adapter = new WakeDecisionAdapter({ decisionService: { evaluate(context) {
    context.events[0].id = "mutated";
    context.state.enabled = false;
    return { candidates: [], approved: [], rejected: [] };
  } } });
  adapter.evaluate(input);
  assert.deepEqual(input, snapshot);
});

test("adapter does not access database, call a model, persist events/state, or deliver Bark", () => {
  const database = new Proxy({}, { get() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); } });
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const bark = { calls: 0, send() { this.calls++; throw new Error("BARK_MUST_NOT_BE_CALLED"); } };
  const adapter = new WakeDecisionAdapter({
    decisionService: { evaluate: () => ({ candidates: [], approved: [], rejected: [] }) }, database, model, bark
  });
  assert.equal(adapter.evaluate({}).shouldContact, false);
  assert.equal(model.calls, 0);
  assert.equal(bark.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-adapter.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|model-adapter|event-store|state-store|ai-memory-store|wake_up)["']\)/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|fetch\(|Bark|createJob|\.create\(/i);
});

test("real Generator + Policy + DecisionService chain remains a pure adapter call", () => {
  const decisionService = new ProactiveDecisionService({
    candidateGenerator: new ProactiveCandidateGenerator(), policyEngine: new BehaviorPolicyEngine()
  });
  const adapter = new WakeDecisionAdapter({ decisionService });
  const result = adapter.evaluate({
    events: [{
      id: "event-1", eventType: "project.milestone_reached", subjectType: "project", subjectId: "alpha",
      payload: {}, importance: 3, occurredAt: "2026-07-18T11:00:00Z", expiresAt: null
    }],
    state: { proactive_contact_enabled: true }, relationship: {}, now: NOW
  });
  assert.equal(result.shouldContact, true);
  assert.equal(result.candidate.type, "project_milestone");
  assert.equal(result.decision.action, "proactive_contact");
});
