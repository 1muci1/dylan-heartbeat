"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DeviceIdentityStore } = require("../device-identity-store");
const { DevicePairingService, hashToken } = require("../device-pairing-service");

function fixture() {
  let id = 0;
  const store = new DeviceIdentityStore();
  const service = new DevicePairingService({
    store,
    idFactory: () => `device-${++id}`,
    tokenFactory: () => `one-time-token-${id}`,
    clock: () => new Date("2026-07-20T12:00:00Z")
  });
  return { service, store };
}

test("creates a pending Android pairing with a system-generated Device ID", () => {
  const { service } = fixture();
  const result = service.createPairingRequest({ deviceName: "Pixel Companion", platform: "android" });
  assert.deepEqual(result, {
    device: {
      deviceId: "device-1", deviceName: "Pixel Companion", platform: "android",
      status: "pending", createdAt: "2026-07-20T12:00:00.000Z"
    },
    pairingToken: "one-time-token-1"
  });
  assert.throws(() => service.createPairingRequest({
    deviceId: "caller-device", deviceName: "Pixel", platform: "android"
  }), error => error.code === "DEVICE_PAIRING_INVALID");
});

test("Store retains only a token hash and never exposes it through identity reads", () => {
  const { service, store } = fixture();
  const result = service.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  const internal = store.records.get(result.device.deviceId);
  assert.equal(internal.tokenHash, hashToken(result.pairingToken));
  assert.notEqual(internal.tokenHash, result.pairingToken);
  assert.doesNotMatch(JSON.stringify(store.get(result.device.deviceId)), /token|hash|one-time/i);
  assert.doesNotMatch(JSON.stringify(store.list()), /token|hash|one-time/i);
});

test("correct one-time token confirms pairing and removes its hash", () => {
  const { service, store } = fixture();
  const pending = service.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  const paired = service.confirmPairing({ deviceId: pending.device.deviceId, pairingToken: pending.pairingToken });
  assert.equal(paired.status, "paired");
  assert.equal(store.records.get(paired.deviceId).tokenHash, undefined);
  assert.equal(service.assertDeviceCanRequest(paired.deviceId).status, "paired");
});

test("wrong pairing token is rejected without changing pending state", () => {
  const { service, store } = fixture();
  const pending = service.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  assert.throws(() => service.confirmPairing({ deviceId: pending.device.deviceId, pairingToken: "wrong" }),
    error => error.code === "DEVICE_PAIRING_TOKEN_INVALID");
  assert.equal(store.get(pending.device.deviceId).status, "pending");
});

test("paired Device can be revoked idempotently and then cannot make Bridge requests", () => {
  const { service } = fixture();
  const pending = service.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  service.confirmPairing({ deviceId: pending.device.deviceId, pairingToken: pending.pairingToken });
  assert.equal(service.revoke(pending.device.deviceId).status, "revoked");
  assert.equal(service.revoke(pending.device.deviceId).status, "revoked");
  assert.throws(() => service.assertDeviceCanRequest(pending.device.deviceId), error => error.code === "DEVICE_REVOKED");
});

test("pending Device cannot make Bridge requests or be revoked", () => {
  const { service } = fixture();
  const pending = service.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  assert.throws(() => service.assertDeviceCanRequest(pending.device.deviceId), error => error.code === "DEVICE_NOT_PAIRED");
  assert.throws(() => service.revoke(pending.device.deviceId), error => error.code === "DEVICE_NOT_PAIRED");
});

test("pairing operations do not mutate caller input", () => {
  const { service } = fixture();
  const input = { deviceName: "Pixel", platform: "android" }, before = structuredClone(input);
  const pending = service.createPairingRequest(input);
  assert.deepEqual(input, before);
  const confirm = { deviceId: pending.device.deviceId, pairingToken: pending.pairingToken };
  const confirmBefore = structuredClone(confirm);
  service.confirmPairing(confirm);
  assert.deepEqual(confirm, confirmBefore);
});

test("errors and public results do not leak pairing tokens or hashes", () => {
  const { service } = fixture();
  const pending = service.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  assert.throws(() => service.confirmPairing({ deviceId: pending.device.deviceId, pairingToken: "super-secret-wrong" }), error => {
    assert.doesNotMatch(`${error.message} ${error.stack?.split("\n")[0]}`, /super-secret-wrong|one-time-token|[a-f0-9]{64}/i);
    return true;
  });
});

test("identity and pairing modules have no Android, adb, network, database, MCP, model, Event, Memory, State, or migration dependency", () => {
  const source = ["device-identity-store.js", "device-pairing-service.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /android studio|android api|adb|fetch\(|https?:|socket|database|MCP|model|EventStore|memoryStore|StateStore|migration/i);
  assert.doesNotMatch(source, /console\.|\.write\(/i);
});
