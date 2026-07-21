"use strict";

class DeviceBridgeError extends Error {
  constructor(message, code = "DEVICE_BRIDGE_UNAVAILABLE") {
    super(message);
    this.name = "DeviceBridgeError";
    this.code = code;
  }
}

function assertDeviceBridge(bridge) {
  if (!bridge || typeof bridge !== "object" || Array.isArray(bridge)) {
    throw new DeviceBridgeError("Device Bridge 不可用");
  }
  for (const method of ["getStatus", "createReminderDraft"]) {
    if (typeof bridge[method] !== "function") throw new DeviceBridgeError(`Device Bridge.${method} 不可用`);
  }
  return bridge;
}

class DeviceBridge {
  async getStatus() {
    throw new DeviceBridgeError("getStatus 未实现", "DEVICE_OPERATION_FAILED");
  }

  async createReminderDraft(_input) {
    throw new DeviceBridgeError("createReminderDraft 未实现", "DEVICE_OPERATION_FAILED");
  }
}

module.exports = { DeviceBridge, DeviceBridgeError, assertDeviceBridge };
