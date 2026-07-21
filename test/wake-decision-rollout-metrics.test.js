"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WakeDecisionGate } = require("../wake-decision-gate");
const { WakeDecisionRolloutMetrics } = require("../wake-decision-rollout-metrics");

const empty = {
  totalEvaluated: 0,
  rolloutEnabled: 0,
  adapterAllowed: 0,
  adapterRejected: 0,
  adapterUnavailable: 0,
  legacyContinued: 0,
  decisionBlocked: 0,
  rejectionReasons: {}
};

test("record accumulates rollout, Adapter, continuation, and block outcomes", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  metrics.record({ rolloutEnabled: false, adapterOutcome: "not_evaluated", legacyContinued: true, decisionBlocked: false });
  metrics.record({ rolloutEnabled: true, adapterOutcome: "allowed", legacyContinued: true, decisionBlocked: false });
  metrics.record({ rolloutEnabled: true, adapterOutcome: "rejected", legacyContinued: false, decisionBlocked: true, reasonCode: "DECISION_REJECTED" });
  metrics.record({ rolloutEnabled: true, adapterOutcome: "unavailable", legacyContinued: false, decisionBlocked: true, reasonCode: "DECISION_UNAVAILABLE" });
  assert.deepEqual(metrics.snapshot(), {
    totalEvaluated: 4,
    rolloutEnabled: 3,
    adapterAllowed: 1,
    adapterRejected: 1,
    adapterUnavailable: 1,
    legacyContinued: 2,
    decisionBlocked: 2,
    rejectionReasons: { DECISION_REJECTED: 1, DECISION_UNAVAILABLE: 1 }
  });
});

test("snapshot cannot mutate internal Metrics state", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  metrics.record({ rolloutEnabled: true, adapterOutcome: "rejected", reasonCode: "COOLDOWN" });
  const snapshot = metrics.snapshot();
  snapshot.totalEvaluated = 999;
  snapshot.rejectionReasons.COOLDOWN = 999;
  assert.equal(metrics.snapshot().totalEvaluated, 1);
  assert.equal(metrics.snapshot().rejectionReasons.COOLDOWN, 1);
});

test("reset clears every in-memory rollout counter", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  metrics.record({ rolloutEnabled: true, adapterOutcome: "allowed", legacyContinued: true });
  metrics.reset();
  assert.deepEqual(metrics.snapshot(), empty);
});

test("invalid input and outcomes are ignored", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  for (const value of [null, undefined, "bad", {}, [], { rolloutEnabled: "yes" }, { rolloutEnabled: true, adapterOutcome: "bad" }]) {
    assert.doesNotThrow(() => assert.equal(metrics.record(value), false));
  }
  assert.deepEqual(metrics.snapshot(), empty);
});

test("reasonCode uses a strict whitelist format", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  metrics.record({ rolloutEnabled: true, adapterOutcome: "rejected", reasonCode: "QUIET_HOURS" });
  metrics.record({ rolloutEnabled: true, adapterOutcome: "rejected", reasonCode: "QUIET_HOURS" });
  metrics.record({ rolloutEnabled: true, adapterOutcome: "rejected", reasonCode: "private prompt token" });
  assert.deepEqual(metrics.snapshot().rejectionReasons, { QUIET_HOURS: 2 });
});

test("Gate records enforced rollout outcomes and exposes snapshots only", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  const rolloutOff = new WakeDecisionGate({
    mode: "enforced", rolloutMetrics: metrics,
    rollout: { shouldEnforce: () => ({ enabled: false, bucket: 50, percent: 10 }) }
  });
  assert.equal(rolloutOff.decide({}).shouldContact, null);
  const allowed = new WakeDecisionGate({
    mode: "enforced", rolloutMetrics: metrics,
    rollout: { shouldEnforce: () => ({ enabled: true, bucket: 1, percent: 10 }) },
    adapter: { evaluate: () => ({ shouldContact: true, candidate: {} }) }
  });
  assert.equal(allowed.decide({}).shouldContact, true);
  const rejected = new WakeDecisionGate({
    mode: "enforced", rolloutMetrics: metrics,
    rollout: { shouldEnforce: () => ({ enabled: true, bucket: 2, percent: 10 }) },
    adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "COOLDOWN" }) }
  });
  assert.equal(rejected.decide({}).shouldContact, false);
  assert.deepEqual(rejected.getRolloutMetrics(), {
    totalEvaluated: 3, rolloutEnabled: 2, adapterAllowed: 1, adapterRejected: 1,
    adapterUnavailable: 0, legacyContinued: 2, decisionBlocked: 1,
    rejectionReasons: { DECISION_REJECTED: 1 }
  });
  assert.equal(rejected.mode, "enforced");
});

test("Adapter unavailability is monitored without changing fail-closed behavior", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  const gate = new WakeDecisionGate({
    mode: "enforced", rolloutMetrics: metrics,
    rollout: { shouldEnforce: () => ({ enabled: true, bucket: 0, percent: 100 }) },
    adapter: { evaluate() { throw new Error("unavailable"); } }
  });
  assert.deepEqual(gate.decide({}), { mode: "enforced", shouldContact: false, reasonCode: "DECISION_UNAVAILABLE" });
  assert.equal(gate.getRolloutMetrics().adapterUnavailable, 1);
  assert.equal(gate.getRolloutMetrics().decisionBlocked, 1);
});

test("Metrics failure is isolated from Gate decisions", () => {
  const gate = new WakeDecisionGate({
    mode: "enforced",
    rollout: { shouldEnforce: () => ({ enabled: true, bucket: 0, percent: 100 }) },
    rolloutMetrics: { record() { throw new Error("METRICS_FAILURE"); } },
    adapter: { evaluate: () => ({ shouldContact: true, candidate: {} }) }
  });
  assert.equal(gate.decide({}).shouldContact, true);
});

test("rollout Metrics debug contains aggregate counters only", () => {
  const logs = [];
  const gate = new WakeDecisionGate({
    mode: "enforced", rolloutMetricsDebug: true,
    logger: { debug(message, fields) { logs.push({ message, fields }); } },
    rollout: { shouldEnforce: () => ({ enabled: true, bucket: 1, percent: 10 }) },
    adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "COOLDOWN", prompt: "hidden" }) }
  });
  gate.decide({ userId: "private", memory: { content: "hidden" } });
  assert.deepEqual(logs, [{
    message: "Wake decision rollout metrics",
    fields: { totalEvaluated: 1, rolloutEnabled: 1, adapterRejected: 1, adapterUnavailable: 0 }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /private|memory|content|prompt|candidate|token|userId/i);
});

test("legacy and shadow modes do not alter rollout Metrics or mode", () => {
  const metrics = new WakeDecisionRolloutMetrics();
  const legacy = new WakeDecisionGate({ mode: "legacy", rolloutMetrics: metrics });
  const shadow = new WakeDecisionGate({
    mode: "shadow", rolloutMetrics: metrics,
    adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "COOLDOWN" }) }
  });
  legacy.decide({});
  shadow.decide({});
  assert.deepEqual(metrics.snapshot(), empty);
  assert.equal(legacy.mode, "legacy");
  assert.equal(shadow.mode, "shadow");
});

test("Rollout Metrics is memory-only with no model, database, file, or network dependency", () => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  new WakeDecisionRolloutMetrics({ model }).record({ rolloutEnabled: false });
  assert.equal(model.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-rollout-metrics.js"), "utf8");
  assert.doesNotMatch(source, /require\(|fetch\(|sqlite|redis|SELECT|INSERT|UPDATE|DELETE|(?:read|write)File|model|Bark/i);
});
