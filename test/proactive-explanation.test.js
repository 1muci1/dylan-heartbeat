"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Fastify = require("fastify");
const { ProactiveExplanationView } = require("../proactive-explanation-view");
const { registerProactiveExplanationRoutes } = require("../proactive-explanation-routes");
const {
  PROACTIVE_EXPLANATION_INPUT_SCHEMA,
  PROACTIVE_EXPLANATION_TOOL_NAME,
  mapPublicExplanation
} = require("../proactive-explanation-contract");
const { TOOL_DEFINITIONS } = require("../tool-definitions");

function delivery(overrides = {}) {
  return {
    id: "delivery-1",
    jobId: "job-1",
    eventId: "event-1",
    channel: "push",
    status: "sent",
    text: "secret delivery text",
    reasonCode: "FOLLOW_UP",
    dedupeKey: "secret-dedupe",
    createdAt: "2026-07-22T10:00:00.000Z",
    sentAt: "2026-07-22T10:00:02.000Z",
    failedAt: null,
    attemptCount: 1,
    lockedAt: "secret-lock",
    lockOwner: "secret-worker",
    maxAttemptCount: 3,
    nextRetryAt: null,
    lastErrorCode: null,
    ...overrides
  };
}

test("explanation reads exact Delivery associations and returns only public fields", () => {
  const calls = [];
  const view = new ProactiveExplanationView({
    deliveryStore: { get(id) { calls.push(["delivery", id]); return delivery(); } },
    aiJobStore: { getJob(id) { calls.push(["job", id]); return {
      id, status: "completed", provider: "secret-provider", model: "secret-model", errorMessage: "secret-error"
    }; } },
    eventStore: { get(id) { calls.push(["event", id]); return {
      id, eventType: "proactive.delivery_sent", occurredAt: "2026-07-22T10:00:02.000Z",
      payload: { text: "secret-event-payload" }
    }; } },
    feedbackStore: { getForDelivery(id) { calls.push(["feedback", id]); return {
      id: "feedback-secret", deliveryId: id, feedbackType: "liked", createdAt: "2026-07-22T11:00:00.000Z"
    }; } }
  });

  const result = view.get(" delivery-1 ");
  assert.deepEqual(calls, [
    ["delivery", "delivery-1"], ["job", "job-1"], ["event", "event-1"], ["feedback", "delivery-1"]
  ]);
  assert.deepEqual(result, {
    deliveryId: "delivery-1",
    summaryCode: "DELIVERY_SENT",
    delivery: {
      status: "sent", channel: "push", reasonCode: "FOLLOW_UP", attemptCount: 1,
      createdAt: "2026-07-22T10:00:00.000Z", sentAt: "2026-07-22T10:00:02.000Z",
      failedAt: null, lastErrorCode: null
    },
    aiJob: { available: true, id: "job-1", status: "completed" },
    triggerEvent: { available: true, eventType: "proactive.delivery_sent", occurredAt: "2026-07-22T10:00:02.000Z" },
    wakeDecision: { available: false, decision: null, reasonCode: null },
    feedback: { feedbackType: "liked", createdAt: "2026-07-22T11:00:00.000Z" }
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|text|provider|model|payload|dedupe|lock|worker|retry/i);
});

test("explanation maps every Delivery state and marks missing optional facts unavailable", () => {
  const expected = {
    pending: "DELIVERY_PENDING",
    sending: "DELIVERY_SENDING",
    sent: "DELIVERY_SENT",
    failed: "DELIVERY_FAILED",
    cancelled: "DELIVERY_CANCELLED"
  };
  for (const [status, summaryCode] of Object.entries(expected)) {
    const view = new ProactiveExplanationView({
      deliveryStore: { get() { return delivery({ status, jobId: null, eventId: null }); } }
    });
    const result = view.get("delivery-1");
    assert.equal(result.summaryCode, summaryCode);
    assert.deepEqual(result.aiJob, { available: false, id: null, status: null });
    assert.deepEqual(result.triggerEvent, { available: false, eventType: null, occurredAt: null });
    assert.equal(result.feedback, null);
  }
});

test("shared contract is the Registry input source and sanitizes HTTP output", () => {
  const definition = TOOL_DEFINITIONS.find(item => item.name === PROACTIVE_EXPLANATION_TOOL_NAME);
  assert.equal(definition.inputSchema, PROACTIVE_EXPLANATION_INPUT_SCHEMA);
  const view = new ProactiveExplanationView({ deliveryStore: { get() { return delivery(); } } });
  const publicResult = view.get("delivery-1");
  const sanitized = mapPublicExplanation({
    ...publicResult,
    secret: "drop-me",
    delivery: { ...publicResult.delivery, text: "drop-me", lockOwner: "drop-me" }
  });
  assert.deepEqual(sanitized, publicResult);
  assert.doesNotMatch(JSON.stringify(sanitized), /drop-me|lockOwner|text/i);
  assert.throws(() => mapPublicExplanation({ ...publicResult, summaryCode: "UNKNOWN" }));
  assert.throws(() => mapPublicExplanation({
    ...publicResult, feedback: { feedbackType: "inferred_mood", createdAt: "2026-07-22T11:00:00.000Z" }
  }));
  assert.throws(() => mapPublicExplanation({
    ...publicResult, aiJob: { available: false, id: "untrusted-job", status: null }
  }));
});

test("explanation validates IDs and only hides explicit missing optional associations", () => {
  const missing = code => ({ get() { const error = new Error("missing"); error.code = code; throw error; } });
  const view = new ProactiveExplanationView({
    deliveryStore: { get() { return delivery(); } },
    aiJobStore: { getJob: missing("AI_JOB_NOT_FOUND").get },
    eventStore: missing("EVENT_NOT_FOUND")
  });
  assert.deepEqual(view.get("delivery-1").aiJob, { available: false, id: null, status: null });
  for (const id of ["", " ", "x".repeat(201), null, {}]) assert.throws(() => view.get(id));

  const broken = new ProactiveExplanationView({
    deliveryStore: { get() { return delivery(); } },
    aiJobStore: { getJob() { throw Object.assign(new Error("db unavailable"), { code: "DB_FAILED" }); } }
  });
  assert.throws(() => broken.get("delivery-1"), error => error.code === "DB_FAILED");
});

test("GET explanation API is authenticated, read-only, and returns stable errors", async t => {
  const calls = [];
  const app = Fastify({ logger: false });
  registerProactiveExplanationRoutes(app, {
    explanationView: { get(id) {
      calls.push(id);
      if (id === "missing") throw Object.assign(new Error("Delivery 不存在"), {
        statusCode: 404, code: "DELIVERY_NOT_FOUND"
      });
      return { deliveryId: id, summaryCode: "DELIVERY_SENT" };
    } },
    apiKey: "explanation-token"
  });
  await app.ready();
  t.after(() => app.close());

  assert.equal((await app.inject({ method: "GET", url: "/api/v1/proactive/explanations/delivery-1" })).statusCode, 401);
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/proactive/explanations/delivery-1",
    headers: { authorization: "Bearer explanation-token" }
  });
  assert.deepEqual(response.json(), { deliveryId: "delivery-1", summaryCode: "DELIVERY_SENT" });
  assert.deepEqual(calls, ["delivery-1"]);

  const missing = await app.inject({
    method: "GET", url: "/api/v1/proactive/explanations/missing",
    headers: { authorization: "Bearer explanation-token" }
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: { code: "DELIVERY_NOT_FOUND", message: "Delivery 不存在" } });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal((await app.inject({ method, url: "/api/v1/proactive/explanations/delivery-1",
      headers: { authorization: "Bearer explanation-token" } })).statusCode, 404);
  }
});

test("explanation modules have no model, Device, Delivery mutation, or persistence dependency", () => {
  const source = ["proactive-explanation-view.js", "proactive-explanation-routes.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /require\([^)]*(model|memory|device|bark|database|migration)/i);
  assert.doesNotMatch(source, /\.create\(|\.markSent\(|\.markFailed\(|scheduleRetry|claimPending|fetch\(/);
});
