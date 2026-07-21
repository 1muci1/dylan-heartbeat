"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DeviceIdentityStore } = require("../device-identity-store");
const { DevicePairingService } = require("../device-pairing-service");
const { DeviceSessionStore } = require("../device-session-store");
const { DeviceSessionService } = require("../device-session-service");

function fixture() {
  let deviceSequence = 0;
  let sessionSequence = 0;
  let now = new Date("2026-07-21T10:00:00Z");
  const identityStore = new DeviceIdentityStore();
  const pairing = new DevicePairingService({
    store: identityStore,
    idFactory: () => `device-${++deviceSequence}`,
    tokenFactory: () => `pairing-credential-${deviceSequence}`,
    clock: () => now
  });
  const sessionStore = new DeviceSessionStore();
  const sessions = new DeviceSessionService({
    identityStore,
    sessionStore,
    sessionIdFactory: () => `random-session-${++sessionSequence}`,
    clock: () => now,
    sessionTtlMs: 60_000
  });
  const create = () => pairing.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  const pair = () => {
    const request = create();
    pairing.confirmPairing({ deviceId: request.device.deviceId, pairingToken: request.pairingToken });
    return request.device.deviceId;
  };
  return { create, identityStore, pair, pairing, sessionStore, sessions,
    advance(ms) { now = new Date(now.getTime() + ms); } };
}

test("paired Device connects with a generated session ID and online session timestamps", () => {
  const f = fixture();
  const deviceId = f.pair();
  const session = f.sessions.connect({ deviceId });
  assert.deepEqual(session, {
    sessionId: "random-session-1",
    deviceId,
    connectedAt: "2026-07-21T10:00:00.000Z",
    lastHeartbeatAt: "2026-07-21T10:00:00.000Z"
  });
  assert(Object.isFrozen(session));
  assert.doesNotMatch(JSON.stringify(session), /token|credential|secret/i);
});

test("pending Device is rejected", () => {
  const f = fixture();
  const pending = f.create();
  assert.throws(() => f.sessions.connect({ deviceId: pending.device.deviceId }),
    error => error.code === "DEVICE_NOT_PAIRED");
  assert.equal(f.sessionStore.records.size, 0);
});

test("revoked Device is rejected and a revoked active session cannot heartbeat", () => {
  const f = fixture();
  const deviceId = f.pair();
  f.pairing.revoke(deviceId);
  assert.throws(() => f.sessions.connect({ deviceId }), error => error.code === "DEVICE_REVOKED");

  const secondDeviceId = f.pair();
  const session = f.sessions.connect({ deviceId: secondDeviceId });
  f.pairing.revoke(secondDeviceId);
  assert.throws(() => f.sessions.heartbeat({ sessionId: session.sessionId }),
    error => error.code === "DEVICE_REVOKED");
  assert.equal(f.sessionStore.get(session.sessionId), null);
});

test("heartbeat updates only lastHeartbeatAt", () => {
  const f = fixture();
  const session = f.sessions.connect({ deviceId: f.pair() });
  f.advance(25_000);
  const updated = f.sessions.heartbeat({ sessionId: session.sessionId });
  assert.equal(updated.sessionId, session.sessionId);
  assert.equal(updated.deviceId, session.deviceId);
  assert.equal(updated.connectedAt, session.connectedAt);
  assert.equal(updated.lastHeartbeatAt, "2026-07-21T10:00:25.000Z");
});

test("expired session automatically becomes invalid and is removed", () => {
  const f = fixture();
  const session = f.sessions.connect({ deviceId: f.pair() });
  f.advance(60_000);
  assert.throws(() => f.sessions.heartbeat({ sessionId: session.sessionId }),
    error => error.code === "DEVICE_SESSION_EXPIRED");
  assert.equal(f.sessionStore.get(session.sessionId), null);
  assert.throws(() => f.sessions.disconnect({ sessionId: session.sessionId }),
    error => error.code === "DEVICE_SESSION_NOT_FOUND");
});

test("disconnect makes a session offline and cannot be repeated as an active session", () => {
  const f = fixture();
  const session = f.sessions.connect({ deviceId: f.pair() });
  assert.deepEqual(f.sessions.disconnect({ sessionId: session.sessionId }), session);
  assert.equal(f.sessionStore.get(session.sessionId), null);
  assert.throws(() => f.sessions.heartbeat({ sessionId: session.sessionId }),
    error => error.code === "DEVICE_SESSION_NOT_FOUND");
});

test("connect, heartbeat, and disconnect do not mutate caller input", () => {
  const f = fixture();
  const connectInput = Object.freeze({ deviceId: f.pair() });
  const session = f.sessions.connect(connectInput);
  assert.deepEqual(connectInput, { deviceId: session.deviceId });

  f.advance(1_000);
  const heartbeatInput = Object.freeze({ sessionId: session.sessionId });
  f.sessions.heartbeat(heartbeatInput);
  assert.deepEqual(heartbeatInput, { sessionId: session.sessionId });

  const disconnectInput = Object.freeze({ sessionId: session.sessionId });
  f.sessions.disconnect(disconnectInput);
  assert.deepEqual(disconnectInput, { sessionId: session.sessionId });
});

test("session modules stay isolated from credentials and forbidden runtime boundaries", () => {
  const backendSource = ["device-session-store.js", "device-session-service.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(backendSource, /pairing.?token|bearer|prompt|chat|Memory|StateStore|model|MCP|fetch\(|https?:|socket|android api|adb/i);
  assert.doesNotMatch(backendSource, /console\.|\.write\(/i);

  const androidSource = fs.readFileSync(path.join(__dirname, "..", "android-companion", "app", "src", "main",
    "java", "com", "dylanheartbeat", "companion", "DeviceSessionClient.kt"), "utf8");
  assert.doesNotMatch(androidSource, /pairing.?token|bearer|HttpURLConnection|android\.|accessibility|notification|tool/i);
  assert.match(androidSource, /fun connect\(/);
  assert.match(androidSource, /fun heartbeat\(/);
  assert.match(androidSource, /fun disconnect\(/);
});
