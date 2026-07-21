"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  PROACTIVE_RESPONSE_SYSTEM_PROMPT, ProactiveResponseAdapter, promptContext, validateOutput
} = require("../proactive-response-adapter");

function context() {
  return {
    trigger: { eventId: "event-1", eventType: "project.milestone_reached", reasonCode: "PROJECT_MILESTONE", payload: { content: "secret" }, stack: "hidden" },
    state: { last_user_interaction_at: { timestamp: "2026-07-18T00:00:00.000Z" }, mood: "happy", token: "secret" },
    relationship: { interactionStyle: "concise", proactiveContact: { enabled: true }, familiarity: { level: 3 } },
    memories: [{ id: "memory-1", type: "MEMORY", title: "Milestone", importance: 5, content: "private memory", embedding: [1] }],
    constraints: { maxLength: 8000, channel: "proactive_contact" },
    prompt: "injected", chat: "private transcript"
  };
}

function fixture(output) {
  const calls = [];
  const model = { async generate(input) { calls.push(input); if (output instanceof Error) throw output; return { content: output }; } };
  return { calls, adapter: new ProactiveResponseAdapter({ adapter: model, model: "fake-proactive", timeoutMs: 100 }) };
}

test("generate validates proactive_contact and builds a bounded prompt", async () => {
  const f = fixture(JSON.stringify({ action: "proactive_contact", text: "项目里程碑完成了，要一起看看下一步吗？", reasonCode: "PROJECT_MILESTONE" }));
  const input = context(), before = structuredClone(input);
  const result = await f.adapter.generate(input);

  assert.deepEqual(result, { action: "proactive_contact", text: "项目里程碑完成了，要一起看看下一步吗？", reasonCode: "PROJECT_MILESTONE" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].model, "fake-proactive");
  assert.equal(f.calls[0].system, PROACTIVE_RESPONSE_SYSTEM_PROMPT);
  assert.deepEqual(input, before);
  const serialized = JSON.stringify(f.calls[0].input);
  assert.doesNotMatch(serialized, /private memory|private transcript|injected|secret|embedding|familiarity|"mood"|token|stack|payload/i);
});

test("no_action is a valid successful output", async () => {
  const f = fixture(JSON.stringify({ action: "no_action", text: "", reasonCode: "MODEL_NO_ACTION" }));
  assert.deepEqual(await f.adapter.generate(context()), { action: "no_action", text: "", reasonCode: "MODEL_NO_ACTION" });
  assert.equal(f.calls.length, 1);
});

test("invalid JSON, long text, unknown action and missing fields are rejected", async () => {
  for (const output of [
    "not-json",
    JSON.stringify({ action: "proactive_contact", text: "x".repeat(501), reasonCode: "PROJECT_MILESTONE" }),
    JSON.stringify({ action: "send_now", text: "hello", reasonCode: "PROJECT_MILESTONE" }),
    JSON.stringify({ action: "proactive_contact", text: "hello" })
  ]) {
    const f = fixture(output);
    await assert.rejects(f.adapter.generate(context()), error => error.code === "MODEL_OUTPUT_INVALID" && !error.stack?.includes("secret"));
  }
});

test("provider errors and timeouts become MODEL_UNAVAILABLE without upstream details", async () => {
  const upstream = Object.assign(new Error("API token and private upstream response"), { code: "AI_UPSTREAM_SERVER_ERROR" });
  await assert.rejects(fixture(upstream).adapter.generate(context()), error => error.code === "MODEL_UNAVAILABLE" && !error.message.includes("private"));
  const hanging = new ProactiveResponseAdapter({ adapter: { generate: () => new Promise(() => {}) }, model: "fake", timeoutMs: 10 });
  await assert.rejects(hanging.generate(context()), error => error.code === "MODEL_UNAVAILABLE");
});

test("validator and prompt context expose only the fixed schema and perform no I/O", () => {
  assert.deepEqual(validateOutput({ action: "no_action", text: "", reasonCode: "MODEL_NO_ACTION" }), { action: "no_action", text: "", reasonCode: "MODEL_NO_ACTION" });
  assert.deepEqual(Object.keys(promptContext(context())), ["trigger", "state", "relationship", "memories", "constraints"]);
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-response-adapter.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|event-store|state-store|structured-memory-store)["']\)|Bark|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b/i);
});
