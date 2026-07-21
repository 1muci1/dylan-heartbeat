"use strict";

const { timingSafeEqual } = require("node:crypto");

const DEVICE_STATUSES = Object.freeze(["pending", "paired", "revoked"]);

class DeviceIdentityStoreError extends Error {
  constructor(message, code = "DEVICE_IDENTITY_INVALID") {
    super(message);
    this.name = "DeviceIdentityStoreError";
    this.code = code;
  }
}

function publicIdentity(record) {
  if (!record) return null;
  return Object.freeze({
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    platform: record.platform,
    status: record.status,
    createdAt: record.createdAt
  });
}

class DeviceIdentityStore {
  constructor() {
    this.records = new Map();
  }

  create({ deviceId, deviceName, platform, tokenHash, createdAt }) {
    if (typeof deviceId !== "string" || !deviceId || this.records.has(deviceId) ||
        typeof deviceName !== "string" || !deviceName.trim() || deviceName.trim().length > 100 ||
        platform !== "android" || typeof tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(tokenHash) ||
        typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) {
      throw new DeviceIdentityStoreError("Device identity 无效");
    }
    const record = {
      deviceId,
      deviceName: deviceName.trim(),
      platform,
      status: "pending",
      tokenHash,
      createdAt: new Date(createdAt).toISOString()
    };
    this.records.set(deviceId, record);
    return publicIdentity(record);
  }

  get(deviceId) {
    return publicIdentity(this.records.get(deviceId));
  }

  hasTokenHash(deviceId, tokenHash) {
    const record = this.records.get(deviceId);
    if (!record || typeof record.tokenHash !== "string" || typeof tokenHash !== "string") return false;
    const stored = Buffer.from(record.tokenHash, "hex");
    const supplied = Buffer.from(tokenHash, "hex");
    return stored.length === supplied.length && timingSafeEqual(stored, supplied);
  }

  setStatus(deviceId, status) {
    const record = this.records.get(deviceId);
    if (!record) throw new DeviceIdentityStoreError("Device 不存在", "DEVICE_NOT_FOUND");
    if (!DEVICE_STATUSES.includes(status)) throw new DeviceIdentityStoreError("Device status 无效");
    const allowed = record.status === "pending" && status === "paired" ||
      record.status === "paired" && status === "revoked";
    if (!allowed) throw new DeviceIdentityStoreError("Device status 转换无效", "DEVICE_STATUS_INVALID");
    record.status = status;
    if (status === "paired") delete record.tokenHash;
    return publicIdentity(record);
  }

  list() {
    return [...this.records.values()].map(publicIdentity);
  }
}

module.exports = { DEVICE_STATUSES, DeviceIdentityStore, DeviceIdentityStoreError };
