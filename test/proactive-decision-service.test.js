"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { BehaviorPolicyEngine } = require("../behavior-policy");
const { ProactiveCandidateGenerator } = require("../proactive-candidate-generator");
const { ProactiveDecisionService } = require("../proactive-decision-service");

const NOW = "2026-07-18T12:00:00.000Z";
const candidate = (type, priority) => ({
  type, priority, eventId: `event-${type}`, topicKey: `topic:${type}`, expiresAt: "", reasonCode: type.toUpperCase()
});

test("multiple allowed candidates are sorted and limited to the highest priority", () => {
  const generated = [candidate("low", 1), candidate("high", 4), candidate("middle", 2)];
  const service = new ProactiveDecisionService({
    candidateGenerator: { generate: () => generated },
    policyEngine: { evaluate: item => ({ allowed: true, action: "proactive_contact", reasonCode: item.reasonCode, priority: item.priority }) }
  });
  const result = service.evaluate({ events: [], state: {}, relationship: {}, now: NOW });
  assert.deepEqual(result.candidates.map(item => item.priority), [4, 2, 1]);
  assert.equal(result.approved.length, 1);
  assert.equal(result.approved[0].candidate.type, "high");
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(generated.map(item => item.priority), [1, 4, 2]);
});

test("policy decisions are classified into approved and rejected", () => {
  const service = new ProactiveDecisionService({
    candidateGenerator: { generate: () => [candidate("blocked", 5), candidate("allowed", 3)] },
    policyEngine: { evaluate: item => item.type === "blocked"
      ? { allowed: false, reasonCode: "QUIET_HOURS", retryAfter: "2026-07-18T13:00:00Z" }
      : { allowed: true, action: "proactive_contact", reasonCode: "ALLOWED", priority: item.priority } }
  });
  const result = service.evaluate({ state: {}, relationship: {}, now: NOW });
  assert.equal(result.approved.length, 1);
  assert.equal(result.approved[0].candidate.type, "allowed");
  assert.deepEqual(result.rejected, [{ candidate: candidate("blocked", 5), reasonCode: "QUIET_HOURS" }]);
});

test("service protects caller inputs and generated candidates from dependency mutation", () => {
  const context = { events: [{ id: "event-1" }], state: { enabled: true }, relationship: { familiarity: { level: 1 } }, now: new Date(NOW) };
  const inputCandidate = candidate("safe", 2);
  const contextSnapshot = structuredClone(context);
  const candidateSnapshot = structuredClone(inputCandidate);
  const service = new ProactiveDecisionService({
    candidateGenerator: { generate(received) { received.state.enabled = false; return [inputCandidate]; } },
    policyEngine: { evaluate(received, receivedContext) {
      received.topicKey = "mutated";
      receivedContext.relationship.familiarity.level = 99;
      return { allowed: true, action: "proactive_contact", reasonCode: "SAFE", priority: received.priority };
    } }
  });
  const result = service.evaluate(context);
  assert.deepEqual(context, contextSnapshot);
  assert.deepEqual(inputCandidate, candidateSnapshot);
  assert.equal(result.approved[0].candidate.topicKey, "topic:safe");
});

test("service has no database, model, delivery, or persistence dependency", () => {
  const database = new Proxy({}, { get() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); } });
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const bark = { calls: 0, send() { this.calls++; throw new Error("BARK_MUST_NOT_BE_CALLED"); } };
  const service = new ProactiveDecisionService({
    candidateGenerator: { generate: () => [candidate("safe", 2)] },
    policyEngine: { evaluate: item => ({ allowed: true, action: "proactive_contact", reasonCode: "SAFE", priority: item.priority }) },
    database, model, bark
  });
  assert.equal(service.evaluate({ state: {}, relationship: {}, now: NOW }).approved.length, 1);
  assert.equal(model.calls, 0);
  assert.equal(bark.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-decision-service.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|model-adapter|event-store|state-store|ai-memory-store)["']\)/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|fetch\(|Bark/i);
});

test("Event-shaped input integrates through Generator, Policy, and DecisionService only", () => {
  const service = new ProactiveDecisionService({
    candidateGenerator: new ProactiveCandidateGenerator(),
    policyEngine: new BehaviorPolicyEngine()
  });
  const context = {
    events: [{
      id: "milestone-event", eventType: "project.milestone_reached", subjectType: "project", subjectId: "alpha",
      payload: { prompt: "must-not-output" }, importance: 3, occurredAt: "2026-07-18T11:00:00Z", expiresAt: null
    }],
    state: { proactive_contact_enabled: true },
    relationship: { familiarity: { level: 3 } },
    now: NOW
  };
  const result = service.evaluate(context);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.approved.length, 1);
  assert.equal(result.approved[0].decision.reasonCode, "PROJECT_MILESTONE");
  assert.deepEqual(result.rejected, []);
  assert.doesNotMatch(JSON.stringify(result), /must-not-output|prompt/);
});
