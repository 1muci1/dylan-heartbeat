"use strict";

class DeviceSessionStoreError extends Error {
  constructor(message, code = "DEVICE_SESSION_INVALID") {
    super(message);
    this.name = "DeviceSessionStoreError";
    this.code = code;
  }
}

function publicSession(record) {
  if (!record) return null;
  return Object.freeze({
    sessionId: record.sessionId,
    deviceId: record.deviceId,
    connectedAt: record.connectedAt,
    lastHeartbeatAt: record.lastHeartbeatAt
  });
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

class DeviceSessionStore {
  constructor() {
    this.records = new Map();
  }

  create({ sessionId, deviceId, connectedAt, lastHeartbeatAt }) {
    if (typeof sessionId !== "string" || !sessionId || this.records.has(sessionId) ||
        typeof deviceId !== "string" || !deviceId || !validTimestamp(connectedAt) ||
        !validTimestamp(lastHeartbeatAt)) {
      throw new DeviceSessionStoreError("Device session 无效");
    }
    const record = {
      sessionId,
      deviceId,
      connectedAt: new Date(connectedAt).toISOString(),
      lastHeartbeatAt: new Date(lastHeartbeatAt).toISOString()
    };
    this.records.set(sessionId, record);
    return publicSession(record);
  }

  get(sessionId) {
    return publicSession(this.records.get(sessionId));
  }

  findByDeviceId(deviceId) {
    const records = [...this.records.values()].reverse();
    for (const record of records) {
      if (record.deviceId === deviceId) return publicSession(record);
    }
    return null;
  }

  touch(sessionId, lastHeartbeatAt) {
    const record = this.records.get(sessionId);
    if (!record) throw new DeviceSessionStoreError("Device session 不存在", "DEVICE_SESSION_NOT_FOUND");
    if (!validTimestamp(lastHeartbeatAt)) throw new DeviceSessionStoreError("Heartbeat 时间无效");
    record.lastHeartbeatAt = new Date(lastHeartbeatAt).toISOString();
    return publicSession(record);
  }

  delete(sessionId) {
    const record = this.records.get(sessionId);
    if (!record) return null;
    this.records.delete(sessionId);
    return publicSession(record);
  }
}

module.exports = { DeviceSessionStore, DeviceSessionStoreError };
