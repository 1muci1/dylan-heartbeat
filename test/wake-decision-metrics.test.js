"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WakeDecisionMetrics } = require("../wake-decision-metrics");
const { compareWakeDecisionShadow, recordWakeDecisionMetrics } = require("../wake_up");

const comparison = (differenceType, reasonCode = "") => ({
  oldDecision: { shouldContact: differenceType !== "new_only" },
  newDecision: { shouldContact: differenceType !== "old_only", reasonCode },
  agreement: differenceType === "same",
  differenceType
});

test("record accumulates agreement and difference counters", () => {
  const metrics = new WakeDecisionMetrics();
  metrics.record(comparison("same"));
  metrics.record(comparison("old_only"));
  metrics.record(comparison("new_only"));
  metrics.record(comparison("same"));
  assert.deepEqual(metrics.snapshot(), {
    total: 4, same: 2, oldOnly: 1, newOnly: 1, agreementRate: 0.5, reasonCounts: {}
  });
});

test("reason counts accept only safe reason codes", () => {
  const metrics = new WakeDecisionMetrics();
  metrics.record(comparison("old_only", "COOLDOWN"));
  metrics.record(comparison("same", "COOLDOWN"));
  metrics.record(comparison("new_only", "QUIET_HOURS"));
  metrics.record(comparison("same", "private prompt token"));
  assert.deepEqual(metrics.snapshot().reasonCounts, { COOLDOWN: 2, QUIET_HOURS: 1 });
});

test("reset clears all in-memory counters", () => {
  const metrics = new WakeDecisionMetrics();
  metrics.record(comparison("same", "INACTIVITY"));
  metrics.reset();
  assert.deepEqual(metrics.snapshot(), {
    total: 0, same: 0, oldOnly: 0, newOnly: 0, agreementRate: 0, reasonCounts: {}
  });
});

test("invalid records are ignored without throwing", () => {
  const metrics = new WakeDecisionMetrics();
  for (const value of [null, undefined, "same", {}, { differenceType: "unknown" }]) {
    assert.doesNotThrow(() => assert.equal(metrics.record(value), false));
  }
  assert.equal(metrics.snapshot().total, 0);
});

test("optional debug emits only aggregate metrics and top reasons", () => {
  const metrics = new WakeDecisionMetrics();
  metrics.record(comparison("old_only", "COOLDOWN"));
  metrics.record(comparison("same", "QUIET_HOURS"));
  metrics.record(comparison("old_only", "COOLDOWN"));
  const logs = [];
  recordWakeDecisionMetrics(comparison("new_only", "INACTIVITY"), {
    metrics, metricsDebug: true
  }, { debug(message, fields) { logs.push({ message, fields }); } });
  assert.deepEqual(logs, [{
    message: "Wake decision metrics",
    fields: {
      total: 4, agreementRate: 0.25, oldOnly: 2, newOnly: 1,
      topReasons: [
        { reasonCode: "COOLDOWN", count: 2 },
        { reasonCode: "INACTIVITY", count: 1 },
        { reasonCode: "QUIET_HOURS", count: 1 }
      ]
    }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /prompt|memory|content|user message|token/i);
});

test("Metrics failure is isolated from Shadow comparison and legacy dependencies", () => {
  const logs = [];
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const bark = { calls: 0, send() { this.calls++; throw new Error("BARK_MUST_NOT_BE_CALLED"); } };
  const result = compareWakeDecisionShadow(
    { shouldContact: true },
    { shouldContact: false, reasonCode: "COOLDOWN" },
    {},
    {
      enabled: true,
      metrics: { record() { throw new Error("METRICS_FAILURE"); } },
      logger: { debug(message, fields) { logs.push({ message, fields }); } },
      model,
      bark
    }
  );
  assert.equal(result.differenceType, "old_only");
  assert.equal(logs[0].message, "Wake decision shadow");
  assert.equal(logs[1].message, "Wake decision metrics unavailable");
  assert.equal(model.calls, 0);
  assert.equal(bark.calls, 0);
});

test("Metrics implementation is memory-only and has no external dependencies", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-metrics.js"), "utf8");
  assert.doesNotMatch(source, /require\(|(?:read|write)File|sqlite|redis|fetch\(|SELECT|INSERT|UPDATE|DELETE|model|Bark/i);
});
