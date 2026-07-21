"use strict";

const { randomUUID } = require("node:crypto");

const DEVICE_ACTIONS = Object.freeze(["device.status_get", "reminder.draft_create"]);
const ACTION_SET = new Set(DEVICE_ACTIONS);
const SENSITIVE_KEYS = new Set(["token", "password", "secret", "stack"]);

class DeviceProtocolError extends Error {
  constructor(message, code = "DEVICE_PROTOCOL_INVALID") {
    super(message);
    this.name = "DeviceProtocolError";
    this.code = code;
  }
}

function safeKey(key) {
  return !SENSITIVE_KEYS.has(key.replace(/[^a-z]/gi, "").toLowerCase());
}

function sanitizeJson(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DeviceProtocolError("Protocol JSON 数据无效");
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new DeviceProtocolError("Protocol JSON 数据无效");
  seen.add(value);
  let sanitized;
  if (Array.isArray(value)) {
    sanitized = value.map(item => sanitizeJson(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new DeviceProtocolError("Protocol JSON 数据无效");
    sanitized = {};
    for (const [key, item] of Object.entries(value)) {
      if (safeKey(key)) sanitized[key] = sanitizeJson(item, seen);
    }
  }
  seen.delete(value);
  return sanitized;
}

function assertAction(action) {
  if (typeof action !== "string" || !ACTION_SET.has(action)) {
    throw new DeviceProtocolError("Device action 不支持", "DEVICE_ACTION_UNSUPPORTED");
  }
}

function assertIdentifier(value) {
  return typeof value === "string" && value.trim() && value.length <= 200;
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) ||
      !assertIdentifier(request.requestId) || !assertIdentifier(request.deviceId) ||
      typeof request.timestamp !== "string" || Number.isNaN(Date.parse(request.timestamp))) {
    throw new DeviceProtocolError("Device request 无效");
  }
  assertAction(request.action);
  const payload = sanitizeJson(request.payload);
  return Object.freeze({
    requestId: request.requestId.trim(),
    deviceId: request.deviceId.trim(),
    action: request.action,
    payload,
    timestamp: new Date(request.timestamp).toISOString()
  });
}

class DeviceBridgeProtocol {
  constructor({ idFactory = randomUUID, clock = () => new Date() } = {}) {
    if (typeof idFactory !== "function" || typeof clock !== "function") throw new TypeError("Protocol 配置无效");
    this.idFactory = idFactory;
    this.clock = clock;
    this.requestIds = new Set();
  }

  createRequest({ deviceId, action, payload = {} } = {}) {
    assertAction(action);
    const requestId = this.idFactory();
    if (!assertIdentifier(requestId) || this.requestIds.has(requestId)) {
      throw new DeviceProtocolError("requestId 无效或重复");
    }
    const timestamp = this.clock();
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) throw new DeviceProtocolError("timestamp 无效");
    const request = validateRequest({ requestId, deviceId, action, payload, timestamp: timestamp.toISOString() });
    this.requestIds.add(requestId);
    return request;
  }

  validateResponse(response, { requestId } = {}) {
    if (!response || typeof response !== "object" || Array.isArray(response) ||
        !assertIdentifier(response.requestId) || typeof response.success !== "boolean" ||
        (requestId != null && response.requestId !== requestId)) {
      throw new DeviceProtocolError("Device response 无效", "DEVICE_RESPONSE_INVALID");
    }
    if (response.success && response.errorCode != null ||
        !response.success && !assertIdentifier(response.errorCode)) {
      throw new DeviceProtocolError("Device response 无效", "DEVICE_RESPONSE_INVALID");
    }
    let result;
    try {
      result = sanitizeJson(response.result);
    } catch {
      throw new DeviceProtocolError("Device response 无效", "DEVICE_RESPONSE_INVALID");
    }
    return Object.freeze({
      requestId: response.requestId,
      success: response.success,
      result,
      errorCode: response.success ? null : response.errorCode
    });
  }
}

module.exports = {
  DEVICE_ACTIONS,
  DeviceBridgeProtocol,
  DeviceProtocolError,
  sanitizeJson,
  validateRequest
};
