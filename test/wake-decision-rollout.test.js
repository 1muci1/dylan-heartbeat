"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WakeDecisionGate } = require("../wake-decision-gate");
const { WakeDecisionRollout, normalizePercent, stableBucket } = require("../wake-decision-rollout");

test("default and invalid percentages safely resolve to zero", () => {
  for (const value of [undefined, null, "", -1, 101, 1.5, "bad", NaN]) assert.equal(normalizePercent(value), 0);
  const result = new WakeDecisionRollout().shouldEnforce({ userId: "user-1" });
  assert.equal(result.percent, 0);
  assert.equal(result.enabled, false);
});

test("zero percent disables every bucket and 100 percent enables every bucket", () => {
  for (const userId of ["a", "b", "c", "default"]) {
    assert.equal(new WakeDecisionRollout({ percent: 0 }).shouldEnforce({ userId }).enabled, false);
    assert.equal(new WakeDecisionRollout({ percent: 100 }).shouldEnforce({ userId }).enabled, true);
  }
});

test("the same identity always receives the same stable bucket", () => {
  const rollout = new WakeDecisionRollout({ percent: 10 });
  const first = rollout.shouldEnforce({ userId: "stable-user", scopeId: "ignored" });
  for (let index = 0; index < 20; index++) assert.deepEqual(rollout.shouldEnforce({ userId: "stable-user" }), first);
  assert.equal(first.bucket, stableBucket("stable-user"));
  assert.deepEqual(rollout.shouldEnforce({ scopeId: "scope-1" }), rollout.shouldEnforce({ scopeId: "scope-1" }));
  assert.deepEqual(rollout.shouldEnforce({}), { enabled: stableBucket("default") < 10, bucket: stableBucket("default"), percent: 10 });
});

test("different identities distribute across the full bucket range without randomness", () => {
  const rollout = new WakeDecisionRollout({ percent: 10 });
  const results = Array.from({ length: 1000 }, (_, index) => rollout.shouldEnforce({ userId: `user-${index}` }));
  const buckets = new Set(results.map(result => result.bucket));
  const enabled = results.filter(result => result.enabled).length;
  assert.ok(buckets.size >= 90, `bucket count ${buckets.size}`);
  assert.ok(enabled >= 70 && enabled <= 130, `enabled count ${enabled}`);
});

test("non-enforced Gate modes never use rollout", () => {
  let calls = 0;
  const rollout = { shouldEnforce() { calls++; return { enabled: true, bucket: 0, percent: 100 }; } };
  for (const mode of ["legacy", "shadow"]) {
    const gate = new WakeDecisionGate({ mode, rollout, adapter: { evaluate: () => ({ shouldContact: true }) } });
    assert.deepEqual(gate.shouldUseEnforced({ userId: "x" }), { enabled: false, bucket: 0, percent: 0 });
  }
  assert.equal(calls, 0);
});

test("enforced Gate only calls Adapter inside an enabled rollout bucket", () => {
  let calls = 0;
  const adapter = { evaluate() { calls++; return { shouldContact: false, reasonCode: "COOLDOWN" }; } };
  const disabled = new WakeDecisionGate({
    mode: "enforced", adapter, rollout: { shouldEnforce: () => ({ enabled: false, bucket: 70, percent: 10 }) }
  }).decide({ userId: "outside" });
  assert.deepEqual(disabled, { mode: "enforced", shouldContact: null, source: "rollout" });
  assert.equal(calls, 0);
  const enabled = new WakeDecisionGate({
    mode: "enforced", adapter, rollout: { shouldEnforce: () => ({ enabled: true, bucket: 2, percent: 10 }) }
  }).decide({ userId: "inside" });
  assert.deepEqual(enabled, { mode: "enforced", shouldContact: false, reasonCode: "DECISION_REJECTED" });
  assert.equal(calls, 1);
});

test("rollout and Gate do not mutate context", () => {
  const context = { userId: "user-1", scopeId: "default", nested: { value: true } };
  const snapshot = structuredClone(context);
  new WakeDecisionRollout({ percent: 50 }).shouldEnforce(context);
  new WakeDecisionGate({ mode: "enforced", rollout: new WakeDecisionRollout({ percent: 50 }) }).shouldUseEnforced(context);
  assert.deepEqual(context, snapshot);
});

test("rollout debug contains no identity or candidate data", () => {
  const logs = [];
  const gate = new WakeDecisionGate({
    mode: "enforced", rolloutDebug: true,
    rollout: { shouldEnforce: () => ({ enabled: true, bucket: 4, percent: 10 }) },
    logger: { debug(message, fields) { logs.push({ message, fields }); } }
  });
  gate.shouldUseEnforced({ userId: "private-user", prompt: "hidden" });
  assert.deepEqual(logs, [{
    message: "Wake decision rollout",
    fields: { mode: "enforced", enabled: true, bucket: 4, percent: 10 }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /private-user|prompt|hidden|candidate|content|token/i);
});

test("Rollout uses no randomness, database, model, persistence, or network", () => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  new WakeDecisionRollout({ percent: 10, model }).shouldEnforce({});
  assert.equal(model.calls, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-rollout.js"), "utf8");
  assert.doesNotMatch(source, /Math\.random|require\(|fetch\(|sqlite|redis|SELECT|INSERT|UPDATE|DELETE|(?:read|write)File|model|Bark/i);
});
