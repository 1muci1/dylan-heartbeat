"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { OpenAIJsonAdapter } = require("../model-adapter");

function response(status, payload, jsonError = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => {
    if (jsonError) throw jsonError;
    return payload;
  } };
}

function adapter(fetch, options = {}) {
  return new OpenAIJsonAdapter({ url: "https://example.invalid/v1/chat/completions", apiKey: "fake-key", fetch, timeoutMs: 50, ...options });
}

test("adapter sends an OpenAI-compatible JSON request through fake fetch", async () => {
  let request;
  const usage = { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 };
  const value = await adapter(async (url, options) => {
    request = { url, options };
    return response(200, { model: "summary-model-2026", usage, choices: [{ message: { content: '{"ok":true}' } }] });
  }).generate({ model: "summary-model", system: "system", input: { messages: ["hello"] } });
  assert.equal(value.content, '{"ok":true}');
  assert.deepEqual(value.usage, usage);
  assert.equal(value.model, "summary-model-2026");
  assert.equal(Number.isInteger(value.latencyMs), true);
  assert.equal(value.latencyMs >= 0, true);
  assert.equal(request.url, "https://example.invalid/v1/chat/completions");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "summary-model");
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(request.options.headers.Authorization, "Bearer fake-key");
});

test("adapter falls back to request model and null usage", async () => {
  const value = await adapter(async () => response(200, {
    choices: [{ message: { content: '{"ok":true}' } }]
  })).generate({ model: "fallback-model" });
  assert.equal(value.model, "fallback-model");
  assert.equal(value.usage, null);
});

test("adapter configuration status exposes booleans but never the key or endpoint", () => {
  const status = adapter(async () => response(200, {})).configurationStatus();
  assert.deepEqual(status, { provider:"openai-compatible",endpointConfigured:true,apiKeyConfigured:true,transportConfigured:true,configured:true });
  assert.doesNotMatch(JSON.stringify(status), /fake-key|example\.invalid/);
});

test("adapter reports configuration, model, timeout, abort and network errors", async () => {
  await assert.rejects(new OpenAIJsonAdapter({ fetch: async () => {} }).generate({ model: "m" }), error => error.code === "AI_MODEL_NOT_CONFIGURED" && error.statusCode === 503);
  await assert.rejects(adapter(async () => response(200, {})).generate({}), error => error.code === "AI_MODEL_NAME_MISSING");
  const hanging = adapter((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))), { timeoutMs: 10 });
  await assert.rejects(hanging.generate({ model: "m" }), error => error.code === "AI_MODEL_TIMEOUT" && error.statusCode === 504);
  const controller = new AbortController();
  const cancelled = adapter((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))))
    .generate({ model: "m", signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, error => error.code === "AI_MODEL_ABORTED" && error.statusCode === 499);
  await assert.rejects(adapter(async () => { throw new Error("dns"); }).generate({ model: "m" }), error => error.code === "AI_UPSTREAM_NETWORK_ERROR");
});

test("adapter maps upstream 4xx and 5xx statuses to stable codes", async () => {
  for (const [status, code, mappedStatus] of [[401,"AI_UPSTREAM_AUTH_ERROR",502],[403,"AI_UPSTREAM_AUTH_ERROR",502],[400,"AI_UPSTREAM_CLIENT_ERROR",502],[429,"AI_UPSTREAM_RATE_LIMIT",503],[500,"AI_UPSTREAM_SERVER_ERROR",502]]) {
    await assert.rejects(adapter(async () => response(status, {})).generate({ model: "m" }), error => error.code === code && error.statusCode === mappedStatus);
  }
});

test("adapter rejects non-JSON, missing choices and non-string content", async () => {
  await assert.rejects(adapter(async () => response(200, null, new SyntaxError("bad json"))).generate({ model: "m" }), error => error.code === "AI_RESPONSE_NOT_JSON");
  for (const payload of [{}, { choices: [] }, { choices: "bad" }]) {
    await assert.rejects(adapter(async () => response(200, payload)).generate({ model: "m" }), error => error.code === "AI_RESPONSE_CHOICES_MISSING");
  }
  for (const content of [null, {}, 42]) {
    await assert.rejects(adapter(async () => response(200, { choices: [{ message: { content } }] })).generate({ model: "m" }), error => error.code === "AI_RESPONSE_CONTENT_INVALID");
  }
});
