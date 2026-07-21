"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WakeDecisionDashboardView } = require("../wake-decision-dashboard-view");
const { WakeDecisionGate } = require("../wake-decision-gate");
const { WakeDecisionMetrics } = require("../wake-decision-metrics");
const { WakeDecisionRollout } = require("../wake-decision-rollout");
const { WakeDecisionRolloutMetrics } = require("../wake-decision-rollout-metrics");

const emptyEnforced = {
  totalEvaluated: 0, rolloutEnabled: 0, adapterAllowed: 0, adapterRejected: 0,
  adapterUnavailable: 0, legacyContinued: 0, decisionBlocked: 0, rejectionReasons: {}
};

test("empty Metrics produce a safe legacy Dashboard snapshot", () => {
  const gate = new WakeDecisionGate({ mode: "legacy" });
  assert.deepEqual(gate.getDashboardSnapshot(), {
    mode: "legacy",
    rollout: { percent: 0, enabled: false },
    shadow: {
      total: 0, agreementRate: 0, eligible: false,
      reasonCodes: ["INSUFFICIENT_SAMPLE", "LOW_AGREEMENT"]
    },
    enforced: emptyEnforced
  });
});

test("View correctly aggregates Shadow evaluation and rollout Metrics", () => {
  const shadowMetrics = new WakeDecisionMetrics();
  for (let index = 0; index < 95; index++) shadowMetrics.record({ differenceType: "same", newDecision: { reasonCode: "" } });
  for (let index = 0; index < 3; index++) shadowMetrics.record({ differenceType: "old_only", newDecision: { reasonCode: "COOLDOWN" } });
  for (let index = 0; index < 2; index++) shadowMetrics.record({ differenceType: "new_only", newDecision: { reasonCode: "INACTIVITY" } });
  const rolloutMetrics = new WakeDecisionRolloutMetrics();
  rolloutMetrics.record({ rolloutEnabled: false, adapterOutcome: "not_evaluated", legacyContinued: true });
  rolloutMetrics.record({ rolloutEnabled: true, adapterOutcome: "allowed", legacyContinued: true });
  rolloutMetrics.record({ rolloutEnabled: true, adapterOutcome: "rejected", decisionBlocked: true, reasonCode: "DECISION_REJECTED" });
  const rollout = new WakeDecisionRollout({ percent: 10 });
  const gate = new WakeDecisionGate({ mode: "enforced", metrics: shadowMetrics, rolloutMetrics, rollout });
  const snapshot = new WakeDecisionDashboardView({ gate, rollout }).getSnapshot();
  assert.deepEqual(snapshot, {
    mode: "enforced",
    rollout: { percent: 10, enabled: true },
    shadow: { total: 100, agreementRate: 0.95, eligible: true, reasonCodes: [] },
    enforced: {
      totalEvaluated: 3, rolloutEnabled: 2, adapterAllowed: 1, adapterRejected: 1,
      adapterUnavailable: 0, legacyContinued: 2, decisionBlocked: 1,
      rejectionReasons: { DECISION_REJECTED: 1 }
    }
  });
});

test("mode and rollout enabled state are read without running rollout", () => {
  let rolloutCalls = 0;
  const rollout = { percent: 25, shouldEnforce() { rolloutCalls++; throw new Error("MUST_NOT_BUCKET"); } };
  const gate = new WakeDecisionGate({ mode: "shadow", rollout });
  const snapshot = new WakeDecisionDashboardView({ gate, rollout }).getSnapshot();
  assert.equal(snapshot.mode, "shadow");
  assert.deepEqual(snapshot.rollout, { percent: 25, enabled: false });
  assert.equal(rolloutCalls, 0);
});

test("returned snapshots cannot modify internal Metrics", () => {
  const rolloutMetrics = new WakeDecisionRolloutMetrics();
  rolloutMetrics.record({ rolloutEnabled: true, adapterOutcome: "rejected", reasonCode: "DECISION_REJECTED" });
  const gate = new WakeDecisionGate({ mode: "enforced", rolloutMetrics, rollout: new WakeDecisionRollout({ percent: 10 }) });
  const first = gate.getDashboardSnapshot();
  first.enforced.totalEvaluated = 999;
  first.enforced.rejectionReasons.DECISION_REJECTED = 999;
  const second = gate.getDashboardSnapshot();
  assert.equal(second.enforced.totalEvaluated, 1);
  assert.equal(second.enforced.rejectionReasons.DECISION_REJECTED, 1);
});

test("Dashboard strips sensitive and unknown source fields", () => {
  const gate = {
    mode: "enforced",
    getEvaluation: () => ({
      eligible: false, reasonCodes: ["LOW_AGREEMENT", "private prompt"],
      summary: { total: 10, agreementRate: 0.5, prompt: "hidden", userId: "hidden" }, candidate: { content: "hidden" }
    }),
    getRolloutMetrics: () => ({
      totalEvaluated: 2, adapterRejected: 1, rejectionReasons: { COOLDOWN: 1, "private token": 2 },
      scopeId: "hidden", memory: "hidden", modelResponse: "hidden"
    })
  };
  const snapshot = new WakeDecisionDashboardView({ gate, rollout: { percent: 10, userId: "hidden" } }).getSnapshot();
  assert.deepEqual(snapshot.shadow.reasonCodes, ["LOW_AGREEMENT"]);
  assert.deepEqual(snapshot.enforced.rejectionReasons, { COOLDOWN: 1 });
  assert.doesNotMatch(JSON.stringify(snapshot), /hidden|private|prompt|userId|scopeId|candidate|memory|model|content|token|chat/i);
});

test("Gate Dashboard call does not change mode or decision behavior", () => {
  let adapterCalls = 0;
  const gate = new WakeDecisionGate({
    mode: "shadow",
    adapter: { evaluate() { adapterCalls++; return { shouldContact: false, reasonCode: "COOLDOWN" }; } }
  });
  gate.getDashboardSnapshot();
  assert.equal(adapterCalls, 0);
  assert.equal(gate.mode, "shadow");
  assert.equal(gate.decide({}).mode, "shadow");
  assert.equal(adapterCalls, 1);
});

test("optional Dashboard debug emits only safe aggregate fields", () => {
  const logs = [];
  const gate = new WakeDecisionGate({
    mode: "legacy", dashboardDebug: true,
    logger: { debug(message, fields) { logs.push({ message, fields }); } }
  });
  gate.getDashboardSnapshot();
  assert.deepEqual(logs, [{
    message: "Wake decision dashboard",
    fields: { mode: "legacy", shadowEligible: false, agreementRate: 0, rolloutPercent: 0, enforcedTotal: 0 }
  }]);
});

test("Dashboard View has no database, file, model, network, or persistence dependency", () => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const gate = { mode: "legacy", getEvaluation: () => ({}), getRolloutMetrics: () => ({}) };
  new WakeDecisionDashboardView({ gate, model }).getSnapshot();
  assert.equal(model.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-dashboard-view.js"), "utf8");
  assert.doesNotMatch(source, /require\(|fetch\(|sqlite|redis|SELECT|INSERT|UPDATE|DELETE|(?:read|write)File|model|Bark|wake_up/i);
});
