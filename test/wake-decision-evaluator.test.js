"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WakeDecisionEvaluator } = require("../wake-decision-evaluator");
const { WakeDecisionGate } = require("../wake-decision-gate");

const evaluate = metrics => new WakeDecisionEvaluator().evaluate(metrics);

test("insufficient samples are not eligible", () => {
  const result = evaluate({ total: 49, same: 49, oldOnly: 0, newOnly: 0, agreementRate: 1 });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["INSUFFICIENT_SAMPLE"]);
});

test("high agreement within both difference budgets is eligible", () => {
  assert.deepEqual(evaluate({ total: 100, same: 92, oldOnly: 5, newOnly: 3, agreementRate: 0.92 }), {
    eligible: true,
    reasonCodes: [],
    summary: { total: 100, agreementRate: 0.92, same: 92, oldOnly: 5, newOnly: 3 }
  });
});

test("low agreement fails independently", () => {
  const result = evaluate({ total: 100, same: 89, oldOnly: 0, newOnly: 0, agreementRate: 0.89 });
  assert.deepEqual(result.reasonCodes, ["LOW_AGREEMENT"]);
});

test("excess new-only contacts fail the five-percent budget", () => {
  const result = evaluate({ total: 100, same: 94, oldOnly: 0, newOnly: 6, agreementRate: 0.94 });
  assert.deepEqual(result.reasonCodes, ["TOO_MANY_NEW_CONTACTS"]);
});

test("excess old-only contacts fail the fifteen-percent budget", () => {
  const result = evaluate({ total: 100, same: 84, oldOnly: 16, newOnly: 0, agreementRate: 0.90 });
  assert.deepEqual(result.reasonCodes, ["TOO_MANY_MISSED_CONTACTS"]);
});

test("empty metrics fail safely with a bounded statistical summary", () => {
  assert.deepEqual(evaluate(null), {
    eligible: false,
    reasonCodes: ["INSUFFICIENT_SAMPLE", "LOW_AGREEMENT"],
    summary: { total: 0, agreementRate: 0, same: 0, oldOnly: 0, newOnly: 0 }
  });
});

test("evaluation does not mutate or expose extra metric fields", () => {
  const metrics = {
    total: 50, same: 45, oldOnly: 3, newOnly: 2, agreementRate: 0.9,
    reasonCounts: { COOLDOWN: 3 }, prompt: "hidden", content: "hidden", modelOutput: "hidden"
  };
  const snapshot = structuredClone(metrics);
  const result = evaluate(metrics);
  assert.deepEqual(metrics, snapshot);
  assert.doesNotMatch(JSON.stringify(result), /COOLDOWN|prompt|content|model|hidden/);
});

test("Gate getEvaluation reads only metrics.snapshot and never changes mode", () => {
  let snapshots = 0;
  const gate = new WakeDecisionGate({
    mode: "shadow",
    adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "COOLDOWN" }) },
    metrics: { snapshot() { snapshots++; return { total: 100, same: 95, oldOnly: 3, newOnly: 2, agreementRate: 0.95 }; } }
  });
  const result = gate.getEvaluation();
  assert.equal(result.eligible, true);
  assert.equal(snapshots, 1);
  assert.equal(gate.mode, "shadow");
  assert.equal(gate.decide({}).mode, "shadow");
});

test("evaluation debug contains only eligibility statistics", () => {
  const logs = [];
  const gate = new WakeDecisionGate({
    mode: "legacy",
    evaluationDebug: true,
    logger: { debug(message, fields) { logs.push({ message, fields }); } },
    metrics: { snapshot: () => ({ total: 10, same: 9, oldOnly: 1, newOnly: 0, agreementRate: 0.9, prompt: "hidden" }) }
  });
  gate.getEvaluation();
  assert.deepEqual(logs, [{
    message: "Wake decision evaluation",
    fields: { eligible: false, reasonCodes: ["INSUFFICIENT_SAMPLE"], agreementRate: 0.9, total: 10 }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /hidden|prompt|memory|content|token|model/i);
});

test("Evaluator has no database, model, persistence, or network dependency", () => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  new WakeDecisionEvaluator({ model }).evaluate({});
  assert.equal(model.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-evaluator.js"), "utf8");
  assert.doesNotMatch(source, /require\(|fetch\(|sqlite|redis|SELECT|INSERT|UPDATE|DELETE|(?:read|write)File|model|Bark/i);
});
