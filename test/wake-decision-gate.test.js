"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WakeDecisionGate, normalizeMode } = require("../wake-decision-gate");
const { evaluateWakeDecisionGate } = require("../wake_up");

const fullRollout = { shouldEnforce: () => ({ enabled: true, bucket: 0, percent: 100 }) };

test("default and invalid modes safely resolve to legacy", () => {
  assert.equal(normalizeMode(), "legacy");
  assert.equal(normalizeMode("invalid"), "legacy");
  assert.deepEqual(new WakeDecisionGate().decide({}), {
    mode: "legacy", shouldContact: null, source: "legacy"
  });
});

test("legacy never calls its adapter", () => {
  let calls = 0;
  const gate = new WakeDecisionGate({ mode: "legacy", adapter: { evaluate() { calls++; } } });
  gate.decide({ events: [{ id: "event-1" }] });
  assert.equal(calls, 0);
});

test("shadow calls Adapter but cannot change the legacy decision source", () => {
  let calls = 0;
  const gate = new WakeDecisionGate({
    mode: "shadow",
    adapter: { evaluate() { calls++; return { shouldContact: true, reasonCode: "INACTIVITY", candidate: { prompt: "hidden" } }; } }
  });
  assert.deepEqual(gate.decide({}), {
    mode: "shadow", shouldContact: null, shadowDecision: { shouldContact: true, reasonCode: "INACTIVITY" }
  });
  assert.equal(calls, 1);
});

test("enforced mode returns an allowed public candidate", () => {
  const gate = new WakeDecisionGate({
    mode: "enforced", rollout: fullRollout,
    adapter: { evaluate: () => ({
      shouldContact: true, reasonCode: "PROJECT_MILESTONE",
      candidate: { type: "project_milestone", eventId: "event-1", topicKey: "project:alpha", priority: 2, expiresAt: "", reasonCode: "PROJECT_MILESTONE", prompt: "hidden" }
    }) }
  });
  const result = gate.decide({});
  assert.equal(result.shouldContact, true);
  assert.equal(result.candidate.type, "project_milestone");
  assert.doesNotMatch(JSON.stringify(result), /hidden|prompt/);
});

test("enforced mode returns a policy rejection", () => {
  const result = new WakeDecisionGate({
    mode: "enforced", rollout: fullRollout, adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "QUIET_HOURS" }) }
  }).decide({});
  assert.deepEqual(result, { mode: "enforced", shouldContact: false, reasonCode: "DECISION_REJECTED" });
});

test("Adapter failures continue legacy in shadow and fail closed in enforced", () => {
  const adapter = { evaluate() { throw new Error("private adapter failure token"); } };
  assert.deepEqual(new WakeDecisionGate({ mode: "shadow", adapter }).decide({}), {
    mode: "shadow", shouldContact: null, shadowDecision: null, reasonCode: "DECISION_UNAVAILABLE"
  });
  assert.deepEqual(new WakeDecisionGate({ mode: "enforced", adapter, rollout: fullRollout }).decide({}), {
    mode: "enforced", shouldContact: false, reasonCode: "DECISION_UNAVAILABLE"
  });
});

test("Gate protects caller input from Adapter mutation", () => {
  const context = { events: [{ id: "event-1" }], state: { enabled: true }, relationship: {}, now: new Date() };
  const snapshot = structuredClone(context);
  const gate = new WakeDecisionGate({ mode: "shadow", adapter: { evaluate(received) {
    received.events[0].id = "mutated";
    received.state.enabled = false;
    return { shouldContact: false, reasonCode: "COOLDOWN" };
  } } });
  gate.decide(context);
  assert.deepEqual(context, snapshot);
});

test("mode debug logs only safe decision fields", () => {
  const logs = [];
  new WakeDecisionGate({
    mode: "enforced", debug: true, rollout: fullRollout,
    logger: { debug(message, fields) { logs.push({ message, fields }); } },
    adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "COOLDOWN", prompt: "hidden", token: "hidden" }) }
  }).decide({ memory: { content: "hidden" } });
  assert.deepEqual(logs, [{
    message: "Wake decision mode",
    fields: { mode: "enforced", shouldContact: false, reasonCode: "DECISION_REJECTED" }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /hidden|prompt|token|content|memory/i);
});

test("wake integration does not construct Adapter in explicit legacy mode", () => {
  let calls = 0;
  const gate = { decide: () => ({ mode: "legacy", shouldContact: null, source: "legacy" }) };
  const result = evaluateWakeDecisionGate({}, {
    mode: "legacy", gate,
    adapter: { evaluate() { calls++; } }
  });
  assert.equal(result.mode, "legacy");
  assert.equal(calls, 0);
});

test("Gate has no database, model, delivery, job, or persistence capability", () => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const bark = { calls: 0, send() { this.calls++; throw new Error("BARK_MUST_NOT_BE_CALLED"); } };
  const database = new Proxy({}, { get() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); } });
  new WakeDecisionGate({ mode: "legacy", model, bark, database }).decide({});
  assert.equal(model.calls, 0);
  assert.equal(bark.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-gate.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|model-adapter|event-store|state-store|structured-memory-store|ai-memory-store)["']\)|fetch\(|Bark|createJob|\.create\(|\.set\(|\.update\(|SELECT|INSERT|UPDATE|DELETE/i);
});
