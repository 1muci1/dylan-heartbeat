"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DeviceBridge, assertDeviceBridge } = require("../device-bridge");
const { FakeDeviceBridge } = require("../fake-device-bridge");

test("Device Bridge interface requires status and reminder operations", () => {
  const bridge = new FakeDeviceBridge();
  assert.equal(assertDeviceBridge(bridge), bridge);
  for (const value of [null, {}, { getStatus() {} }, { createReminderDraft() {} }]) {
    assert.throws(() => assertDeviceBridge(value), error => error.code === "DEVICE_BRIDGE_UNAVAILABLE");
  }
});

test("base Device Bridge explicitly fails unimplemented operations", async () => {
  const bridge = new DeviceBridge();
  assertDeviceBridge(bridge);
  await assert.rejects(bridge.getStatus(), error => error.code === "DEVICE_OPERATION_FAILED");
  await assert.rejects(bridge.createReminderDraft({}), error => error.code === "DEVICE_OPERATION_FAILED");
});

test("FakeDeviceBridge returns fixed status and reminder results without mutating input", async () => {
  const bridge = new FakeDeviceBridge({
    status: { batteryLevelBucket: "high", online: true, appForeground: true }, draftId: "draft-fixed"
  });
  assert.deepEqual(await bridge.getStatus(), { batteryLevelBucket: "high", online: true, appForeground: true });
  const input = { title: "Call Alice", time: "2026-07-21T09:30:00.000Z" }, before = structuredClone(input);
  assert.deepEqual(await bridge.createReminderDraft(input), { draftId: "draft-fixed", status: "created" });
  assert.deepEqual(input, before);
  assert.deepEqual(bridge.calls, [
    { operation: "getStatus" },
    { operation: "createReminderDraft", input: before }
  ]);
});

test("unavailable FakeDeviceBridge fails both operations safely", async () => {
  const bridge = new FakeDeviceBridge({ available: false });
  await assert.rejects(bridge.getStatus(), error => error.code === "DEVICE_BRIDGE_UNAVAILABLE");
  await assert.rejects(bridge.createReminderDraft({}), error => error.code === "DEVICE_BRIDGE_UNAVAILABLE");
  assert.deepEqual(bridge.calls, []);
});

test("Bridge modules have no Android, adb, network, MCP, model, Event, Memory, State, database, or migration dependency", () => {
  const source = ["device-bridge.js", "fake-device-bridge.js"]
    .map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /android api|android sdk|adb|fetch\(|https?:|socket|MCP|model|EventStore|memoryStore|StateStore|database|migration/i);
  assert.doesNotMatch(source, /\.create\(|\.set\(|\.write\(/i);
});
