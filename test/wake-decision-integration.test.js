"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { buildWakeDecisionInput, evaluateWakeDecision } = require("../wake_up");

const allowed = {
  shouldContact: true,
  reasonCode: "PROJECT_MILESTONE",
  candidate: { type: "project_milestone", priority: 2 },
  decision: { allowed: true, action: "proactive_contact", reasonCode: "PROJECT_MILESTONE", priority: 2 }
};

function logger() {
  const calls = [];
  return { calls, debug(message, fields) { calls.push({ message, fields }); } };
}

test("WAKE_DECISION_ENABLED=false leaves the adapter and old side effects untouched", () => {
  let adapterCalls = 0;
  const log = logger();
  const result = evaluateWakeDecision({}, {
    enabled: false, logger: log, adapter: { evaluate() { adapterCalls++; return allowed; } }
  });
  assert.equal(result, null);
  assert.equal(adapterCalls, 0);
  assert.deepEqual(log.calls, []);
});

test("enabled mode calls the adapter and logs an allowed decision only", () => {
  let adapterCalls = 0;
  let barkCalls = 0;
  const log = logger();
  const result = evaluateWakeDecision({ events: [], state: {}, relationship: {}, now: new Date() }, {
    enabled: true,
    logger: log,
    adapter: { evaluate() { adapterCalls++; return allowed; } },
    bark: { send() { barkCalls++; } }
  });
  assert.equal(adapterCalls, 1);
  assert.equal(barkCalls, 0);
  assert.deepEqual(result, allowed);
  assert.deepEqual(log.calls, [{
    message: "Wake decision",
    fields: { candidateCount: 1, approvedCount: 1, rejectedCount: 0, reasonCode: "PROJECT_MILESTONE" }
  }]);
  assert.doesNotMatch(JSON.stringify(log.calls), /prompt|token|content|chat/i);
});

test("rejected decision logs only its safe reason and never sends", () => {
  const log = logger();
  const result = evaluateWakeDecision({}, {
    enabled: true, logger: log,
    adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "QUIET_HOURS", candidate: null, decision: null }) }
  });
  assert.equal(result.shouldContact, false);
  assert.deepEqual(log.calls[0].fields, {
    candidateCount: 1, approvedCount: 0, rejectedCount: 1, reasonCode: "QUIET_HOURS"
  });
});

test("adapter failure is isolated from the legacy Wake-up path", () => {
  const log = logger();
  assert.doesNotThrow(() => evaluateWakeDecision({}, {
    enabled: true, logger: log, adapter: { evaluate() { throw new Error("private failure token"); } }
  }));
  assert.deepEqual(log.calls, [{
    message: "Wake decision unavailable",
    fields: { candidateCount: 0, approvedCount: 0, rejectedCount: 0, reasonCode: "DECISION_ERROR" }
  }]);
  assert.doesNotMatch(JSON.stringify(log.calls), /private|token/);
});

test("decision context contains only the deterministic last-interaction State", () => {
  const now = new Date("2026-07-18T12:00:00Z");
  const input = buildWakeDecisionInput(new Date("2026-07-10T12:00:00Z"), now);
  assert.deepEqual(input, {
    events: [],
    state: { last_user_interaction_at: { timestamp: "2026-07-10T12:00:00.000Z" } },
    relationship: {},
    now
  });
});

test("decision sidecar does not call a model, Bark, AI Job, or persistence APIs", () => {
  const model = { calls: 0, generate() { this.calls++; throw new Error("MODEL_MUST_NOT_BE_CALLED"); } };
  const bark = { calls: 0, send() { this.calls++; throw new Error("BARK_MUST_NOT_BE_CALLED"); } };
  const jobs = { calls: 0, createJob() { this.calls++; throw new Error("JOB_MUST_NOT_BE_CREATED"); } };
  const writes = { calls: 0, create() { this.calls++; throw new Error("WRITE_MUST_NOT_HAPPEN"); }, set() { this.calls++; } };
  evaluateWakeDecision({}, {
    enabled: true, logger: logger(), adapter: { evaluate: () => ({ shouldContact: false, reasonCode: "", candidate: null, decision: null }) },
    model, bark, jobs, writes
  });
  assert.deepEqual([model.calls, bark.calls, jobs.calls, writes.calls], [0, 0, 0, 0]);
  const source = fs.readFileSync(path.join(__dirname, "..", "wake_up.js"), "utf8");
  assert.equal((source.match(/fetch\("https:\/\/api\.day\.app\/push"/g) || []).length, 1);
  assert.equal((source.match(/fetch\(process\.env\.TARGET_API_URL/g) || []).length, 1);
  assert.doesNotMatch(source, /createJob|eventStore\.create|stateStore\.set|memoryStore\.(?:create|update)/);
});
