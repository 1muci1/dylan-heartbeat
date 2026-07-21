"use strict";

const { DeviceBridge, DeviceBridgeError } = require("./device-bridge");

class FakeDeviceBridge extends DeviceBridge {
  constructor({ status = {}, draftId = "fake-draft-1", available = true } = {}) {
    super();
    const batteryLevelBucket = status.batteryLevelBucket ?? "medium";
    if (!new Set(["low", "medium", "high", "unknown"]).has(batteryLevelBucket) ||
        (status.online != null && typeof status.online !== "boolean") ||
        (status.appForeground != null && typeof status.appForeground !== "boolean") ||
        typeof draftId !== "string" || !draftId.trim() || typeof available !== "boolean") {
      throw new TypeError("Fake Device Bridge 配置无效");
    }
    this.status = Object.freeze({ batteryLevelBucket, online: status.online ?? true, appForeground: status.appForeground ?? false });
    this.draftId = draftId.trim();
    this.available = available;
    this.calls = [];
  }

  checkAvailable() {
    if (!this.available) throw new DeviceBridgeError("Device Bridge 不可用", "DEVICE_BRIDGE_UNAVAILABLE");
  }

  async getStatus() {
    this.checkAvailable();
    this.calls.push({ operation: "getStatus" });
    return { ...this.status };
  }

  async createReminderDraft(input) {
    this.checkAvailable();
    this.calls.push({ operation: "createReminderDraft", input: structuredClone(input) });
    return { draftId: this.draftId, status: "created" };
  }
}

module.exports = { FakeDeviceBridge };
