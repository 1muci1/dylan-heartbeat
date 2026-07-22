"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ANDROID_DEVICE_TOOLS } = require("../android-device-tools");
const { AndroidDeviceProvider } = require("../android-device-provider");
const { assertToolProvider } = require("../tool-provider");
const { ToolProviderRegistry } = require("../tool-provider-registry");

function fixture(overrides = {}) {
  const calls = [];
  const authorizationGateway = overrides.authorizationGateway || {
    authorize(deviceId, action) { calls.push({ type: "authorize", deviceId, action }); }
  };
  const commandService = overrides.commandService || {
    async execute(input) {
      calls.push({ type: "command", input: structuredClone(input) });
      const result = input.action === "reminder.draft_create"
        ? { draftId: "draft-1", status: "created" }
        : { online: true, batteryLevelBucket: "high" };
      return { response: { success: true, result } };
    }
  };
  const provider = new AndroidDeviceProvider({
    deviceId: "device-1", authorizationGateway, commandService,
    clock: () => new Date("2026-07-22T12:00:00Z")
  });
  return { calls, provider };
}

test("AndroidDeviceProvider exposes status and medium-risk Reminder Draft metadata", () => {
  const { provider } = fixture();
  assert.equal(assertToolProvider(provider), provider);
  assert.deepEqual(provider.getMetadata(), {
    name: "android_device", platform: "android", mode: "command_channel", version: "2", toolCount: 2
  });
  assert.deepEqual(provider.listTools(), [{
    name: "android.device.status_get",
    description: "Return Android device availability status through the active command channel.",
    riskLevel: "low",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, {
    name: "android.reminder.draft_create",
    description: "Create a reminder draft in the paired Android Companion for user review.",
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 120 },
        time: { type: "string", minLength: 1, maxLength: 40 }
      },
      required: ["title", "time"],
      additionalProperties: false
    }
  }]);
  assert.ok(Object.isFrozen(ANDROID_DEVICE_TOOLS));
});

test("status Tool authorizes then executes a command and normalizes its response", async () => {
  const { calls, provider } = fixture();
  assert.deepEqual(await provider.execute("android.device.status_get", {}), {
    success: true,
    data: { online: true, batteryLevelBucket: "high" },
    metadata: { truncated: false }
  });
  assert.deepEqual(calls, [
    { type: "authorize", deviceId: "device-1", action: "device.status_get" },
    { type: "command", input: { deviceId: "device-1", action: "device.status_get" } }
  ]);
});

test("Reminder Draft validates, normalizes, authorizes, and does not mutate input", async () => {
  const { calls, provider } = fixture();
  const input = Object.freeze({ title: "  Call Alice  ", time: "2026-07-23T09:30:00+08:00" });
  assert.deepEqual(await provider.execute("android.reminder.draft_create", input), {
    success: true,
    data: { draftId: "draft-1", status: "created" },
    metadata: { truncated: false }
  });
  assert.deepEqual(input, { title: "  Call Alice  ", time: "2026-07-23T09:30:00+08:00" });
  assert.deepEqual(calls, [
    { type: "authorize", deviceId: "device-1", action: "reminder.draft_create" },
    { type: "command", input: {
      deviceId: "device-1", action: "reminder.draft_create",
      payload: { title: "Call Alice", time: "2026-07-23T01:30:00.000Z" }
    } }
  ]);
});

test("Provider rejects unsupported Tools and invalid Tool input", async () => {
  const { provider } = fixture();
  for (const toolName of ["android.unknown.run", "", null]) {
    await assert.rejects(provider.execute(toolName, {}), error => error.code === "ANDROID_TOOL_UNSUPPORTED");
  }
  for (const input of [{ debug: true }, null, []]) {
    await assert.rejects(provider.execute("android.device.status_get", input),
      error => error.code === "ANDROID_INVALID_INPUT");
  }
  const invalidDrafts = [
    {},
    { title: "", time: "2026-07-23T09:30:00Z" },
    { title: "Call", time: "2026-07-23T09:30:00" },
    { title: "Call", time: "2026-07-21T09:30:00Z" },
    { title: "Call", time: "2026-07-23T09:30:00Z", notification: true }
  ];
  for (const input of invalidDrafts) {
    await assert.rejects(provider.execute("android.reminder.draft_create", input),
      error => error.code === "REMINDER_DRAFT_INVALID");
  }
});

test("Provider maps authorization, offline, timeout, and internal command errors", async () => {
  const cases = [
    [{ authorizationGateway: { authorize() { throw Object.assign(new Error(), { code: "DEVICE_REVOKED" }); } } }, "DEVICE_NOT_AUTHORIZED"],
    [{ commandService: { async execute() { throw Object.assign(new Error(), { code: "DEVICE_SESSION_OFFLINE" }); } } }, "DEVICE_OFFLINE"],
    [{ commandService: { async execute() { throw Object.assign(new Error(), { code: "DEVICE_COMMAND_TIMEOUT" }); } } }, "DEVICE_COMMAND_TIMEOUT"],
    [{ commandService: { async execute() { throw new Error("secret provider response stack"); } } }, "DEVICE_COMMAND_FAILED"]
  ];
  for (const [options, code] of cases) {
    const { provider } = fixture(options);
    await assert.rejects(provider.execute("android.device.status_get", {}), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret|response|stack/i);
      return true;
    });
  }
});

test("Provider registers without executing authorization or commands", () => {
  const { calls, provider } = fixture();
  const registry = new ToolProviderRegistry({ providers: [provider] });
  assert.equal(registry.get("android_device"), provider);
  assert.equal(registry.getForTool("android.device.status_get"), provider);
  assert.equal(registry.getForTool("android.reminder.draft_create"), provider);
  assert.deepEqual(calls, []);
});

test("Provider requires Device identity, authorization gateway, and command service", () => {
  assert.throws(() => new AndroidDeviceProvider(), TypeError);
  assert.throws(() => new AndroidDeviceProvider({ deviceId: "device-1", authorizationGateway: {}, commandService: {} }), TypeError);
});

test("Provider contains no fake status generation or forbidden runtime integration", () => {
  const source = ["android-device-provider.js", "android-device-tools.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /FakeDevice|fake-device|notification|accessibility|\badb\b|EventStore|memoryStore|StateStore|database|fetch\(|https?:|MCP|model|migration/i);
  assert.doesNotMatch(source, /batteryLevelBucket|appForeground|randomUUID/);
  assert.doesNotMatch(source, /console\.|\.write\(/i);
});
