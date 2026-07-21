"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { AndroidDeviceProvider } = require("../android-device-provider");
const { ToolExecutionGateway } = require("../tool-execution-gateway");
const { ToolProviderRegistry } = require("../tool-provider-registry");
const { ToolRegistry } = require("../tool-registry");

function definition() {
  return {
    name: "android.device.status_get",
    description: "Get Android status through command channel.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    permissionLevel: "automatic",
    executionType: "device_bridge"
  };
}

function provider(overrides = {}) {
  return new AndroidDeviceProvider({
    deviceId: "device-1",
    authorizationGateway: overrides.authorizationGateway || { authorize() {} },
    commandService: overrides.commandService || {
      async execute() { return { response: { success: true, result: { online: true } } }; }
    }
  });
}

function fixture(options = {}) {
  const runtimeProvider = options.provider || provider();
  const providers = new ToolProviderRegistry({ providers: options.registerProvider === false ? [] : [runtimeProvider] });
  const tools = new ToolRegistry({ definitions: options.definitions || [definition()] });
  const gateway = new ToolExecutionGateway({ registry: tools, providerRegistry: providers, policy: options.policy });
  return { gateway, provider: runtimeProvider, providers };
}

test("Provider Registry resolves the Android command runtime by Tool", () => {
  const f = fixture();
  assert.equal(f.providers.get("android_device"), f.provider);
  assert.equal(f.providers.getForTool("android.device.status_get"), f.provider);
  assert.equal(f.providers.getForTool("android.reminder.draft_create"), null);
});

test("automatic Android status completes Gateway, Provider, Command, and Normalizer chain", async () => {
  const f = fixture();
  assert.deepEqual(await f.gateway.execute({ toolName: "android.device.status_get", input: {} }), {
    success: true,
    toolName: "android.device.status_get",
    output: { success: true, data: { online: true }, metadata: { truncated: false } }
  });
});

test("Policy blocks before Android Provider execution", async () => {
  let calls = 0;
  const runtimeProvider = provider({ commandService: { async execute() { calls++; } } });
  const f = fixture({ provider: runtimeProvider, policy: () => ({ allowed: false, decision: "blocked", reasonCode: "BLOCKED" }) });
  await assert.rejects(f.gateway.execute({ toolName: "android.device.status_get", input: {} }),
    error => error.code === "TOOL_POLICY_BLOCKED");
  assert.equal(calls, 0);
});

test("missing Provider and isolated Provider failure remain sanitized", async () => {
  const missing = fixture({ registerProvider: false });
  await assert.rejects(missing.gateway.execute({ toolName: "android.device.status_get", input: {} }),
    error => error.code === "TOOL_PROVIDER_NOT_FOUND");

  const broken = fixture({ provider: provider({
    commandService: { async execute() { throw new Error("secret stack response"); } }
  }) });
  await assert.rejects(broken.gateway.execute({ toolName: "android.device.status_get", input: {} }), error => {
    assert.equal(error.code, "TOOL_PROVIDER_EXECUTION_FAILED");
    assert.doesNotMatch(error.message, /secret|stack|response/i);
    return true;
  });
});

test("Execution Gateway discovers Android runtime only through Provider Registry", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tool-execution-gateway.js"), "utf8");
  assert.doesNotMatch(source, /android-device-provider|AndroidDeviceProvider/);
  assert.match(source, /providerRegistry\.getForTool/);
});
