"use strict";

const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { test } = require("node:test");
const { DeviceIdentityStore } = require("../device-identity-store");
const { DevicePairingService, hashToken } = require("../device-pairing-service");
const { registerDevicePairingRoutes } = require("../device-pairing-routes");

function fixture() {
  let id = 0;
  const app = Fastify({ logger: false });
  const store = new DeviceIdentityStore();
  const service = new DevicePairingService({
    store,
    idFactory: () => `device-${++id}`,
    tokenFactory: () => `single-use-token-${id}`,
    clock: () => new Date("2026-07-20T12:00:00Z")
  });
  registerDevicePairingRoutes(app, { pairingService: service });
  return { app, service, store };
}

async function create(f) {
  return f.app.inject({
    method: "POST", url: "/api/v1/devices/pairing",
    payload: { deviceName: "Pixel Companion", platform: "android" }
  });
}

test("creates pairing without GATEWAY_API_KEY and returns plaintext token once", async t => {
  const f = fixture(); t.after(() => f.app.close());
  const response = await create(f);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), {
    pairingId: "device-1", pairingToken: "single-use-token-1", status: "pending"
  });
  assert.equal(response.headers["www-authenticate"], undefined);
  assert.deepEqual(f.store.get("device-1"), {
    deviceId: "device-1", deviceName: "Pixel Companion", platform: "android",
    status: "pending", createdAt: "2026-07-20T12:00:00.000Z"
  });
  const internal = f.store.records.get("device-1");
  assert.equal(internal.tokenHash, hashToken("single-use-token-1"));
  assert.doesNotMatch(JSON.stringify(internal), /single-use-token-1/);
});

test("confirms pairing and returns only Device ID and paired status", async t => {
  const f = fixture(); t.after(() => f.app.close());
  const created = (await create(f)).json();
  const response = await f.app.inject({
    method: "POST", url: `/api/v1/devices/pairing/${created.pairingId}/confirm`,
    payload: { pairingToken: created.pairingToken }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { deviceId: "device-1", status: "paired" });
  assert.equal(f.store.get("device-1").status, "paired");
  assert.equal(f.store.records.get("device-1").tokenHash, undefined);
});

test("invalid token is rejected and pending state remains unchanged", async t => {
  const f = fixture(); t.after(() => f.app.close());
  const created = (await create(f)).json();
  const response = await f.app.inject({
    method: "POST", url: `/api/v1/devices/pairing/${created.pairingId}/confirm`,
    payload: { pairingToken: "wrong-token" }
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "DEVICE_PAIRING_TOKEN_INVALID");
  assert.doesNotMatch(JSON.stringify(response.json()), /wrong-token|single-use-token|[a-f0-9]{64}/i);
  assert.equal(f.store.get(created.pairingId).status, "pending");
});

test("used pairing token cannot confirm a second time", async t => {
  const f = fixture(); t.after(() => f.app.close());
  const created = (await create(f)).json();
  const request = {
    method: "POST", url: `/api/v1/devices/pairing/${created.pairingId}/confirm`,
    payload: { pairingToken: created.pairingToken }
  };
  assert.equal((await f.app.inject(request)).statusCode, 200);
  const reused = await f.app.inject(request);
  assert.equal(reused.statusCode, 409);
  assert.equal(reused.json().error.code, "DEVICE_PAIRING_TOKEN_USED");
});

test("revoked Device cannot be paired again", async t => {
  const f = fixture(); t.after(() => f.app.close());
  const created = (await create(f)).json();
  await f.app.inject({
    method: "POST", url: `/api/v1/devices/pairing/${created.pairingId}/confirm`,
    payload: { pairingToken: created.pairingToken }
  });
  f.service.revoke(created.pairingId);
  const response = await f.app.inject({
    method: "POST", url: `/api/v1/devices/pairing/${created.pairingId}/confirm`,
    payload: { pairingToken: created.pairingToken }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "DEVICE_REVOKED");
  assert.equal(f.store.get(created.pairingId).status, "revoked");
});

test("route rejects extra fields and never exposes Identity Store", async t => {
  const f = fixture(); t.after(() => f.app.close());
  const response = await f.app.inject({
    method: "POST", url: "/api/v1/devices/pairing",
    payload: { deviceName: "Pixel", platform: "android", deviceId: "caller-id" }
  });
  assert.equal(response.statusCode, 400);
  assert.doesNotMatch(JSON.stringify(response.json()), /records|tokenHash|createdAt/);
});
