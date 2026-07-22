"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DeviceBridgeProtocol } = require("../device-bridge-protocol");
const { DeviceCommandService } = require("../device-command-service");
const { DeviceCommandStore } = require("../device-command-store");
const { DeviceIdentityStore } = require("../device-identity-store");
const { DevicePairingService } = require("../device-pairing-service");
const { DeviceSessionService } = require("../device-session-service");
const { DeviceSessionStore } = require("../device-session-store");
const { FakeDeviceTransport } = require("../fake-device-transport");

function fixture({ transport = new FakeDeviceTransport(), timeoutMs = 100 } = {}) {
  let deviceSequence = 0;
  let commandSequence = 0;
  let requestSequence = 0;
  let sessionSequence = 0;
  let now = new Date("2026-07-21T12:00:00Z");
  const identityStore = new DeviceIdentityStore();
  const pairing = new DevicePairingService({
    store: identityStore,
    idFactory: () => `device-${++deviceSequence}`,
    tokenFactory: () => `transient-pairing-${deviceSequence}`,
    clock: () => now
  });
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
  const commands = new DeviceCommandService({
    identityStore,
    sessionService,
    transport,
    commandStore,
    protocol,
    commandIdFactory: () => `command-${++commandSequence}`,
    clock: () => now,
    timeoutMs
  });
  const create = () => pairing.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  const pair = () => {
    const request = create();
    pairing.confirmPairing({ deviceId: request.device.deviceId, pairingToken: request.pairingToken });
    return request.device.deviceId;
  };
  const online = () => {
    const deviceId = pair();
    sessionService.connect({ deviceId });
    return deviceId;
  };
  return { commandStore, commands, create, identityStore, online, pair, pairing, sessionService, sessionStore,
    advance(ms) { now = new Date(now.getTime() + ms); } };
}

test("online paired Device completes a status_get command through Device Protocol", async () => {
  const f = fixture({
    transport: new FakeDeviceTransport({ status: { batteryLevelBucket: "high", online: true, appForeground: false } })
  });
  const deviceId = f.online();
  f.advance(500);
  const result = await f.commands.execute({ deviceId, action: "device.status_get" });
  assert.deepEqual(result.command, {
    commandId: "command-1",
    deviceId,
    action: "device.status_get",
    status: "completed",
    createdAt: "2026-07-21T12:00:00.500Z",
    completedAt: "2026-07-21T12:00:00.500Z"
  });
  assert.deepEqual(result.response, {
    requestId: "request-1",
    success: true,
    result: { batteryLevelBucket: "high", online: true, appForeground: false },
    errorCode: null
  });
});

test("offline Device is rejected before command creation", async () => {
  const f = fixture();
  const deviceId = f.pair();
  await assert.rejects(f.commands.execute({ deviceId, action: "device.status_get" }),
    error => error.code === "DEVICE_SESSION_OFFLINE");
  assert.equal(f.commandStore.records.size, 0);
});

test("revoked Device is rejected even if it previously had an online session", async () => {
  const f = fixture();
  const deviceId = f.online();
  f.pairing.revoke(deviceId);
  await assert.rejects(f.commands.execute({ deviceId, action: "device.status_get" }),
    error => error.code === "DEVICE_REVOKED");
  assert.equal(f.commandStore.records.size, 0);
});

test("only explicitly registered status and Reminder Draft actions are accepted", async () => {
  const f = fixture();
  const deviceId = f.online();
  for (const action of ["device.app_control", "notification.read"]) {
    await assert.rejects(f.commands.execute({ deviceId, action }),
      error => error.code === "DEVICE_ACTION_UNSUPPORTED");
  }
  assert.equal(f.commandStore.records.size, 0);
});

test("Reminder Draft payload crosses protocol but is never retained by Command Store", async () => {
  const transport = new FakeDeviceTransport({ draftId: "opaque-draft-1" });
  const f = fixture({ transport });
  const input = Object.freeze({
    deviceId: f.online(),
    action: "reminder.draft_create",
    payload: Object.freeze({ title: "Call Alice", time: "2026-07-23T09:30:00.000Z" })
  });
  const result = await f.commands.execute(input);
  assert.deepEqual(result.response.result, { draftId: "opaque-draft-1", status: "created" });
  assert.deepEqual(transport.requests[0].payload, input.payload);
  assert.deepEqual(input.payload, { title: "Call Alice", time: "2026-07-23T09:30:00.000Z" });
  assert.doesNotMatch(JSON.stringify(f.commandStore.records.get("command-1")), /Call Alice|2026-07-23|payload|response/);
});

test("Command Service rejects action-specific payload shape before command creation", async () => {
  const f = fixture();
  const deviceId = f.online();
  const invalid = [
    { deviceId, action: "device.status_get", payload: { unexpected: true } },
    { deviceId, action: "reminder.draft_create" },
    { deviceId, action: "reminder.draft_create", payload: { title: " Call", time: "2026-07-23T09:30:00.000Z" } },
    { deviceId, action: "reminder.draft_create", payload: { title: "Call", time: "not-a-time" } },
    { deviceId, action: "reminder.draft_create", payload: {
      title: "Call", time: "2026-07-23T09:30:00.000Z", notification: true
    } }
  ];
  for (const input of invalid) {
    await assert.rejects(f.commands.execute(input), error => error.code === "DEVICE_COMMAND_INVALID");
  }
  assert.equal(f.commandStore.records.size, 0);
});

test("unanswered command times out and transitions to failed", async () => {
  const transport = { send() { return new Promise(() => {}); } };
  const f = fixture({ transport, timeoutMs: 5 });
  const deviceId = f.online();
  await assert.rejects(f.commands.execute({ deviceId, action: "device.status_get" }),
    error => error.code === "DEVICE_COMMAND_TIMEOUT");
  assert.equal(f.commandStore.get("command-1").status, "failed");
  assert.equal(f.commandStore.get("command-1").completedAt, "2026-07-21T12:00:00.000Z");
});

test("invalid or uncorrelated response fails Device Protocol validation", async () => {
  const invalidResponses = [
    { requestId: "wrong-request", success: true, result: {}, errorCode: null },
    { requestId: "request-1", success: true, result: { batteryLevel: Infinity }, errorCode: null },
    { requestId: "request-1", success: false, result: null, errorCode: null }
  ];
  for (const response of invalidResponses) {
    const f = fixture({ transport: { async send() { return response; } } });
    const deviceId = f.online();
    await assert.rejects(f.commands.execute({ deviceId, action: "device.status_get" }),
      error => error.code === "DEVICE_RESPONSE_INVALID");
    assert.equal(f.commandStore.get("command-1").status, "failed");
  }
});

test("command input is immutable and store never retains payload or Device response", async () => {
  const f = fixture({
    transport: { async send(request) {
      return {
        requestId: request.requestId,
        success: true,
        result: { online: true, token: "must-not-be-retained", nested: { password: "hidden" } },
        errorCode: null
      };
    } }
  });
  const input = Object.freeze({ deviceId: f.online(), action: "device.status_get" });
  const before = structuredClone(input);
  const result = await f.commands.execute(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.response.result, { online: true, nested: {} });
  const stored = f.commandStore.records.get("command-1");
  assert.deepEqual(Object.keys(stored).sort(),
    ["action", "commandId", "completedAt", "createdAt", "deviceId", "status"].sort());
  assert.doesNotMatch(JSON.stringify(stored), /payload|result|response|must-not-be-retained|hidden/i);
});

test("Command prototype stays outside forbidden capabilities and persistence boundaries", () => {
  const backendSource = ["device-command-store.js", "device-command-service.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(backendSource, /notification|app.?control|accessibility|\badb\b|Memory|StateStore|EventStore|MCP|fetch\(|https?:/i);
  assert.doesNotMatch(backendSource, /console\.|\.write\(/i);

  const androidSource = fs.readFileSync(path.join(__dirname, "..", "android-companion", "app", "src", "main",
    "java", "com", "dylanheartbeat", "companion", "DeviceCommandClient.kt"), "utf8");
  assert.doesNotMatch(androidSource, /notification|app.?control|accessibility|\badb\b|HttpURLConnection|android\./i);
  assert.match(androidSource, /DeviceActions\.STATUS_GET/);
  assert.match(androidSource, /DeviceActions\.REMINDER_DRAFT_CREATE/);
});
