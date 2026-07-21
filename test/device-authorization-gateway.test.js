"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DeviceAuthorizationGateway } = require("../device-authorization-gateway");
const { DeviceIdentityStore } = require("../device-identity-store");
const { DevicePairingService } = require("../device-pairing-service");

function fixture() {
  let id = 0;
  const store = new DeviceIdentityStore();
  const pairing = new DevicePairingService({
    store,
    idFactory: () => `device-${++id}`,
    tokenFactory: () => `pairing-token-${id}`,
    clock: () => new Date("2026-07-20T12:00:00Z")
  });
  const gateway = new DeviceAuthorizationGateway({ identityStore: store });
  const create = () => pairing.createPairingRequest({ deviceName: `Device ${id + 1}`, platform: "android" });
  return { create, gateway, pairing, store };
}

function pair(fixtureValue) {
  const request = fixtureValue.create();
  fixtureValue.pairing.confirmPairing({ deviceId: request.device.deviceId, pairingToken: request.pairingToken });
  return request.device.deviceId;
}

test("paired Device is authorized for each default action", () => {
  const f = fixture();
  const deviceId = pair(f);
  assert.deepEqual(f.gateway.authorize(deviceId, "device.status_get"), {
    authorized: true, deviceId, action: "device.status_get"
  });
  assert.deepEqual(f.gateway.authorize(deviceId, "reminder.draft_create"), {
    authorized: true, deviceId, action: "reminder.draft_create"
  });
});

test("pending Device is rejected with DEVICE_NOT_AUTHORIZED", () => {
  const f = fixture();
  const pending = f.create();
  assert.throws(() => f.gateway.authorize(pending.device.deviceId, "device.status_get"),
    error => error.code === "DEVICE_NOT_AUTHORIZED");
});

test("revoked Device is rejected with DEVICE_NOT_AUTHORIZED", () => {
  const f = fixture();
  const deviceId = pair(f);
  f.pairing.revoke(deviceId);
  assert.throws(() => f.gateway.authorize(deviceId, "device.status_get"),
    error => error.code === "DEVICE_NOT_AUTHORIZED");
});

test("unknown action is rejected for a paired Device", () => {
  const f = fixture();
  const deviceId = pair(f);
  for (const action of ["device.erase", "", null]) {
    assert.throws(() => f.gateway.authorize(deviceId, action),
      error => error.code === "DEVICE_ACTION_NOT_ALLOWED");
  }
});

test("unknown Device is rejected without disclosing whether an action exists", () => {
  const f = fixture();
  for (const action of ["device.status_get", "device.erase"]) {
    assert.throws(() => f.gateway.authorize("missing-device", action), error => {
      assert.equal(error.code, "DEVICE_NOT_AUTHORIZED");
      assert.equal(error.message, "Device 未授权");
      assert.doesNotMatch(error.message, /missing-device|status_get|erase|token|hash/i);
      return true;
    });
  }
});

test("authorization does not mutate inputs or Device Identity Store state", () => {
  const f = fixture();
  const deviceId = pair(f);
  const before = structuredClone(f.store.list());
  const input = { deviceId, action: "device.status_get" }, inputBefore = structuredClone(input);
  f.gateway.authorize(input.deviceId, input.action);
  assert.deepEqual(input, inputBefore);
  assert.deepEqual(f.store.list(), before);
});

test("authorization output and errors do not leak identity internals or pairing credentials", () => {
  const f = fixture();
  const deviceId = pair(f);
  const serialized = JSON.stringify(f.gateway.authorize(deviceId, "device.status_get"));
  assert.doesNotMatch(serialized, /deviceName|platform|createdAt|token|hash|password|secret/i);
  assert.equal(Object.hasOwn(f.gateway, "token"), false);
  assert.equal(Object.hasOwn(f.gateway, "pairingToken"), false);
});

test("Gateway requires a read-only identity lookup dependency", () => {
  assert.throws(() => new DeviceAuthorizationGateway(), TypeError);
  assert.throws(() => new DeviceAuthorizationGateway({ identityStore: {} }), TypeError);
  const store = { get() { return { deviceId: "d", status: "paired" }; } };
  assert.doesNotThrow(() => new DeviceAuthorizationGateway({ identityStore: store }));
});

test("authorization module has no token, network, database, MCP, model, Event, Memory, State, or migration access", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "device-authorization-gateway.js"), "utf8");
  assert.doesNotMatch(source, /token|password|secret|hash|android api|adb|fetch\(|https?:|socket|database|MCP|model|EventStore|memoryStore|StateStore|migration/i);
  assert.doesNotMatch(source, /\.create\(|\.setStatus\(|\.write\(|\.records/);
});
