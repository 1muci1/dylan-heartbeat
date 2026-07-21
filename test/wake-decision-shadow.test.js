"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WakeDecisionShadow } = require("../wake-decision-shadow");
const { compareWakeDecisionShadow } = require("../wake_up");

test("matching old and new decisions agree", () => {
  const shadow = new WakeDecisionShadow();
  assert.deepEqual(shadow.compare({
    oldDecision: { shouldContact: true }, newDecision: { shouldContact: true, reasonCode: "PROJECT_MILESTONE" }, context: {}
  }), {
    oldDecision: { shouldContact: true },
    newDecision: { shouldContact: true, reasonCode: "PROJECT_MILESTONE" },
    agreement: true,
    differenceType: "same"
  });
});

test("old allow and new reject produce old_only", () => {
  const result = new WakeDecisionShadow().compare({
    oldDecision: { shouldContact: true }, newDecision: { shouldContact: false, reasonCode: "QUIET_HOURS" }
  });
  assert.equal(result.agreement, false);
  assert.equal(result.differenceType, "old_only");
});

test("old reject and new allow produce new_only", () => {
  const result = new WakeDecisionShadow().compare({
    oldDecision: { shouldContact: false }, newDecision: { shouldContact: true, reasonCode: "INACTIVITY" }
  });
  assert.equal(result.agreement, false);
  assert.equal(result.differenceType, "new_only");
});

test("comparison strips all sensitive input and leaves inputs unchanged", () => {
  const input = {
    oldDecision: { shouldContact: false, modelOutput: "private model output" },
    newDecision: { shouldContact: false, reasonCode: "bad token value", candidate: { prompt: "hidden" } },
    context: { memory: { content: "hidden" }, chat: "hidden", token: "hidden" }
  };
  const snapshot = structuredClone(input);
  const result = new WakeDecisionShadow().compare(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result, {
    oldDecision: { shouldContact: false },
    newDecision: { shouldContact: false, reasonCode: "" },
    agreement: true,
    differenceType: "same"
  });
  assert.doesNotMatch(JSON.stringify(result), /private|model output|prompt|hidden|token|content|chat/i);
});

test("shadow integration is disabled by default and logs only safe statistics when enabled", () => {
  let calls = 0;
  const logs = [];
  const fakeShadow = { compare(input) {
    calls++;
    assert.equal(input.context.secret, "must-not-log");
    return {
      oldDecision: { shouldContact: true },
      newDecision: { shouldContact: false, reasonCode: "COOLDOWN" },
      agreement: false,
      differenceType: "old_only"
    };
  } };
  assert.equal(compareWakeDecisionShadow({}, {}, {}, { enabled: false, shadow: fakeShadow }), null);
  const result = compareWakeDecisionShadow(
    { shouldContact: true, prompt: "hidden" },
    { shouldContact: false, reasonCode: "COOLDOWN", token: "hidden" },
    { secret: "must-not-log" },
    { enabled: true, shadow: fakeShadow, logger: { debug(message, fields) { logs.push({ message, fields }); } } }
  );
  assert.equal(calls, 1);
  assert.equal(result.differenceType, "old_only");
  assert.deepEqual(logs, [{
    message: "Wake decision shadow",
    fields: { agreement: false, differenceType: "old_only", reasonCode: "COOLDOWN" }
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /hidden|must-not-log|prompt|token|secret/);
});

test("shadow never calls model, Bark, jobs, or persistence", () => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const bark = { calls: 0, send() { this.calls++; throw new Error("BARK_MUST_NOT_BE_CALLED"); } };
  const jobs = { calls: 0, createJob() { this.calls++; throw new Error("JOB_MUST_NOT_BE_CREATED"); } };
  const writes = { calls: 0, create() { this.calls++; }, set() { this.calls++; }, update() { this.calls++; } };
  new WakeDecisionShadow({ model, bark, jobs, writes }).compare({
    oldDecision: { shouldContact: false }, newDecision: { shouldContact: false }, context: {}
  });
  assert.deepEqual([model.calls, bark.calls, jobs.calls, writes.calls], [0, 0, 0, 0]);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake-decision-shadow.js"), "utf8");
  assert.doesNotMatch(source, /require\(|fetch\(|Bark|createJob|\.create\(|\.set\(|\.update\(/);
});
