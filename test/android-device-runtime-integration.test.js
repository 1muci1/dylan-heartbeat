"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AndroidDeviceProvider } = require("../android-device-provider");
const { DeviceAuthorizationGateway } = require("../device-authorization-gateway");
const { DeviceBridgeProtocol } = require("../device-bridge-protocol");
const { DeviceCommandService } = require("../device-command-service");
const { DeviceCommandStore } = require("../device-command-store");
const { DeviceIdentityStore } = require("../device-identity-store");
const { DevicePairingService } = require("../device-pairing-service");
const { DeviceSessionService } = require("../device-session-service");
const { DeviceSessionStore } = require("../device-session-store");
const { ToolExecutionGateway } = require("../tool-execution-gateway");
const { ToolProviderRegistry } = require("../tool-provider-registry");
const { ToolRegistry } = require("../tool-registry");

function fixture({ transport, timeoutMs = 100 } = {}) {
  let deviceSequence = 0;
  let sessionSequence = 0;
  let commandSequence = 0;
  let requestSequence = 0;
  const now = new Date("2026-07-21T14:00:00Z");
  const identityStore = new DeviceIdentityStore();
  const pairing = new DevicePairingService({
    store: identityStore,
    idFactory: () => `device-${++deviceSequence}`,
    tokenFactory: () => `transient-pairing-${deviceSequence}`,
    clock: () => now
  });
  const pending = pairing.createPairingRequest({ deviceName: "Pixel Companion", platform: "android" });
  pairing.confirmPairing({ deviceId: pending.device.deviceId, pairingToken: pending.pairingToken });
  const deviceId = pending.device.deviceId;
  const sessionStore = new DeviceSessionStore();
  const sessionService = new DeviceSessionService({
    identityStore,
    sessionStore,
    sessionIdFactory: () => `session-${++sessionSequence}`,
    clock: () => now,
    sessionTtlMs: 60_000
  });
  const commandStore = new DeviceCommandStore();
  const protocol = new DeviceBridgeProtocol({
    idFactory: () => `request-${++requestSequence}`,
    clock: () => now
  });
  const runtimeTransport = transport || {
    async send(request) {
      return {
        requestId: request.requestId,
        success: true,
        result: {
          online: true,
          batteryLevelBucket: "medium",
          token: "filtered-by-device-protocol",
          internalDebug: "filtered-by-tool-normalizer"
        },
        errorCode: null
      };
    }
  };
  const commandService = new DeviceCommandService({
    identityStore,
    sessionService,
    transport: runtimeTransport,
    commandStore,
    protocol,
    commandIdFactory: () => `command-${++commandSequence}`,
    clock: () => now,
    timeoutMs
  });
  const authorizationGateway = new DeviceAuthorizationGateway({ identityStore });
  const provider = new AndroidDeviceProvider({ deviceId, authorizationGateway, commandService });
  const providerRegistry = new ToolProviderRegistry({ providers: [provider] });
  const registry = new ToolRegistry({ definitions: [{
    name: "android.device.status_get",
    description: "Get Android status through the active Device Command Channel.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    permissionLevel: "automatic",
    executionType: "device_bridge"
  }] });
  const gateway = new ToolExecutionGateway({ registry, providerRegistry });
  return { authorizationGateway, commandService, commandStore, deviceId, gateway, identityStore,
    pairing, provider, sessionService, sessionStore };
}

test("online Device completes the full Tool Gateway to Command Channel status chain", async () => {
  const f = fixture();
  f.sessionService.connect({ deviceId: f.deviceId });
  assert.deepEqual(await f.gateway.execute({ toolName: "android.device.status_get", input: {} }), {
    success: true,
    toolName: "android.device.status_get",
    output: {
      success: true,
      data: { online: true, batteryLevelBucket: "medium" },
      metadata: { truncated: false }
    }
  });
  assert.equal(f.commandStore.get("command-1").status, "completed");
});

test("offline Device is rejected before a command is created", async () => {
  const f = fixture();
  await assert.rejects(f.provider.execute("android.device.status_get", {}),
    error => error.code === "DEVICE_OFFLINE");
  assert.equal(f.commandStore.records.size, 0);
});

test("revoked Device is uniformly rejected as unauthorized", async () => {
  const f = fixture();
  f.sessionService.connect({ deviceId: f.deviceId });
  f.pairing.revoke(f.deviceId);
  await assert.rejects(f.provider.execute("android.device.status_get", {}),
    error => error.code === "DEVICE_NOT_AUTHORIZED");
  assert.equal(f.commandStore.records.size, 0);
});

test("Command Channel timeout is preserved by Provider", async () => {
  const f = fixture({ transport: { send() { return new Promise(() => {}); } }, timeoutMs: 5 });
  f.sessionService.connect({ deviceId: f.deviceId });
  await assert.rejects(f.provider.execute("android.device.status_get", {}),
    error => error.code === "DEVICE_COMMAND_TIMEOUT");
  assert.equal(f.commandStore.get("command-1").status, "failed");
});

test("invalid Device response is isolated as DEVICE_COMMAND_FAILED", async () => {
  const f = fixture({ transport: {
    async send() { return { requestId: "uncorrelated", success: true, result: {}, errorCode: null }; }
  } });
  f.sessionService.connect({ deviceId: f.deviceId });
  await assert.rejects(f.provider.execute("android.device.status_get", {}), error => {
    assert.equal(error.code, "DEVICE_COMMAND_FAILED");
    assert.equal(error.message, "Device command 失败");
    return true;
  });
  assert.equal(f.commandStore.get("command-1").status, "failed");
});

test("unexpected Provider dependency errors are isolated without leaking details", async () => {
  const provider = new AndroidDeviceProvider({
    deviceId: "device-1",
    authorizationGateway: { authorize() {} },
    commandService: { async execute() { throw new Error("secret provider stack and response"); } }
  });
  await assert.rejects(provider.execute("android.device.status_get", {}), error => {
    assert.equal(error.code, "DEVICE_COMMAND_FAILED");
    assert.doesNotMatch(`${error.message} ${error.code}`, /secret|stack|response/i);
    return true;
  });
});
