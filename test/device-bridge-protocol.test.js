"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DeviceBridgeProtocol, sanitizeJson, validateRequest } = require("../device-bridge-protocol");
const { FakeDeviceTransport } = require("../fake-device-transport");

function protocol() {
  let id = 0;
  return new DeviceBridgeProtocol({
    idFactory: () => `request-${++id}`,
    clock: () => new Date("2026-07-20T12:00:00Z")
  });
}

test("Protocol creates canonical requests with unique request IDs", () => {
  const p = protocol();
  const first = p.createRequest({ deviceId: "android-1", action: "device.status_get", payload: {} });
  const second = p.createRequest({ deviceId: "android-1", action: "device.status_get", payload: {} });
  assert.deepEqual(first, {
    requestId: "request-1", deviceId: "android-1", action: "device.status_get",
    payload: {}, timestamp: "2026-07-20T12:00:00.000Z"
  });
  assert.notEqual(first.requestId, second.requestId);

  const duplicate = new DeviceBridgeProtocol({ idFactory: () => "same", clock: () => new Date() });
  duplicate.createRequest({ deviceId: "android-1", action: "device.status_get" });
  assert.throws(() => duplicate.createRequest({ deviceId: "android-1", action: "device.status_get" }),
    error => error.code === "DEVICE_PROTOCOL_INVALID");
});

test("Protocol accepts only whitelisted actions", () => {
  const p = protocol();
  p.createRequest({ deviceId: "android-1", action: "reminder.draft_create", payload: { title: "Call", time: "09:00" } });
  for (const action of ["device.delete", "", null]) {
    assert.throws(() => p.createRequest({ deviceId: "android-1", action }),
      error => error.code === "DEVICE_ACTION_UNSUPPORTED");
  }
});

test("Protocol rejects non JSON-safe and cyclic payloads without modifying input", () => {
  const p = protocol();
  for (const payload of [{ value: undefined }, { value: Infinity }, { value: 1n }, { value() {} }, new Date()]) {
    assert.throws(() => p.createRequest({ deviceId: "android-1", action: "device.status_get", payload }),
      error => error.code === "DEVICE_PROTOCOL_INVALID");
  }
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => p.createRequest({ deviceId: "android-1", action: "device.status_get", payload: cyclic }),
    error => error.code === "DEVICE_PROTOCOL_INVALID");
});

test("Sensitive fields are recursively filtered from payloads and responses", () => {
  const input = { title: "Safe", token: "hidden", nested: { password: "hidden", value: 1 }, items: [{ secret: "hidden", ok: true }] };
  const before = structuredClone(input);
  assert.deepEqual(sanitizeJson(input), { title: "Safe", nested: { value: 1 }, items: [{ ok: true }] });
  assert.deepEqual(input, before);
  const p = protocol();
  assert.deepEqual(p.validateResponse({
    requestId: "request-1", success: true, result: { ok: true, stack: "hidden" }, errorCode: null
  }), { requestId: "request-1", success: true, result: { ok: true }, errorCode: null });
});

test("Response validation checks correlation, success shape, and JSON safety", () => {
  const p = protocol();
  assert.deepEqual(p.validateResponse({
    requestId: "request-1", success: false, result: null, errorCode: "DEVICE_OPERATION_FAILED"
  }, { requestId: "request-1" }), {
    requestId: "request-1", success: false, result: null, errorCode: "DEVICE_OPERATION_FAILED"
  });
  const invalid = [
    null,
    { requestId: "wrong", success: true, result: {}, errorCode: null },
    { requestId: "request-1", success: true, result: {}, errorCode: "ERROR" },
    { requestId: "request-1", success: false, result: null, errorCode: null },
    { requestId: "request-1", success: true, result: { value: Infinity }, errorCode: null }
  ];
  for (const response of invalid) {
    assert.throws(() => p.validateResponse(response, { requestId: "request-1" }),
      error => error.code === "DEVICE_RESPONSE_INVALID");
  }
});

test("Fake Transport performs offline roundtrips for both Android actions", async () => {
  const p = protocol();
  const transport = new FakeDeviceTransport({
    status: { batteryLevelBucket: "high", online: true, appForeground: false }, draftId: "draft-1"
  });
  const status = p.createRequest({ deviceId: "android-1", action: "device.status_get" });
  assert.deepEqual(await transport.send(status), {
    requestId: "request-1", success: true,
    result: { batteryLevelBucket: "high", online: true, appForeground: false }, errorCode: null
  });
  const reminder = p.createRequest({
    deviceId: "android-1", action: "reminder.draft_create",
    payload: { title: "Call", time: "2026-07-23T09:00:00.000Z" }
  });
  assert.deepEqual(await transport.send(reminder), {
    requestId: "request-2", success: true, result: { draftId: "draft-1", status: "created" }, errorCode: null
  });
  assert.deepEqual(transport.requests, [status, reminder]);
});

test("Fake Transport isolates simulated execution errors", async () => {
  const p = protocol();
  const transport = new FakeDeviceTransport({ failActions: ["device.status_get"] });
  const request = p.createRequest({ deviceId: "android-1", action: "device.status_get" });
  assert.deepEqual(await transport.send(request), {
    requestId: request.requestId, success: false, result: null, errorCode: "DEVICE_OPERATION_FAILED"
  });
  assert.throws(() => validateRequest({ ...request, action: "device.erase" }),
    error => error.code === "DEVICE_ACTION_UNSUPPORTED");
});

test("Protocol and Fake Transport have no device, network, database, MCP, Event, Memory, State, or migration dependency", () => {
  const source = ["device-bridge-protocol.js", "fake-device-transport.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /android studio|adb|fetch\(|https?:|socket|database|MCP|EventStore|memoryStore|StateStore|migration/i);
  assert.doesNotMatch(source, /\.create\(|\.set\(|\.write\(/i);
});
