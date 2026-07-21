"use strict";

const DEFAULT_DEVICE_ACTIONS = Object.freeze(["device.status_get", "reminder.draft_create"]);

class DeviceAuthorizationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DeviceAuthorizationError";
    this.code = code;
  }
}

class DeviceAuthorizationGateway {
  constructor({ identityStore, allowedActions = DEFAULT_DEVICE_ACTIONS } = {}) {
    if (!identityStore || typeof identityStore.get !== "function" ||
        !Array.isArray(allowedActions) || allowedActions.some(action => typeof action !== "string" || !action)) {
      throw new TypeError("Device Authorization Gateway 配置无效");
    }
    this.identityStore = identityStore;
    this.allowedActions = new Set(allowedActions);
  }

  authorize(deviceId, action) {
    const device = typeof deviceId === "string" && deviceId ? this.identityStore.get(deviceId) : null;
    if (!device || device.status !== "paired") {
      throw new DeviceAuthorizationError("Device 未授权", "DEVICE_NOT_AUTHORIZED");
    }
    if (typeof action !== "string" || !this.allowedActions.has(action)) {
      throw new DeviceAuthorizationError("Device action 不允许", "DEVICE_ACTION_NOT_ALLOWED");
    }
    return Object.freeze({ authorized: true, deviceId: device.deviceId, action });
  }
}

module.exports = {
  DEFAULT_DEVICE_ACTIONS,
  DeviceAuthorizationError,
  DeviceAuthorizationGateway
};
