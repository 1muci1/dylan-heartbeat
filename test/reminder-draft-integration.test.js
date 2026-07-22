"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
const { FakeDeviceTransport } = require("../fake-device-transport");
const { ToolApprovalStore } = require("../tool-approval-store");
const { ToolAuditStore } = require("../tool-audit-store");
const { ToolExecutionGateway } = require("../tool-execution-gateway");
const { ToolProviderRegistry } = require("../tool-provider-registry");
const { ToolRegistry } = require("../tool-registry");

const TOOL_NAME = "android.reminder.draft_create";
const TOOL_DEFINITION = Object.freeze({
  name: TOOL_NAME,
  description: "Create a reminder draft in the paired Android Companion for user review.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      time: { type: "string", minLength: 1, maxLength: 40 }
    },
    required: ["title", "time"],
    additionalProperties: false
  },
  permissionLevel: "user_confirm",
  executionType: "device_bridge"
});

function fixture({ connect = true, transport = new FakeDeviceTransport({ draftId: "opaque-draft-1" }) } = {}) {
  let now = new Date("2026-07-22T12:00:00Z");
  const identityStore = new DeviceIdentityStore();
  const pairing = new DevicePairingService({
    store: identityStore,
    idFactory: () => "device-1",
    tokenFactory: () => "transient-pairing-value",
    clock: () => now
  });
  const pendingDevice = pairing.createPairingRequest({ deviceName: "Pixel", platform: "android" });
  pairing.confirmPairing({ deviceId: pendingDevice.device.deviceId, pairingToken: pendingDevice.pairingToken });
  const deviceId = pendingDevice.device.deviceId;
  const sessionStore = new DeviceSessionStore();
  const sessionService = new DeviceSessionService({
    identityStore, sessionStore, sessionIdFactory: () => "session-1", clock: () => now
  });
  if (connect) sessionService.connect({ deviceId });
  const commandStore = new DeviceCommandStore();
  const commandService = new DeviceCommandService({
    identityStore,
    sessionService,
    commandStore,
    transport,
    protocol: new DeviceBridgeProtocol({ idFactory: () => "request-1", clock: () => now }),
    commandIdFactory: () => "command-1",
    clock: () => now
  });
  const provider = new AndroidDeviceProvider({
    deviceId,
    authorizationGateway: new DeviceAuthorizationGateway({ identityStore }),
    commandService,
    clock: () => now
  });
  const approvals = new ToolApprovalStore({ clock: () => now, idFactory: () => "approval-1" });
  const auditEvents = [];
  const auditStore = new ToolAuditStore({
    eventStore: {
      create(event, context) {
        auditEvents.push(structuredClone({ event, context }));
        return { ...event, payload: event.payload };
      }
    }
  });
  const gateway = new ToolExecutionGateway({
    registry: new ToolRegistry({ definitions: [TOOL_DEFINITION] }),
    providerRegistry: new ToolProviderRegistry({ providers: [provider] }),
    approvalStore: approvals,
    auditStore
  });
  return { approvals, auditEvents, commandStore, deviceId, gateway, pairing, transport,
    advance(ms) { now = new Date(now.getTime() + ms); } };
}

async function approveAndExecute(f, input) {
  const pending = await f.gateway.execute({ toolName: TOOL_NAME, input });
  f.approvals.approve(pending.approval.id);
  return {
    approvalId: pending.approval.id,
    result: await f.gateway.execute({ toolName: TOOL_NAME, input, approvalId: pending.approval.id })
  };
}

test("approved online Reminder Draft completes the full Tool and Device Command chain", async () => {
  const f = fixture();
  const input = Object.freeze({ title: "  Call Alice  ", time: "2026-07-23T09:30:00+08:00" });
  const { approvalId, result } = await approveAndExecute(f, input);
  assert.deepEqual(result, {
    success: true,
    toolName: TOOL_NAME,
    output: {
      success: true,
      data: { draftId: "opaque-draft-1", status: "created" },
      metadata: { truncated: false }
    }
  });
  assert.equal(f.commandStore.get("command-1").status, "completed");
  assert.deepEqual(f.transport.requests[0].payload,
    { title: "Call Alice", time: "2026-07-23T01:30:00.000Z" });
  assert.deepEqual(input, { title: "  Call Alice  ", time: "2026-07-23T09:30:00+08:00" });
  assert.deepEqual(f.auditEvents.map(item => item.event.eventType),
    ["tool.requested", "tool.approved", "tool.completed"]);
  assert.doesNotMatch(JSON.stringify(f.auditEvents), /Call Alice|2026-07-23|approval-1|session-1/);
  assert.doesNotMatch(JSON.stringify(f.commandStore.records.get("command-1")), /Call Alice|2026-07-23|payload|response/);

  await assert.rejects(f.gateway.execute({ toolName: TOOL_NAME, input, approvalId }),
    error => error.code === "TOOL_APPROVAL_ALREADY_USED");
  assert.equal(f.transport.requests.length, 1);
});

test("missing, rejected, expired, or mismatched Approval never creates a command", async () => {
  const input = { title: "Call Alice", time: "2026-07-23T09:30:00Z" };

  const missing = fixture();
  await assert.rejects(missing.gateway.execute({ toolName: TOOL_NAME, input, approvalId: "missing" }),
    error => error.code === "TOOL_PERMISSION_DENIED");
  assert.equal(missing.commandStore.records.size, 0);

  const rejected = fixture();
  const rejectedPending = await rejected.gateway.execute({ toolName: TOOL_NAME, input });
  rejected.approvals.reject(rejectedPending.approval.id);
  await assert.rejects(rejected.gateway.execute({ toolName: TOOL_NAME, input, approvalId: rejectedPending.approval.id }),
    error => error.code === "TOOL_PERMISSION_DENIED");
  assert.equal(rejected.commandStore.records.size, 0);

  const expired = fixture();
  const expiredPending = await expired.gateway.execute({ toolName: TOOL_NAME, input });
  expired.advance(5 * 60 * 1000);
  await assert.rejects(expired.gateway.execute({ toolName: TOOL_NAME, input, approvalId: expiredPending.approval.id }),
    error => error.code === "TOOL_PERMISSION_DENIED");
  assert.equal(expired.commandStore.records.size, 0);

  const mismatched = fixture();
  const pending = await mismatched.gateway.execute({ toolName: TOOL_NAME, input });
  mismatched.approvals.approve(pending.approval.id);
  await assert.rejects(mismatched.gateway.execute({
    toolName: TOOL_NAME,
    input: { ...input, title: "Different" },
    approvalId: pending.approval.id
  }), error => error.code === "TOOL_PERMISSION_DENIED");
  assert.equal(mismatched.commandStore.records.size, 0);
});

test("offline and revoked Device fail without a fake draft fallback", async () => {
  const input = { title: "Call Alice", time: "2026-07-23T09:30:00Z" };
  const offline = fixture({ connect: false });
  const offlinePending = await offline.gateway.execute({ toolName: TOOL_NAME, input });
  offline.approvals.approve(offlinePending.approval.id);
  await assert.rejects(offline.gateway.execute({ toolName: TOOL_NAME, input, approvalId: offlinePending.approval.id }),
    error => error.code === "TOOL_PROVIDER_EXECUTION_FAILED");
  assert.equal(offline.commandStore.records.size, 0);

  const revoked = fixture();
  revoked.pairing.revoke(revoked.deviceId);
  const revokedPending = await revoked.gateway.execute({ toolName: TOOL_NAME, input });
  revoked.approvals.approve(revokedPending.approval.id);
  await assert.rejects(revoked.gateway.execute({ toolName: TOOL_NAME, input, approvalId: revokedPending.approval.id }),
    error => error.code === "TOOL_PROVIDER_EXECUTION_FAILED");
  assert.equal(revoked.commandStore.records.size, 0);
});

test("Reminder Draft implementation adds no phone-control capability or Android permission", () => {
  const sources = [
    "android-device-tools.js",
    "android-device-provider.js",
    "device-command-service.js",
    "android-companion/app/src/main/java/com/dylanheartbeat/companion/DeviceCommandClient.kt",
    "android-companion/app/src/main/java/com/dylanheartbeat/companion/FakeDeviceTransport.kt"
  ].map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /NotificationManager|NotificationListener|AccessibilityService|AlarmManager|CalendarContract|\badb\b|startService|startActivity/i);
  const manifest = fs.readFileSync(path.join(__dirname, "..", "android-companion", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  assert.deepEqual([...manifest.matchAll(/uses-permission[^>]+android:name="([^"]+)"/g)].map(match => match[1]),
    ["android.permission.INTERNET"]);
});
